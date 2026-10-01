"""Проверка доказательств и журнал идемпотентности. Только stdlib."""
import argparse
import contextlib
import copy
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
import time
import cleanup as worktree_cleanup
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
    # Итог задачи, дописанный в ветку после зелёного CI, не может назвать собственный SHA.
    # Такой head принимается, только если отличается от проверенного ровно файлами этого итога,
    # является его потомком и сам проверен CI (см. `head_receipt_only`).
    live_head = live_pr.get("head_sha")
    head_ok = live_head == sha or facts.get("head_receipt_only") is True
    if not pr.get("number") or pr.get("base_ref") != "app" or pr.get("head_sha") != sha or not head_ok or any(pr.get(k) != live_pr.get(k) for k in ("number", "base_ref", "base_sha")):
        errors.append("pr")
    if not isinstance(live_head, str) or facts.get("ci", {}).get("sha") != live_head or facts.get("ci", {}).get("passed") is not True:
        errors.append("ci")
    # Review более раннего SHA действует, только если контроллер подтвердил тот же патч ветки.
    reviewed_sha = review.get("sha")
    review_sha_ok = isinstance(reviewed_sha, str) and re.fullmatch(r"[0-9a-f]{40}", reviewed_sha) and (reviewed_sha == sha or facts.get("review_equivalent") is True)
    if not receipt.get("implementer_run_id") or facts.get("implementer_trusted") is not True or not review.get("actor_id") or review.get("actor_id") == receipt.get("implementer_id") or not review_sha_ok or review.get("verdict") != "approved" or not review.get("run_id") or facts.get("review") != review or facts.get("review_completed") is not True or facts.get("review_trusted") is not True:
        errors.append("review")
    if facts.get("files_complete") is not True:
        errors.append("pr_files")
    if phase == "merge":
        # `base` — PR закрыт, конфликтует с app или GitHub ещё не посчитал mergeability.
        # Отставание от app само по себе merge не блокирует (решение владельца 2026-09-19).
        if facts.get("state") != "OPEN" or facts.get("mergeable") is not True:
            errors.append("base")
        return errors
    if facts.get("state") != "MERGED" or not pr.get("merge_sha") or pr.get("merge_sha") != live_pr.get("merge_sha") or facts.get("merge_in_app") is not True:
        errors.append("merge")
    deployment = receipt.get("deployment", {})
    if facts.get("requires_deploy") is not False or deployment.get("required") is not False:
        dep = facts.get("deployment", {})
        dep_sha = dep.get("sha")
        merge_sha = pr.get("merge_sha")
        sha_ok = dep_sha == merge_sha or dep.get("merge_sha_included") is True
        if dep.get("status") != "live" or not sha_ok or dep.get("health") is not True:
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

    def release_unapplied(self, key):
        """`running` → `failed`, когда сверка под общим lock доказала, что действие не состоялось."""
        with self.db:
            self.db.execute("UPDATE events SET state='failed', updated=? WHERE key=? AND state='running'", (dt.datetime.now(dt.timezone.utc).isoformat(), key))

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


class ExternalCommandError(RuntimeError):
    """Безопасная ошибка границы процесса: без stderr и аргументов с credentials."""
    def __init__(self, args, exit_code, reason="exit"):
        self.source = Path(args[0]).name
        self.exit_code = exit_code
        self.reason = reason
        super().__init__(f"{self.source}: {reason} {exit_code}")


def command(args, cwd=None, as_json=True):
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True, timeout=120, check=False)
    if result.returncode:
        # Вывод внешнего процесса может содержать credentials; только безопасный код.
        raise ExternalCommandError(args, result.returncode)
    if not as_json:
        return result.stdout.strip()
    try:
        return json.loads(result.stdout)
    except ValueError as error:
        raise ExternalCommandError(args, 0, "invalid_json") from error


def read_command(args, cwd=None, as_json=True, attempts=3, pause=0.25):
    """Повторяет только идемпотентное чтение; вызывающий явно выбирает этот путь."""
    for attempt in range(attempts):
        try:
            return command(args, cwd, as_json)
        except (RuntimeError, OSError, subprocess.TimeoutExpired):
            if attempt + 1 == attempts:
                raise
            if pause:
                time.sleep(pause * (attempt + 1))


def rows(value, key):
    """Список из ответа Multica CLI: массив или объект с массивом под `key`."""
    if isinstance(value, list):
        return value
    if isinstance(value, dict) and isinstance(value.get(key), list):
        # Полный history endpoint страниц не отдаёт; признак продолжения значит неполный инвентарь.
        if value.get("has_more"):
            raise RuntimeError("paginated multica payload is incomplete")
        return value[key]
    raise RuntimeError("unexpected multica payload")


class CleanupEvidence:
    """Живые доказательства для `cleanup.py` после Done.

    Fence — общая рабочая папка Multica: демон исполняет в ней один запуск за раз, поэтому, пока идёт
    запуск вызывающего агента, остальные ждут. Каждое чтение подтверждает это полным списком запусков
    workspace, а `dispatch.lock` держит вызывающий контроллер на всё время уборки.
    """

    live = True

    def __init__(self, source, state_dir, caller_agent_id=None):
        self.source = source
        self.state_dir = Path(state_dir)
        self.caller_agent_id = caller_agent_id

    @contextlib.contextmanager
    def guard(self, receipt):
        # Повторный захват из того же процесса заблокировал бы вызывающего: проверяем, что lock занят.
        with (self.state_dir / "dispatch.lock").open("a") as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                pass
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)
                raise RuntimeError("dispatch lock is not held by the controller")
        yield

    def verified(self, receipt):
        """Receipt — это итог, который контроллер сам принял в Done, с теми же дополнениями уборки."""
        try:
            accepted = json.loads((self.state_dir / "verified" / (receipt["task_id"] + ".json")).read_text())
        except (OSError, ValueError):
            return False
        return accepted.get("verified") is True and receipt == self.source.cleanup_receipt(accepted, receipt.get("worktree"))

    def inventory(self, receipt):
        """Незавершённые запуски всех агентов workspace и запуск вызывающего агента."""
        source = self.source
        runs, own = [], []
        agents = [agent.get("id") if isinstance(agent, dict) else None
                  for agent in rows(source.multica_read("agent", "list", "--include-archived"), "agents")]
        if not all(agents):
            raise RuntimeError("agent without id")
        for agent_id in agents:
            for run in rows(source.multica_read("agent", "tasks", agent_id), "tasks"):
                status = str(run.get("status") or "").lower()
                if status in worktree_cleanup.TERMINAL_RUNS:
                    continue
                item = {"id": run.get("id"), "status": status}
                issue_id = run.get("issue_id")
                if issue_id and issue_id == receipt.get("issue_id"):
                    item["task_id"] = receipt["task_id"]
                elif issue_id:
                    metadata = source.multica_read("issue", "get", issue_id).get("metadata") or {}
                    if metadata.get("task_id"):
                        item["task_id"] = metadata["task_id"]
                if agent_id == self.caller_agent_id and status == "running":
                    own.append(item["id"])
                runs.append(item)
        if self.caller_agent_id and len(own) != 1:
            raise RuntimeError("caller run is not uniquely identified")
        return runs, (own[0] if own else None)

    def fence_ready(self):
        """Предпроверка досборки: сейчас исполняется только вызывающий запуск (правила `cleanup.py`)."""
        try:
            runs, caller = self.inventory({})
        except Exception:
            return False
        for run in runs:
            if caller is not None and run["id"] == caller and run["status"] == "running":
                continue
            if run["status"] not in worktree_cleanup.WAITING_RUNS or caller is None:
                return False
        return True

    def app_artifact(self, path):
        """Git blob и SHA-256 итога в `origin/app`; `cleanup.py` читает тот же remote-tracking ref."""
        repo = self.source.repo
        command(["git", "fetch", "--no-tags", "origin", "+refs/heads/app:refs/remotes/origin/app"], repo, False)
        if not isinstance(path, str) or not path.startswith("docs/reports/") or ".." in Path(path).parts:
            return None
        found = subprocess.run(["git", "rev-parse", "refs/remotes/origin/app:" + path], cwd=repo, capture_output=True, text=True)
        if found.returncode:
            return None
        blob = found.stdout.strip()
        content = subprocess.run(["git", "cat-file", "blob", blob], cwd=repo, capture_output=True, check=True).stdout
        return blob, hashlib.sha256(content).hexdigest()

    @staticmethod
    def worktree_in_use(path):
        """Процесс с текущим каталогом внутри worktree — живая сессия или dev-сервер; None — неизвестно."""
        try:
            result = subprocess.run(["lsof", "-w", "-n", "-P", "-d", "cwd", "-F", "n"],
                                    capture_output=True, text=True, timeout=60, check=False)
        except (OSError, subprocess.SubprocessError):
            return None
        if result.returncode not in (0, 1) or not result.stdout:
            return None
        target = Path(path).resolve()
        return any(line.startswith("n") and worktree_cleanup._under(Path(line[1:]).resolve(), target)
                   for line in result.stdout.splitlines())

    def read(self, receipt):
        source = self.source
        issue = source.multica_read("issue", "get", receipt.get("issue_id", ""))
        done = source.issue_scope(receipt, issue) and source.issue_done(issue)
        pr = source.gh(f"repos/{source.gh_repo}/pulls/{int(receipt['pr']['number'])}")
        artifact = self.app_artifact(receipt.get("finalization", {}).get("path"))
        # Свежесть важна для запусков и процессов: время фиксируется перед их чтением.
        observed = time.time()
        runs, caller = self.inventory(receipt)
        in_use = self.worktree_in_use(receipt["worktree"])
        merged = bool(pr.get("merged"))
        return {
            "observed_at": observed, "complete": True, "fence": "exclusive", "caller_run_id": caller,
            "worktree_in_use": in_use,
            "task": {"id": receipt["task_id"], "status": "done" if done else str(issue.get("status")),
                     "confirmed_done": bool(done and self.verified(receipt)),
                     "finalized_in_app": bool(artifact and artifact[1] == receipt["finalization"]["sha256"]),
                     "receipt_sha256": worktree_cleanup.canonical_hash(receipt),
                     "artifacts": [{"id": "gitblob:" + artifact[0], "sha256": artifact[1]}] if artifact else []},
            "pr": {"state": "MERGED" if merged else str(pr.get("state", "")).upper(), "number": pr.get("number"),
                   "head_sha": pr["head"]["sha"], "base_ref": pr["base"]["ref"], "base_sha": pr["base"]["sha"],
                   "merge_sha": pr.get("merge_commit_sha") if merged else None, "url": pr.get("html_url")},
            "runs": runs,
        }


class Live:
    def __init__(self, config):
        self.config = config
        self.repo = Path(config["repo"])
        self.gh_repo = config.get("github_repo", "Egoka/Altera")

    def multica(self, *args):
        return command([self.config["multica"], *args, "--server-url", self.config["server_url"], "--workspace-id", self.config["workspace_id"], "--output", "json"])

    def multica_read(self, *args):
        return read_command([self.config["multica"], *args, "--server-url", self.config["server_url"], "--workspace-id", self.config["workspace_id"], "--output", "json"])

    def gh(self, endpoint):
        return read_command(["gh", "api", endpoint])

    def fetch_matches(self, ref, sha):
        """Получить ровно ref, не обновляя named refs; сверить наблюдённый GitHub SHA."""
        if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
            return False
        try:
            command(["git", "fetch", "--no-tags", "--refmap=", "origin", ref], self.repo, False)
            return command(["git", "rev-parse", "FETCH_HEAD"], self.repo, False) == sha
        except (RuntimeError, OSError, subprocess.TimeoutExpired):
            return False

    def patch_fingerprint(self, sha, base, task_id):
        """Отпечаток патча ветки от точки ответвления от app; финализация задачи не входит."""
        fork = command(["git", "merge-base", sha, base], self.repo, False)
        # Итог и отчёт пишутся после review, поэтому одобрение кода они не отменяют.
        # `web/app/graphql/generated/` выводится из схемы и операций: обязательная проверка CI
        # `pnpm codegen --check` на том же head доказывает это, а сами исходники в патче остаются.
        # `:(glob)` не даёт `*` перейти через `/`: подкаталоги остаются в патче.
        own_receipt = ([f":(exclude)docs/reports/tasks/{task_id}.{ext}" for ext in ("json", "md")]
                       + [":(glob,exclude)docs/reports/*", ":(glob,exclude)web/app/graphql/generated/*"])
        diff = subprocess.run(["git", "diff", "--no-color", "--no-ext-diff", "--full-index", "--binary", fork, sha, "--", ".", *own_receipt],
                              cwd=self.repo, capture_output=True, timeout=120, check=True).stdout
        if not diff:
            return None
        # Номера строк не входят в patch-id; контекст, содержимое и бинарные данные входят.
        patch = subprocess.run(["git", "patch-id", "--stable"], input=diff, cwd=self.repo, capture_output=True, timeout=120, check=True).stdout.split()
        return patch[0].decode() if patch else None

    def head_receipt_only(self, tested_sha, head_sha, task_id):
        """Коммит с собственным итогом задачи поверх проверенного head не отменяет проверку."""
        shas = (tested_sha, head_sha)
        if not all(isinstance(x, str) and re.fullmatch(r"[0-9a-f]{40}", x) for x in shas) or not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", task_id):
            return False
        if tested_sha == head_sha:
            return True
        own = {f"docs/reports/tasks/{task_id}.{ext}" for ext in ("json", "md")}

        def own_finalization(name):
            # Отчёт задачи пишется после работы, поэтому ложится поверх проверенного head.
            # Допускается только прямой файл `docs/reports/`: чужие итоги в `tasks/`,
            # evidence и суточные отчёты проверяются своими цепочками.
            prefix = "docs/reports/"
            return name in own or (name.startswith(prefix) and "/" not in name[len(prefix):])

        try:
            for sha in shas:
                if subprocess.run(["git", "cat-file", "-e", sha + "^{commit}"], cwd=self.repo, capture_output=True).returncode:
                    command(["git", "fetch", "--no-tags", "--refmap=", "origin", sha], self.repo, False)
            # Только надстройка над проверенным коммитом: переписанная история сюда не проходит.
            if subprocess.run(["git", "merge-base", "--is-ancestor", tested_sha, head_sha], cwd=self.repo, capture_output=True).returncode:
                return False
            changed = subprocess.run(["git", "diff", "--name-only", "-z", tested_sha, head_sha], cwd=self.repo,
                                     capture_output=True, text=True, timeout=120, check=True).stdout.split("\0")
            return all(own_finalization(name) for name in changed if name)
        except (RuntimeError, OSError, subprocess.SubprocessError):
            return False

    def review_equivalent(self, reviewed_sha, head_sha, base_sha, task_id):
        """Обновление ветки от app не отменяет review, если её патч не изменился."""
        shas = (reviewed_sha, head_sha, base_sha)
        if not all(isinstance(x, str) and re.fullmatch(r"[0-9a-f]{40}", x) for x in shas) or not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", task_id):
            return False
        if reviewed_sha == head_sha:
            return True
        try:
            if subprocess.run(["git", "cat-file", "-e", reviewed_sha + "^{commit}"], cwd=self.repo, capture_output=True).returncode:
                command(["git", "fetch", "--no-tags", "--refmap=", "origin", reviewed_sha], self.repo, False)
            reviewed = self.patch_fingerprint(reviewed_sha, base_sha, task_id)
            return reviewed is not None and reviewed == self.patch_fingerprint(head_sha, base_sha, task_id)
        except (RuntimeError, OSError, subprocess.SubprocessError):
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
        return category in ("completed", "done") or (category is None and issue.get("status") == "done")

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
        dep_sha = value.get("sha")
        merge_sha = receipt.get("pr", {}).get("merge_sha")
        sha_includes_task = dep_sha == merge_sha
        if not sha_includes_task and dep_sha and merge_sha:
            with contextlib.suppress(RuntimeError, OSError, subprocess.TimeoutExpired):
                sha_includes_task = subprocess.run(
                    ["git", "merge-base", "--is-ancestor", merge_sha, dep_sha],
                    cwd=self.repo, capture_output=True
                ).returncode == 0
        value["merge_sha_included"] = sha_includes_task
        value["health"] = value.get("status") == "live" and sha_includes_task and health(self.config.get("health_url", ""), dep_sha)
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
        # Объекты app нужны ниже для finalization и merge_in_app.
        base_fetched = self.fetch_matches("refs/heads/app", base)
        # Решение владельца 2026-09-19: ветку не догоняют до app перед merge. Достаточно, что
        # проверенный head совпадает с PR и GitHub подтверждает слияние без конфликтов.
        mergeable = bool(base_fetched and not pr.get("merged") and pr.get("state") == "open"
                         and pr.get("mergeable") is True and pr.get("mergeable_state") != "dirty"
                         and self.fetch_matches(f"refs/pull/{number}/head", sha))
        review_equivalent = self.review_equivalent(review.get("sha"), sha, pr["base"]["sha"], receipt.get("task_id"))
        head_receipt_only = self.head_receipt_only(receipt.get("tested_sha"), sha, receipt.get("task_id"))
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
                 "review": review, "review_completed": selected.get("status") == "completed", "review_trusted": actor == review.get("actor_id") and actor in self.config.get("reviewer_ids", []) and review_approved(content, review.get("sha")),
                 "review_equivalent": review_equivalent, "head_receipt_only": head_receipt_only,
                 "implementer_trusted": implementer.get("status") == "completed" and bool(receipt.get("implementer_id")) and implementer.get("agent_id") == receipt.get("implementer_id"),
                 "files_complete": len(names) == pr.get("changed_files"),
                 "mergeable": mergeable, "merge_in_app": merged,
                 "requires_deploy": requires_deploy, "finalization_sha256": final_hash}
        # Native tool-result связывается с trusted actor/run; HTTP проверяется здесь.
        if requires_deploy:
            facts["deployment"] = self.deployment(receipt)
        return facts

    def cleanup_receipt(self, verified, worktree):
        """Итог для `cleanup.py`: путь worktree из Git и канонический URL PR, если их нет в итоге."""
        receipt = copy.deepcopy(verified)
        receipt["worktree"] = worktree
        pr = receipt.setdefault("pr", {})
        pr.setdefault("url", f"https://github.com/{self.gh_repo}/pull/{pr.get('number')}")
        return receipt

    def cleanup_task(self, verified, state_dir, apply=True):
        root = self.config.get("cleanup_owned_root")
        if not root:
            return {"status": "disabled", "reason": "cleanup_owned_root is not configured"}
        branch = verified.get("branch")
        if not branch:
            return {"status": "skipped", "reason": "receipt has no branch"}
        # Ветка задачи открыта не больше чем в одном worktree; путь из итога может устареть.
        paths = [tree["worktree"] for tree in worktree_cleanup._worktrees(self.repo)
                 if tree.get("branch") == "refs/heads/" + branch]
        if not paths:
            return {"status": "absent", "reason": "no worktree is checked out on the task branch"}
        # Общая рабочая папка Multica тоже лежит в `.worktrees` и может оказаться на ветке задачи.
        protected = {Path(path).resolve() for path in self.config.get("cleanup_protected_worktrees", [])}
        if Path(paths[0]).resolve() in protected:
            return {"status": "skipped", "reason": "worktree is protected by configuration"}
        receipt = self.cleanup_receipt(verified, paths[0])
        provider = CleanupEvidence(self, state_dir, os.environ.get("MULTICA_AGENT_ID"))
        return worktree_cleanup.cleanup(self.repo, receipt, provider, owned_root=root,
                                        log_dir=self.config.get("cleanup_log_dir"), apply=apply)

    def safe_cleanup(self, verified, state_dir, apply=True):
        try:
            return self.cleanup_task(verified, state_dir, apply)
        except Exception as error:
            # Уборка не отменяет Done; текст исключения может содержать URL с credentials.
            return {"status": "skipped", "reason": "cleanup failed: " + type(error).__name__}

    @staticmethod
    def cleanup_attempts(state_dir, value=None):
        """Время последней попытки по задаче: досборка не застревает на одних и тех же итогах."""
        path = Path(state_dir) / "cleanup-attempts.json"
        if value is None:
            try:
                stored = json.loads(path.read_text())
                return stored if isinstance(stored, dict) else {}
            except (OSError, ValueError):
                return {}
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(json.dumps(value, sort_keys=True) + "\n")
        try:
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def cleanup_pending(self, state_dir, limit=3, exclude=(), deadline=None, apply=True):
        """Досборка: принятые итоги, чьи worktree ещё открыты; давно не проверявшиеся первыми."""
        if not self.config.get("cleanup_owned_root"):
            return []
        checked_out = {tree.get("branch") for tree in worktree_cleanup._worktrees(self.repo)}
        candidates = []
        for path in sorted((Path(state_dir) / "verified").glob("*.json")):
            try:
                verified = json.loads(path.read_text())
            except (OSError, ValueError):
                continue
            if (isinstance(verified, dict) and verified.get("verified") is True
                    and verified.get("task_id") not in exclude and "refs/heads/" + str(verified.get("branch")) in checked_out):
                candidates.append(verified)
        if not candidates:
            return []
        if deadline is not None and time.monotonic() >= deadline:
            return [{"status": "deferred", "reason": "cleanup time budget is spent"}]
        # Чужой исполняемый запуск провалит каждую попытку: одна предпроверка вместо полного чтения на итог.
        if apply and not CleanupEvidence(self, state_dir, os.environ.get("MULTICA_AGENT_ID")).fence_ready():
            return [{"status": "deferred", "reason": "dispatch fence is not exclusive now"}]
        attempts = self.cleanup_attempts(state_dir)
        candidates.sort(key=lambda item: attempts.get(item["task_id"], ""))
        results = []
        for verified in candidates[:limit]:
            if deadline is not None and time.monotonic() >= deadline:
                results.append({"status": "deferred", "reason": "cleanup time budget is spent"})
                break
            result = self.safe_cleanup(verified, state_dir, apply)
            results.append({"task_id": verified["task_id"], **result})
            if apply:
                attempts[verified["task_id"]] = dt.datetime.now(dt.timezone.utc).isoformat()
                if result.get("status") == "removed":
                    attempts.pop(verified["task_id"])
                self.cleanup_attempts(state_dir, attempts)
        return results

    def after_done(self, receipt, state_dir):
        """Уборка под тем же dispatch.lock, что и Done; её результат Done не меняет."""
        if not self.config.get("cleanup_owned_root"):
            return {}
        # Done вызывают из Bash-инструмента агента: досборка укладывается в бюджет, остальное — `cleanup`.
        deadline = time.monotonic() + float(self.config.get("cleanup_budget_seconds", 45))
        try:
            verified = json.loads((Path(state_dir) / "verified" / (receipt["task_id"] + ".json")).read_text())
            result = {"cleanup": self.safe_cleanup(verified, state_dir)}
        except (OSError, ValueError) as error:
            result = {"cleanup": {"status": "skipped", "reason": "cleanup failed: " + type(error).__name__}}
        try:
            result["cleanup_pending"] = self.cleanup_pending(state_dir, limit=2, exclude={receipt["task_id"]}, deadline=deadline)
        except Exception as error:
            result["cleanup_pending"] = [{"status": "skipped", "reason": "cleanup failed: " + type(error).__name__}]
        return result

    def cleanup_command(self, state_dir, limit=5, apply=True):
        with lock(Path(state_dir) / "dispatch.lock"):
            return {"ok": True, "phase": "cleanup", "applied": apply,
                    "results": self.cleanup_pending(state_dir, limit=limit, apply=apply)}

    def transition(self, receipt, phase, state_dir):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", receipt.get("task_id", "")):
            raise ValueError("invalid task_id")
        with lock(Path(state_dir) / "dispatch.lock"):
            facts = self.facts(receipt)
            ledger = Ledger(Path(state_dir) / "ledger.sqlite3")
            key = fingerprint({"phase": phase, "task": receipt["task_id"], "sha": receipt["tested_sha"]})
            if phase == "merge" and facts.get("state") == "MERGED" and facts.get("merge_in_app") is True:
                prior = {**facts, "state": "OPEN", "mergeable": True}
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
                    return {"ok": True, "phase": phase, "reconciled": True, "task_id": receipt["task_id"],
                            **self.after_done(receipt, state_dir)}
                # Карточка прочитана под `dispatch.lock` и не в Done: прежний `running` не записал
                # статус. Запись статуса идемпотентна, поэтому повтор идёт в общий бюджет попыток,
                # а не блокирует задачу навсегда. Для merge сверка не доказывает отсутствие действия.
                ledger.release_unapplied(key)
            if not ledger.claim(key):
                return {"ok": False, "blocked": ["duplicate_or_reconciliation_required"]}
            # До внешнего вызова запись running. Неопределённый сбой оставляет её для сверки.
            if phase == "merge":
                # Обычный merge-коммит: проверенный head становится предком app (решение владельца 2026-09-19).
                # `--match-head-commit` сверяет живой head: он равен tested_sha либо отличается
                # от него ровно файлами итога задачи, что validate уже подтвердил.
                command(["gh", "pr", "merge", str(receipt["pr"]["number"]), "--repo", self.gh_repo, "--merge", "--match-head-commit", facts["pr"]["head_sha"]], as_json=False)
            else:
                self.multica("issue", "status", receipt["issue_id"], "done", "--no-start")
                issue = self.multica("issue", "get", receipt["issue_id"])
                if not self.issue_scope(receipt, issue) or not self.issue_done(issue):
                    raise RuntimeError("Done transition could not be confirmed")
            ledger.finish(key, True)
            if phase == "done":
                self.write_verified(receipt, state_dir, ledger.completed_at(key))
                return {"ok": True, "phase": phase, "task_id": receipt["task_id"], **self.after_done(receipt, state_dir)}
            return {"ok": True, "phase": phase, "task_id": receipt["task_id"]}


def main():
    parser = argparse.ArgumentParser()
    # `cleanup` — досборка worktree задач, уже принятых в Done; receipt ей не нужен.
    parser.add_argument("action", choices=["verify", "merge", "done", "cleanup"])
    parser.add_argument("--config", required=True)
    parser.add_argument("--receipt")
    # Готовность к merge и к Done — разные вопросы: `deployment` и `finalization`
    # относятся только к Done. Без выбора фазы отказ Done читается как запрет слияния.
    parser.add_argument("--phase", choices=["merge", "done"], default="done")
    # Пробный прогон уборки по живым доказательствам: что и почему было бы удалено.
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()
    if args.action != "cleanup" and not args.receipt:
        parser.error("--receipt is required for " + args.action)
    config = json.loads(Path(args.config).read_text())
    live = Live(config)
    if args.action == "cleanup":
        result = live.cleanup_command(config["state_dir"], limit=max(args.limit, 1), apply=not args.dry_run)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    receipt = json.loads(Path(args.receipt).read_text())
    if args.action == "verify":
        errors = validate(receipt, live.facts(receipt), args.phase)
        result = {"ok": not errors, "phase": args.phase, "blocked": errors}
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
