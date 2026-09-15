"""Проверка доказательств и журнал идемпотентности. Только stdlib."""
import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
from deploy_evidence import health, render_deploy


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def review_approved(content, sha):
    lines = content.strip().splitlines()
    prefix = "ALTERA_REVIEW_V1 "
    if not lines or not lines[-1].startswith(prefix):
        return False
    try:
        return json.loads(lines[-1][len(prefix):]) == {"sha": sha, "verdict": "approved"}
    except ValueError:
        return False


def validate(receipt, facts, phase="done"):
    """facts поступают от live-провайдера, не из текста агента."""
    errors = []
    if facts.get("issue_scope_valid") is not True:
        errors.append("issue_scope")
    sha = receipt.get("tested_sha")
    pr = receipt.get("pr", {})
    live_pr = facts.get("pr", {})
    review = receipt.get("review", {})
    if receipt.get("schema_version") != 1 or not re.fullmatch(r"[0-9a-f]{40}", sha or ""):
        errors.append("schema")
    if not receipt.get("task_id") or not receipt.get("source", {}).get("path") or not receipt.get("baseline_sha"):
        errors.append("source")
    criteria = receipt.get("criteria", [])
    if not criteria or any(x.get("status") != "passed" or not x.get("id") or not x.get("evidence") for x in criteria):
        errors.append("criteria")
    if not pr.get("number") or pr.get("base_ref") != "app" or pr.get("head_sha") != sha or any(pr.get(k) != live_pr.get(k) for k in ("number", "head_sha", "base_ref", "base_sha")):
        errors.append("pr")
    if facts.get("ci", {}).get("sha") != sha or facts.get("ci", {}).get("passed") is not True:
        errors.append("ci")
    if not receipt.get("implementer_run_id") or facts.get("implementer_trusted") is not True or not review.get("actor_id") or review.get("actor_id") == receipt.get("implementer_id") or review.get("sha") != sha or review.get("verdict") != "approved" or not review.get("run_id") or facts.get("review") != review or facts.get("review_completed") is not True or facts.get("review_trusted") is not True:
        errors.append("review")
    if facts.get("files_complete") is not True:
        errors.append("pr_files")
    if phase == "merge":
        if facts.get("state") != "OPEN" or facts.get("base_current") is not True:
            errors.append("base")
        return errors
    if facts.get("state") != "MERGED" or not pr.get("merge_sha") or pr.get("merge_sha") != live_pr.get("merge_sha") or facts.get("merge_in_app") is not True:
        errors.append("merge")
    deployment = receipt.get("deployment", {})
    if facts.get("requires_deploy") is not False or deployment.get("required") is not False:
        dep = facts.get("deployment", {})
        if dep.get("status") != "live" or dep.get("sha") != pr.get("merge_sha") or dep.get("health") is not True:
            errors.append("deployment")
    elif not deployment.get("reason"):
        errors.append("deployment")
    finalization = receipt.get("finalization", {})
    if not finalization.get("path") or not re.fullmatch(r"[0-9a-f]{64}", finalization.get("sha256", "")) or facts.get("finalization_sha256") != finalization.get("sha256"):
        errors.append("finalization")
    return errors


class Ledger:
    """Running без результата требует reconciliation, не слепого повторения."""
    def __init__(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, timeout=30)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS events (key TEXT PRIMARY KEY, state TEXT NOT NULL, attempts INTEGER NOT NULL, updated TEXT NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS cursors (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        self.db.commit()

    def claim(self, key):
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            row = self.db.execute("SELECT state, attempts FROM events WHERE key=?", (key,)).fetchone()
            if row and (row[0] in ("running", "done") or row[1] >= 3):
                return False
            attempts = row[1] + 1 if row else 1
            self.db.execute("INSERT OR REPLACE INTO events VALUES (?, 'running', ?, ?)", (key, attempts, dt.datetime.now(dt.timezone.utc).isoformat()))
        return True

    def finish(self, key, success):
        with self.db:
            self.db.execute("UPDATE events SET state=?, updated=? WHERE key=? AND state='running'", ("done" if success else "failed", dt.datetime.now(dt.timezone.utc).isoformat(), key))

    def observe_done(self, key):
        """Вызывать только после независимой сверки уже выполненного внешнего действия."""
        with self.db:
            self.db.execute("INSERT INTO events VALUES (?, 'done', 0, ?) ON CONFLICT(key) DO UPDATE SET state='done', updated=excluded.updated", (key, dt.datetime.now(dt.timezone.utc).isoformat()))

    def cursor(self, key):
        row = self.db.execute("SELECT value FROM cursors WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def set_cursor(self, key, value):
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO cursors VALUES (?, ?)", (key, json.dumps(value)))

    def completed_at(self, key):
        row = self.db.execute("SELECT updated FROM events WHERE key=? AND state='done'", (key,)).fetchone()
        return row[0] if row else None


@contextlib.contextmanager
def lock(path):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


def command(args, cwd=None, as_json=True):
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True, timeout=120, check=False)
    if result.returncode:
        # Вывод внешнего процесса может содержать credentials; только безопасный код.
        raise RuntimeError(f"{Path(args[0]).name}: exit {result.returncode}")
    return json.loads(result.stdout) if as_json else result.stdout.strip()


class Live:
    def __init__(self, config):
        self.config = config
        self.repo = Path(config["repo"])
        self.gh_repo = config.get("github_repo", "Egoka/Altera")

    def multica(self, *args):
        return command([self.config["multica"], *args, "--server-url", self.config["server_url"], "--workspace-id", self.config["workspace_id"], "--output", "json"])

    def gh(self, endpoint):
        return command(["gh", "api", endpoint])

    def fetch_matches(self, ref, sha):
        """Получить ровно ref, не обновляя named refs; сверить наблюдённый GitHub SHA."""
        if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
            return False
        try:
            command(["git", "fetch", "--no-tags", "--refmap=", "origin", ref], self.repo, False)
            return command(["git", "rev-parse", "FETCH_HEAD"], self.repo, False) == sha
        except (RuntimeError, OSError, subprocess.TimeoutExpired):
            return False

    def issue_scope(self, receipt, issue):
        metadata = issue.get("metadata") if isinstance(issue, dict) else None
        return bool(
            self.config.get("workspace_id") and self.config.get("project_id")
            and receipt.get("issue_id") and isinstance(metadata, dict)
            and issue.get("id") == receipt["issue_id"]
            and issue.get("workspace_id") == self.config["workspace_id"]
            and issue.get("project_id") == self.config["project_id"]
            and metadata.get("task_id") == receipt.get("task_id")
            and receipt.get("source", {}).get("issue_id", receipt["issue_id"]) == receipt["issue_id"]
        )

    @staticmethod
    def issue_done(issue):
        category = issue.get("status_category")
        return category == "completed" or (category is None and issue.get("status") == "done")

    @staticmethod
    def write_verified(receipt, state_dir, accepted_at):
        target = Path(state_dir) / "verified" / (receipt["task_id"] + ".json")
        target.parent.mkdir(exist_ok=True)
        if target.exists():
            try:
                prior = json.loads(target.read_text())
                if prior.get("verified") is True and prior.get("task_id") == receipt["task_id"] and prior.get("tested_sha") == receipt["tested_sha"]:
                    accepted_at = prior.get("accepted_at") or accepted_at
            except (OSError, ValueError, AttributeError):
                pass
        verified = {**receipt, "verified": True, "accepted_at": accepted_at, "enforcement": "managed_path_only"}
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(json.dumps(verified, ensure_ascii=False, indent=2) + "\n")
        try:
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)

    def deployment(self, receipt):
        dep = receipt.get("deployment", {})
        actor = dep.get("probe_actor_id")
        if actor not in self.config.get("release_agent_ids", []):
            return {}
        rows = self.multica("agent", "tasks", actor)
        run = next((x for x in rows if x.get("id") == dep.get("probe_run_id") and x.get("status") == "completed"), None)
        if not run:
            return {}
        messages = self.multica("issue", "run-messages", run["id"])
        value = render_deploy(messages, self.config, dt.datetime.now(dt.timezone.utc), run_id=run["id"])
        if not value:
            return {}
        value["probe_run_id"] = run["id"]
        value["health"] = value.get("status") == "live" and health(self.config.get("health_url", ""), value["sha"])
        return value

    def facts(self, receipt):
        issue = self.multica("issue", "get", receipt.get("issue_id", ""))
        if not self.issue_scope(receipt, issue):
            return {"issue_scope_valid": False}
        number = int(receipt["pr"]["number"])
        pr = self.gh(f"repos/{self.gh_repo}/pulls/{number}")
        sha = pr["head"]["sha"]
        checks = self.gh(f"repos/{self.gh_repo}/commits/{sha}/check-runs?per_page=100")
        aggregate = [x for x in checks.get("check_runs", []) if x["name"] == "test" and x.get("app", {}).get("slug") == "github-actions"]
        aggregate.sort(key=lambda x: x["id"], reverse=True)
        base = self.gh(f"repos/{self.gh_repo}/git/ref/heads/app")["object"]["sha"]
        review = receipt.get("review", {})
        runs = self.multica("issue", "runs", receipt["issue_id"])
        selected = next((x for x in runs if x.get("id") == review.get("run_id")), {})
        result = selected.get("result") or {}
        content = result.get("output", "") if isinstance(result, dict) else ""
        implementer = next((x for x in runs if x.get("id") == receipt.get("implementer_run_id")), {})
        actor = selected.get("agent_id")
        path = receipt.get("finalization", {}).get("path", "")
        final_hash = None
        base_fetched = self.fetch_matches("refs/heads/app", base)
        base_current = False
        if base_fetched and not pr.get("merged") and pr.get("state") == "open" and self.fetch_matches(f"refs/pull/{number}/head", sha):
            try:
                command(["git", "merge-base", "--is-ancestor", base, sha], self.repo, False)
                base_current = True
            except (RuntimeError, OSError, subprocess.TimeoutExpired):
                pass
        if path.startswith("docs/reports/") and ".." not in Path(path).parts:
            p = subprocess.run(["git", "show", f"{base}:{path}"], cwd=self.repo, capture_output=True, check=False)
            if p.returncode == 0 and receipt["task_id"].encode() in p.stdout and sha.encode() in p.stdout:
                final_hash = hashlib.sha256(p.stdout).hexdigest()
        merge_sha = pr.get("merge_commit_sha") if pr.get("merged") else None
        merged = bool(merge_sha and subprocess.run(["git", "merge-base", "--is-ancestor", merge_sha, base], cwd=self.repo, capture_output=True).returncode == 0)
        files = command(["gh", "api", "--paginate", "--slurp", f"repos/{self.gh_repo}/pulls/{number}/files?per_page=100"])
        names = [x["filename"] for page in files for x in page]
        requires_deploy = any(x.startswith(("server/", "packages/")) or x in ("pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", ".nvmrc", "render.yaml") for x in names)
        facts = {"issue_scope_valid": True, "pr": {"number": number, "head_sha": sha, "base_ref": pr["base"]["ref"], "base_sha": pr["base"]["sha"], "merge_sha": merge_sha},
                 "state": "MERGED" if pr.get("merged") else pr["state"].upper(), "ci": {"sha": sha, "passed": bool(aggregate and aggregate[0].get("conclusion") == "success")},
                 "review": review, "review_completed": selected.get("status") == "completed", "review_trusted": actor == review.get("actor_id") and actor in self.config.get("reviewer_ids", []) and review_approved(content, sha),
                 "implementer_trusted": implementer.get("status") == "completed" and bool(receipt.get("implementer_id")) and implementer.get("agent_id") == receipt.get("implementer_id"),
                 "files_complete": len(names) == pr.get("changed_files"),
                 "base_current": base_current and base == receipt["pr"].get("base_sha"), "merge_in_app": merged,
                 "requires_deploy": requires_deploy, "finalization_sha256": final_hash}
        # Native tool-result связывается с trusted actor/run; HTTP проверяется здесь.
        if requires_deploy:
            facts["deployment"] = self.deployment(receipt)
        return facts

    def transition(self, receipt, phase, state_dir):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", receipt.get("task_id", "")):
            raise ValueError("invalid task_id")
        with lock(Path(state_dir) / "dispatch.lock"):
            facts = self.facts(receipt)
            ledger = Ledger(Path(state_dir) / "ledger.sqlite3")
            key = fingerprint({"phase": phase, "task": receipt["task_id"], "sha": receipt["tested_sha"]})
            if phase == "merge" and facts.get("state") == "MERGED" and facts.get("merge_in_app") is True:
                prior = {**facts, "state": "OPEN", "base_current": True}
                if not validate(receipt, prior, "merge"):
                    ledger.observe_done(key)
                    return {"ok": True, "phase": phase, "reconciled": True, "merge_sha": facts["pr"].get("merge_sha")}
            errors = validate(receipt, facts, phase)
            if errors:
                return {"ok": False, "blocked": errors}
            if phase == "done":
                issue = self.multica("issue", "get", receipt["issue_id"])
                if not self.issue_scope(receipt, issue):
                    return {"ok": False, "blocked": ["issue_scope"]}
                if self.issue_done(issue):
                    accepted_at = ledger.completed_at(key) or dt.datetime.now(dt.timezone.utc).isoformat()
                    self.write_verified(receipt, state_dir, accepted_at)
                    ledger.observe_done(key)
                    return {"ok": True, "phase": phase, "reconciled": True, "task_id": receipt["task_id"]}
            if not ledger.claim(key):
                return {"ok": False, "blocked": ["duplicate_or_reconciliation_required"]}
            # До внешнего вызова запись running. Неопределённый сбой оставляет её для сверки.
            if phase == "merge":
                command(["gh", "pr", "merge", str(receipt["pr"]["number"]), "--repo", self.gh_repo, "--squash", "--match-head-commit", receipt["tested_sha"]], as_json=False)
            else:
                self.multica("issue", "status", receipt["issue_id"], "done", "--no-start")
                issue = self.multica("issue", "get", receipt["issue_id"])
                if not self.issue_scope(receipt, issue) or not self.issue_done(issue):
                    raise RuntimeError("Done transition could not be confirmed")
            ledger.finish(key, True)
            if phase == "done":
                self.write_verified(receipt, state_dir, ledger.completed_at(key))
            return {"ok": True, "phase": phase, "task_id": receipt["task_id"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["verify", "merge", "done"])
    parser.add_argument("--config", required=True)
    parser.add_argument("--receipt", required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    receipt = json.loads(Path(args.receipt).read_text())
    live = Live(config)
    if args.action == "verify":
        errors = validate(receipt, live.facts(receipt))
        result = {"ok": not errors, "blocked": errors}
    else:
        result = live.transition(receipt, args.action, config["state_dir"])
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, OSError, RuntimeError) as error:
        print(json.dumps({"ok": False, "error_type": type(error).__name__}))
        sys.exit(2)
