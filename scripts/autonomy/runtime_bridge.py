"""Multica Claude stream-json: фильтр событий перед настоящим native Claude.

Программный no_action имеет нулевое usage и не выдаёт себя за ответ модели.
"""
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading

from controller import ExternalCommandError, Ledger, Live, fingerprint, lock, read_command


PR_QUERY = """query($owner: String!, $name: String!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 100, after: $endCursor, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number state headRefOid baseRefName
        commits(last: 1) { nodes { commit { statusCheckRollup {
          contexts(first: 100) {
            pageInfo { hasNextPage }
            nodes {
              __typename
              ... on CheckRun { name conclusion status }
              ... on StatusContext { context state }
            }
          }
        } } } }
      }
    }
  }
}"""


def pull_requests(live):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", live.gh_repo):
        raise RuntimeError("invalid GitHub repository")
    owner, name = live.gh_repo.split("/")
    pages = read_command(["gh", "api", "graphql", "--paginate", "--slurp", "-f", "query=" + PR_QUERY,
                          "-F", "owner=" + owner, "-F", "name=" + name])
    if not isinstance(pages, list) or not pages:
        raise RuntimeError("incomplete pull request inventory")
    result, numbers, cursors = [], set(), set()
    try:
        for index, page in enumerate(pages):
            if page.get("errors"):
                raise ValueError()
            connection = page["data"]["repository"]["pullRequests"]
            info = connection["pageInfo"]
            if info["hasNextPage"] is not (index < len(pages) - 1) or not isinstance(connection["nodes"], list):
                raise ValueError()
            if info["hasNextPage"]:
                cursor = info.get("endCursor")
                if not isinstance(cursor, str) or not cursor or cursor in cursors:
                    raise ValueError()
                cursors.add(cursor)
            for pr in connection["nodes"]:
                if pr["number"] in numbers:
                    raise ValueError()
                numbers.add(pr["number"])
                commits = pr["commits"]["nodes"]
                rollup = commits[-1]["commit"]["statusCheckRollup"] if commits else None
                checks = []
                if rollup is not None:
                    contexts = rollup["contexts"]
                    if contexts["pageInfo"]["hasNextPage"] is not False or not isinstance(contexts["nodes"], list):
                        raise RuntimeError("incomplete check context inventory")
                    checks = contexts["nodes"]
                result.append({**pr, "statusCheckRollup": checks})
    except (KeyError, TypeError, AttributeError, ValueError) as error:
        raise RuntimeError("incomplete pull request inventory") from error
    return result


def queue_attention(config, snapshot):
    """Вернуть причину планового пробуждения только при нарушении очереди."""
    target = int(config.get("queue_target_todo", 3))
    issues = snapshot.get("issues", [])
    todo_count = 0
    active_count = 0
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        status = str(issue.get("status") or "").lower()
        category = str(issue.get("status_category") or "").lower()
        if status == "todo" or category == "todo":
            todo_count += 1
        if (status in ("in_progress", "in_review", "started", "review")
                or category in ("started", "in_progress", "active")):
            active_count += 1
    reasons = []
    if todo_count < target:
        reasons.append("refill_queue")
    if todo_count and not active_count:
        reasons.append("dispatch_ready_work")
    if not reasons:
        return None
    return {"reasons": reasons, "todo_count": todo_count, "todo_target": target,
            "todo_deficit": max(0, target - todo_count), "active_count": active_count}


def dispatch(config, snapshot, prompt, model, now=None):
    root = Path(config["state_dir"])
    with lock(root / "coordinator.lock"):
        ledger = Ledger(root / "ledger.sqlite3")
        context = {"namespace": config.get("event_namespace", "coordinator"),
                   "instructions": config.get("instructions_version", "v1")}
        event = {"snapshot": snapshot, **context}
        attention = queue_attention(config, snapshot)
        if attention:
            interval = int(config.get("liveness_interval_seconds", 3600))
            if interval <= 0:
                raise RuntimeError("invalid liveness interval")
            current = now or dt.datetime.now(dt.timezone.utc)
            event["liveness_window"] = int(current.timestamp()) // interval
            event["attention"] = attention
        key = fingerprint(event)
        cursor_key = "snapshot:" + fingerprint(context)
        if not ledger.claim(key):
            done = ledger.completed_at(key) is not None
            return {"status": "no_action" if done else "failed", "model_called": False,
                    "event_key": key, "reason": "unchanged_snapshot" if done else "reconciliation_required",
                    "exit_code": 0 if done else 2}
        previous = ledger.cursor(cursor_key) or {}
        delta = {}
        for category, values in snapshot.items():
            if isinstance(values, list):
                prior = {x.get("id"): x for x in previous.get(category, []) if isinstance(x, dict)}
                delta[category] = [x for x in values if not isinstance(x, dict) or prior.get(x.get("id")) != x]
            elif previous.get(category) != values:
                delta[category] = values
        handoff = prompt
        if attention:
            handoff += "\n\nALTERA_CONTROLLER_ATTENTION_V1\n" + json.dumps(attention, ensure_ascii=False)
        handoff += "\n\nALTERA_CONTROLLER_DELTA_V1\n" + json.dumps(delta, ensure_ascii=False)
        outcome = model(handoff)
        ledger.finish(key, outcome == 0)
        if outcome == 0:
            ledger.set_cursor(cursor_key, snapshot)
        return {"status": "completed" if outcome == 0 else "failed", "model_called": True, "event_key": key, "exit_code": outcome}


def emit(result, stream=sys.stdout):
    record = {"type": "result", "subtype": "success" if result.get("status") != "failed" else "error_during_execution",
              "session_id": "", "is_error": result.get("status") == "failed", "num_turns": 0,
              "result": "ALTERA_CONTROLLER_V1 " + json.dumps({"executor": "controller", **result}, ensure_ascii=False),
              "usage": {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}}
    stream.write(json.dumps(record, ensure_ascii=False) + "\n"); stream.flush()


def snapshot(live):
    issues = []
    for offset in range(0, 10000, 100):
        page = live.multica_read("issue", "list", "--project", live.config["project_id"], "--limit", "100", "--offset", str(offset))
        issues.extend(page["issues"])
        if not page.get("has_more"):
            break
    else:
        raise RuntimeError("incomplete issue inventory")
    state = []
    for issue in issues:
        # Обновления служебных статусов, heartbeat и комментарии лидера не входят в ключ.
        item = {k: issue.get(k) for k in ("id", "identifier", "title", "status", "status_category", "assignee_id", "parent_issue_id", "priority")}
        item["description_hash"] = fingerprint(issue.get("description", ""))
        if issue.get("status") == "done" or issue.get("status_category") in ("done", "completed"):
            item.update(runs=[], comment_cursor=[], comment_edit_coverage="not_applicable")
            state.append(item)
            continue
        runs = live.multica_read("issue", "runs", issue["id"])
        item["runs"] = sorted((x["id"], x.get("status"), fingerprint(x.get("result"))) for x in runs if x.get("agent_id") not in live.config.get("controller_agent_ids", []))
        # --since фильтрует created_at и теряет правки старых комментариев.
        # --full сохраняет также сообщения свёрнутых resolved threads; тела не идут в delta.
        comments = live.multica_read("issue", "comment", "list", issue["id"], "--full", "--summary")
        if isinstance(comments, dict):
            comments = comments.get("comments", [])
        comments = [x for x in comments if x.get("author_id") not in live.config.get("controller_agent_ids", [])]
        item["comment_cursor"] = sorted(
            (x.get("id"), x.get("revision"), x.get("updated_at"), fingerprint(x.get("content", x.get("summary"))))
            for x in comments
        )
        # Без revision/updated_at нельзя доказать отсутствие правки за границей preview.
        item["comment_edit_coverage"] = "partial" if any(
            x.get("content_truncated") is True and x.get("revision") is None and not x.get("updated_at")
            for x in comments
        ) else "complete"
        state.append(item)
    prs = pull_requests(live)
    projected = []
    for pr in prs:
        projected.append({"id": pr["number"], "state": pr["state"], "head": pr["headRefOid"], "base": pr["baseRefName"],
                          "checks": sorted((x.get("name", x.get("context", "")), x.get("conclusion", x.get("state", "")), x.get("status", "")) for x in pr.get("statusCheckRollup") or [])})
    app_sha = live.gh(f"repos/{live.gh_repo}/git/ref/heads/app")["object"]["sha"]
    return {"issues": sorted(state, key=lambda x: x["id"]), "prs": sorted(projected, key=lambda x: x["id"]), "app_sha": app_sha}


def native_model(config, args, message):
    # Реальный клиент сохраняет managed MCP/config аргументы daemon. Control frames
    # пересылаются в обе стороны без эмуляции tool results или auth.
    child = subprocess.Popen([config["claude_binary"], *args], stdin=subprocess.PIPE, text=True)
    first = {"type": "user", "message": {"role": "user", "content": message}}
    child.stdin.write(json.dumps(first) + "\n"); child.stdin.flush()
    def relay():
        try:
            for line in sys.stdin:
                child.stdin.write(line); child.stdin.flush()
        except (BrokenPipeError, ValueError):
            pass
        finally:
            try:
                child.stdin.close()
            except (BrokenPipeError, ValueError):
                pass
    threading.Thread(target=relay, daemon=True).start()
    return child.wait()


def failure_details(error):
    details = {"error_type": type(error).__name__}
    if isinstance(error, ExternalCommandError):
        details.update(error_code="external_command_failed", error_source=error.source,
                       exit_code=error.exit_code)
    elif isinstance(error, subprocess.TimeoutExpired):
        details.update(error_code="external_command_timeout", error_source=Path(error.cmd[0]).name)
    elif isinstance(error, RuntimeError):
        details["error_code"] = "runtime_invariant"
    else:
        details["error_code"] = "unexpected_error"
    return details


def main():
    if sys.argv[1:] == ["--version"]:
        print("altera-autonomy-controller 1.0.0")
        return 0
    config_path = os.environ.get("ALTERA_AUTONOMY_CONFIG")
    if not config_path:
        raise RuntimeError("missing ALTERA_AUTONOMY_CONFIG")
    config = json.loads(Path(config_path).read_text())
    actor = os.environ.get("MULTICA_AGENT_ID")
    if not actor or actor not in config.get("controller_agent_ids", []):
        raise RuntimeError("coordinator profile used by unexpected agent")
    config["event_namespace"] = actor
    initial = json.loads(sys.stdin.readline())
    content = initial.get("message", {}).get("content", "")
    if isinstance(content, list):
        content = "\n".join(x.get("text", "") for x in content if x.get("type") == "text")
    if not isinstance(content, str):
        raise ValueError("unsupported input")
    if "ALTERA_CONTROLLER_CANARY_V1" in content:
        # Explicit diagnostic marker; cannot mutate status or invoke model.
        emit({"status": "no_action", "model_called": False, "diagnostic": "protocol_canary"})
        return 0
    live = Live(config)
    result = dispatch(config, snapshot(live), content, lambda msg: native_model(config, sys.argv[1:], msg))
    if not result["model_called"]:
        emit(result)
    return result.get("exit_code", 0)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # Ошибка инфраструктуры не превращается в успешный no_action.
        emit({"status": "failed", "model_called": False, **failure_details(error)})
        sys.exit(2)
