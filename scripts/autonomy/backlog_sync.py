"""Сверка статусов бэклога после Done: docs-PR от свежего `app` с автослиянием GitHub.

Контроллер вызывает `publish` под `dispatch.lock` сразу после Done. Сверку выполняет
`scripts/backlog/sync_status.py` той ревизии `app`, от которой собран PR, по списку карточек,
прочитанному контроллером. CI не ждём: PR сливается автослиянием обычным merge-коммитом по
зелёному `test`. Прежние открытые PR сверки закрываются, потому что новая пересчитана целиком.
"""

import json
from pathlib import Path
import re
import sys
import tempfile

try:
    from .daily_publish import Github, PublishError, changed_paths, command, git
except ImportError:
    from daily_publish import Github, PublishError, changed_paths, command, git

BRANCH_PREFIX = "codex/backlog-sync-"
SCRIPT = "scripts/backlog/sync_status.py"


def owned(path):
    return path.startswith("docs/backlog/")


class SyncGithub(Github):
    def auto_merge(self, number):
        # Сразу после создания PR проверки ещё не завершены, поэтому GitHub принимает `--auto`.
        return command(["gh", "pr", "merge", str(number), "--repo", self.repository, "--auto", "--merge"],
                       check=False).returncode == 0

    def open_sync_prs(self):
        payload = command(["gh", "pr", "list", "--repo", self.repository, "--base", self.base, "--state", "open",
                           "--limit", "100", "--json", "number,headRefName"]).stdout
        return [row for row in json.loads(payload) if row["headRefName"].startswith(BRANCH_PREFIX)]

    def close_superseded(self, number, replacement):
        return command(["gh", "pr", "close", str(number), "--repo", self.repository, "--delete-branch", "--comment",
                        f"Заменён #{replacement}: сверка пересчитана целиком от свежего app."],
                       check=False).returncode == 0


def run_sync(worktree, issues, project, repository):
    """`--apply` скрипта из самой ревизии: правила сверки берутся из того же `app`, что и таблицы."""
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json") as handle:
        json.dump(issues, handle, ensure_ascii=False)
        handle.flush()
        command([sys.executable, str(worktree / SCRIPT), "--apply", "--issues-json", handle.name,
                 "--project", project, "--repo", repository], cwd=worktree)


def commit_and_push(repo, worktree, branch, base, remote, task_id, issues, project, repository):
    """Ветка сверки от `base`; без изменений — ничего не публикуется. Локальный worktree снимается всегда."""
    git(repo, "worktree", "add", "-b", branch, str(worktree), base)
    try:
        run_sync(worktree, issues, project, repository)
        files = changed_paths(worktree)
        if not files:
            return False
        if any(not owned(path) for path in files):
            raise PublishError("Backlog sync changed files outside docs/backlog; nothing published")
        git(worktree, "add", "--", *files)
        git(worktree, "diff", "--cached", "--check")
        # Меняются только docs/backlog, а общие хуки (format, lint, test) требуют node_modules,
        # которых в этом worktree нет; общий config хуков не меняется.
        git(worktree, "-c", "core.hooksPath=/dev/null", "commit", "-m",
            f"docs(backlog): сверка статусов после Done {task_id}")
        git(worktree, "push", remote, f"HEAD:refs/heads/{branch}")
        return True
    finally:
        # Ветка либо уже на remote, либо не нужна: следующая сверка пересчитает всё заново.
        git(repo, "worktree", "remove", "--force", str(worktree), check=False)
        git(repo, "branch", "-D", branch, check=False)


def publish(config, task_id, issues, *, github=None):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", task_id or ""):
        raise PublishError("Invalid task_id")
    remote = config.get("remote", "origin")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", remote):
        raise PublishError("Invalid git remote name")
    repo = Path(config["repo"]).resolve()
    root = Path(config["backlog_sync_root"]).resolve()
    github = github or SyncGithub(config["github_repo"])
    git(repo, "fetch", remote, "refs/heads/app")
    base = git(repo, "rev-parse", "FETCH_HEAD").stdout.strip()
    branch = f"{BRANCH_PREFIX}{task_id.lower()}-{base[:8]}"
    existing = github.find(branch)
    if existing:
        # Повтор Done для той же задачи на той же ревизии app: сверка уже опубликована.
        return {"status": "exists", "branch": branch, "pr": existing["number"]}
    worktree = root / branch.removeprefix(BRANCH_PREFIX)
    if worktree.exists():
        raise PublishError("Backlog sync worktree path already exists; preserved for inspection")
    root.mkdir(parents=True, exist_ok=True)
    if not commit_and_push(repo, worktree, branch, base, remote, task_id, issues, config["project_id"],
                           github.repository):
        return {"status": "unchanged", "base": base}
    title = f"docs(backlog): сверка статусов после Done {task_id}"
    body = (f"Автоматическая сверка `{SCRIPT} --apply` после перевода {task_id} в Done, от `app` `{base[:8]}`: "
            "шапки задач и таблицы `docs/backlog` приведены к Multica, слитым PR и receipt.\n\n"
            "Меняются только файлы `docs/backlog/`. Прежние открытые PR сверки закрываются: эта пересчитана "
            "целиком. Сливается автослиянием обычным merge-коммитом по зелёному `test`.\n")
    pr = github.publish(branch, title, body)
    auto_merge = github.auto_merge(pr["number"])
    superseded = [row["number"] for row in github.open_sync_prs()
                  if row["number"] != pr["number"] and github.close_superseded(row["number"], pr["number"])]
    return {"status": "published", "branch": branch, "pr": pr["number"], "auto_merge": auto_merge,
            "superseded": superseded}
