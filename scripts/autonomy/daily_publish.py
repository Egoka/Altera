"""Один суточный PR через отдельный worktree; без force push и автоматического merge."""

import argparse
from contextlib import contextmanager
import fcntl
import json
from pathlib import Path
import re
import subprocess
import tempfile

try:
    from . import reporting
except ImportError:
    import reporting


class PublishError(RuntimeError):
    pass


def command(args, cwd=None, check=True):
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True, timeout=120)
    if check and result.returncode:
        raise PublishError(f"Command failed: {args[0]} {args[1] if len(args) > 1 else ''} (exit {result.returncode})")
    return result


def git(repo, *args, check=True):
    return command(["git", "-C", str(repo), *args], check=check)


@contextmanager
def lock(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise PublishError("Daily report publisher is already running") from error
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def owned(path):
    return path == "PROGRESS.md" or path.startswith("docs/reports/autonomy/")


def changed_paths(worktree):
    paths = set()
    for args in (("diff", "--name-only", "-z"), ("diff", "--cached", "--name-only", "-z"),
                 ("ls-files", "--others", "--exclude-standard", "-z")):
        paths.update(path for path in git(worktree, *args).stdout.split("\0") if path)
    return sorted(paths)


def ensure_owned_changes(worktree):
    if any(not owned(path) for path in changed_paths(worktree)):
        raise PublishError("Report worktree contains unrelated changes; preserved without modification")


def remote_head(repo, remote, branch):
    lines = git(repo, "ls-remote", "--heads", remote, f"refs/heads/{branch}").stdout.splitlines()
    return lines[0].split()[0] if lines else None


class Github:
    def __init__(self, repository, base="app"):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
            raise PublishError("github_repo must be owner/repository")
        self.repository, self.base = repository, base

    def find(self, branch):
        payload = command(["gh", "pr", "list", "--repo", self.repository, "--base", self.base,
                           "--head", branch, "--state", "all", "--json", "number,state,url,headRefOid"]).stdout
        rows = json.loads(payload)
        if len(rows) > 1:
            raise PublishError("Multiple PRs exist for report branch; refusing ambiguous publication")
        return rows[0] if rows else None

    def publish(self, branch, title, body):
        existing = self.find(branch)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".md") as handle:
            handle.write(body)
            handle.flush()
            if existing:
                if existing["state"] != "OPEN":
                    raise PublishError("Existing report PR is not open")
                command(["gh", "pr", "edit", str(existing["number"]), "--repo", self.repository,
                         "--title", title, "--body-file", handle.name])
            else:
                command(["gh", "pr", "create", "--repo", self.repository, "--base", self.base,
                         "--head", branch, "--title", title, "--body-file", handle.name])
        result = self.find(branch)
        if not result:
            raise PublishError("PR creation could not be confirmed; retry will query the remote")
        return result


def read_report_at(repo, revision, report_date):
    result = git(repo, "show", f"{revision}:docs/reports/autonomy/{report_date}.json", check=False)
    if result.returncode:
        return None
    return json.loads(result.stdout)


def prepare_worktree(repo, worktrees_root, branch, base_sha, remote, initial_remote_head, bypass_hooks=False):
    worktrees_root.mkdir(parents=True, exist_ok=True)
    path = worktrees_root / branch.removeprefix("codex/")
    if not path.resolve().is_relative_to(worktrees_root.resolve()):
        raise PublishError("Report worktree path escapes configured private root")
    records = git(repo, "worktree", "list", "--porcelain").stdout.split("\n\n")
    registered = None
    for record in records:
        fields = dict(line.split(" ", 1) for line in record.splitlines() if " " in line)
        if fields.get("branch") == f"refs/heads/{branch}":
            registered = Path(fields["worktree"]).resolve()
    if registered and registered != path.resolve():
        raise PublishError("Report branch is checked out in another worktree")
    if not registered:
        if path.exists():
            raise PublishError("Report worktree path already exists without the expected branch")
        local = git(repo, "show-ref", "--verify", "--quiet", f"refs/heads/{branch}", check=False).returncode == 0
        if local:
            git(repo, "worktree", "add", str(path), branch)
        else:
            start = base_sha
            if initial_remote_head:
                git(repo, "fetch", remote, f"refs/heads/{branch}")
                start = initial_remote_head
            git(repo, "worktree", "add", "-b", branch, str(path), start)
    if git(path, "branch", "--show-current").stdout.strip() != branch:
        raise PublishError("Unexpected report worktree branch")
    if git(path, "rev-parse", "--verify", "MERGE_HEAD", check=False).returncode == 0:
        raise PublishError("Report worktree has an unfinished merge; preserved for reconciliation")
    ensure_owned_changes(path)
    if initial_remote_head:
        git(repo, "fetch", remote, f"refs/heads/{branch}")
        if git(path, "merge-base", "--is-ancestor", initial_remote_head, "HEAD", check=False).returncode:
            raise PublishError("Remote report head advanced independently; refusing to overwrite it")
    ancestor = git(path, "merge-base", base_sha, "HEAD").stdout.strip()
    committed = git(path, "diff", "--name-only", "-z", f"{ancestor}..HEAD").stdout.split("\0")
    if any(name and not owned(name) for name in committed):
        raise PublishError("Report branch contains unrelated committed changes")
    if git(path, "merge-base", "--is-ancestor", base_sha, "HEAD", check=False).returncode:
        if changed_paths(path):
            raise PublishError("App advanced while report worktree has uncommitted changes; preserved without merge")
        merged = git(path, "merge", "--no-commit", "--no-ff", base_sha, check=False)
        if merged.returncode:
            conflicts = [name for name in git(path, "diff", "--name-only", "--diff-filter=U", "-z").stdout.split("\0") if name]
            derived = {"PROGRESS.md", "docs/reports/autonomy/periods.json"}
            if not conflicts or any(name not in derived for name in conflicts):
                git(path, "merge", "--abort", check=False)
                raise PublishError("App merge conflicts with source reports; merge aborted, changes preserved")
            # Оба индекса будут пересчитаны из объединённых канонических суточных JSON.
            git(path, "checkout", "--theirs", "--", *conflicts)
            git(path, "add", "--", *conflicts)
        git(path, "diff", "--cached", "--check")
        hook_args = ["-c", "core.hooksPath=/dev/null"] if bypass_hooks else []
        git(path, *hook_args, "commit", "-m", "chore(autonomy): sync app for daily report")
    return path


def run(config, report_date, snapshot=None, *, github=None):
    reporting.day_window(report_date)
    repo = Path(config["repo"]).resolve()
    state = Path(config["state_dir"]).resolve()
    worktrees_root = Path(config.get("reports_worktree_root", repo / ".worktrees/autonomy-reports")).resolve()
    if state == worktrees_root or state.is_relative_to(worktrees_root):
        raise PublishError("Controller state and publisher lock must be outside report worktrees")
    remote, base = config.get("remote", "origin"), "app"
    formatter = config.get("report_formatter")
    if formatter and (not isinstance(formatter, list) or not all(isinstance(arg, str) for arg in formatter)):
        raise PublishError("report_formatter must be an argv array")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", remote):
        raise PublishError("Invalid git remote name")
    github = github or Github(config["github_repo"], base)
    with lock(state / "daily-report.lock"):
        if snapshot is None:
            snapshot = reporting.collect_live(config["multica"], config["server_url"], config["workspace_id"],
                                              config["project_id"], config["github_repo"],
                                              maintenance_autopilot_ids=config.get("maintenance_autopilot_ids", []))
            receipts_dir = Path(config.get("receipts_dir", state / "verified"))
            if receipts_dir.exists():
                snapshot["receipts"] = reporting.load_controller_receipts(receipts_dir)
        desired = reporting.build_report(snapshot, report_date)
        digest = reporting.content_digest(desired)
        git(repo, "fetch", remote, f"refs/heads/{base}")
        base_sha = git(repo, "rev-parse", "FETCH_HEAD").stdout.strip()
        branch = f"codex/autonomy-report-{report_date}"
        existing = github.find(branch)
        if existing and existing["state"] == "MERGED":
            current = read_report_at(repo, base_sha, report_date)
            if current and reporting.content_digest(current) == digest:
                return {"status": "unchanged", "branch": branch, "pr": existing}
            branch += f"-correction-{digest[:12]}"
            correction = github.find(branch)
            if correction and correction["state"] == "MERGED":
                current = read_report_at(repo, base_sha, report_date)
                if current and reporting.content_digest(current) == digest:
                    return {"status": "unchanged", "branch": branch, "pr": correction}
                raise PublishError("Merged correction differs from current app; explicit reconciliation required")
        elif existing and existing["state"] != "OPEN":
            raise PublishError("Daily PR was closed without merge; refusing a duplicate")
        initial_remote_head = remote_head(repo, remote, branch)
        worktree = prepare_worktree(repo, worktrees_root, branch, base_sha, remote, initial_remote_head,
                                    bypass_hooks=bool(formatter))
        reporting.publish(snapshot, report_date, worktree)
        ensure_owned_changes(worktree)
        files = changed_paths(worktree)
        if formatter and files:
            existing_files = [str(worktree / name) for name in files if (worktree / name).is_file()]
            if existing_files:
                command([*formatter, *existing_files], cwd=worktree)
        ensure_owned_changes(worktree)
        files = changed_paths(worktree)
        if files:
            git(worktree, "diff", "--check")
            git(worktree, "add", "--", *files)
            git(worktree, "diff", "--cached", "--check")
            # Только локальный docs commit после scoped formatter; общий config hooks не меняется.
            hook_args = ["-c", "core.hooksPath=/dev/null"] if formatter else []
            git(worktree, *hook_args, "commit", "-m", f"docs(autonomy): report {report_date}")
        current_remote_head = remote_head(repo, remote, branch)
        if current_remote_head != initial_remote_head:
            raise PublishError("Remote report head changed during publication; local commit preserved")
        head = git(worktree, "rev-parse", "HEAD").stdout.strip()
        if head != current_remote_head:
            git(worktree, "push", remote, f"HEAD:refs/heads/{branch}")
        title = f"docs(autonomy): report {report_date}"
        body = (f"Суточный аудит за {report_date}: подтверждённые результаты, качество, delivery и usage с полнотой источников.\n\n"
                f"Обновлены PROGRESS, машинный отчёт и агрегаты 7/30 суток. Content SHA-256: `{digest}`.\n\n"
                "Срез собран read-only; неизвестные значения и ограничения сохранены в отчёте. Исправленные версии находятся в .history.\n\n"
                "Локально проверены scope PROGRESS/docs/reports/autonomy и git diff --check. "
                + ("Применён configured report_formatter; repo-wide hooks обойдены только для этого docs commit. " if formatter else "")
                + "Полные проверки CI остаются обязательными перед merge.\n")
        pr = github.publish(branch, title, body)
        return {"status": "published", "branch": branch, "worktree": str(worktree), "head": head, "pr": pr}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--date", required=True)
    parser.add_argument("--snapshot", type=Path)
    args = parser.parse_args(argv)
    config = json.loads(args.config.read_text())
    snapshot = json.loads(args.snapshot.read_text()) if args.snapshot else None
    print(json.dumps(run(config, args.date, snapshot), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
