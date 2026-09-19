"""Консервативная очистка завершённой работы; внешние доказательства даёт адаптер."""

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time


class Ineligible(Exception):
    """Недостаточно доказательств для безопасного удаления."""


def canonical_hash(value):
    return hashlib.sha256(json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()).hexdigest()


def _git_bytes(repo, *args):
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True,
        timeout=60, env=dict(os.environ, GIT_TERMINAL_PROMPT="0"),
    )
    if result.returncode:
        # stderr может содержать URL с токеном; сохраняем только название операции.
        raise Ineligible("git operation failed: " + args[0])
    return result.stdout


def _git(repo, *args):
    return _git_bytes(repo, *args).decode().strip()


def _under(path, parent):
    return path == parent or parent in path.parents


def _plain_path(value):
    path = Path(value).absolute()
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise Ineligible("symlink path is protected")
    return path.resolve()


def _worktrees(repo):
    output = _git(repo, "worktree", "list", "--porcelain", "-z")
    trees = []
    item = {}
    for field in output.split("\0"):
        if not field:
            if item:
                trees.append(item)
                item = {}
        else:
            key, _, value = field.partition(" ")
            item[key] = value
    if item:
        trees.append(item)
    return trees


def _remote_head(repo, remote, branch):
    ref = "refs/heads/" + branch
    lines = _git(repo, "ls-remote", "--heads", remote, ref).splitlines()
    if not lines:
        return None
    if len(lines) != 1 or lines[0].split()[1] != ref:
        raise Ineligible("ambiguous remote branch")
    return lines[0].split()[0]


def _validate_identity(repo, receipt, owned_root, require_worktree):
    target = _plain_path(receipt["worktree"])
    root = _plain_path(owned_root)
    branch = receipt["branch"]
    if not _under(target, root) or target == root:
        raise Ineligible("worktree is outside owned root")
    if branch in {"app", "main", "master", "develop", "dev"}:
        raise Ineligible("protected branch")
    _git(repo, "check-ref-format", "--branch", branch)
    trees = _worktrees(repo)
    main = Path(trees[0]["worktree"]).resolve()
    if target == main or _under(repo, target) or _under(Path.cwd().resolve(), target):
        raise Ineligible("current, main or shared checkout is protected")
    matching = [tree for tree in trees if Path(tree["worktree"]).resolve() == target]
    if require_worktree:
        if len(matching) != 1 or matching[0].get("branch") != "refs/heads/" + branch:
            raise Ineligible("worktree branch identity does not match")
        if "locked" in matching[0] or "prunable" in matching[0]:
            raise Ineligible("worktree is locked or prunable")
    elif matching or target.exists():
        raise Ineligible("worktree reappeared during cleanup")
    if any(tree.get("branch") == "refs/heads/" + branch and
           Path(tree["worktree"]).resolve() != target for tree in trees):
        raise Ineligible("branch is checked out elsewhere")
    return target


def _validate_evidence(receipt, evidence, max_age, artifact_id=None):
    observed = evidence.get("observed_at")
    if not isinstance(observed, (int, float)) or not 0 <= time.time() - observed <= max_age:
        raise Ineligible("stale or future external evidence")
    if evidence.get("complete") is not True or not isinstance(evidence.get("runs"), list):
        raise Ineligible("incomplete activity inventory")
    task = evidence.get("task", {})
    if (task.get("id") != receipt["task_id"] or task.get("status") != "done"
            or task.get("confirmed_done") is not True or task.get("finalized_in_app") is not True):
        raise Ineligible("task has no confirmed Done and app finalization")
    if task.get("receipt_sha256") != canonical_hash(receipt):
        raise Ineligible("verified receipt hash does not match")
    report = receipt["finalization"]
    if not any(item.get("id") and (artifact_id is None or item["id"] == artifact_id)
               and item.get("sha256") == report["sha256"]
               for item in task.get("artifacts", [])):
        raise Ineligible("app artifact does not preserve finalization hash")
    pr = evidence.get("pr", {})
    if pr.get("state") != "MERGED" or any(
        pr.get(key) != receipt["pr"].get(key)
        for key in ("number", "head_sha", "base_ref", "base_sha", "merge_sha", "url")
    ):
        raise Ineligible("live PR identity or merged state does not match")
    terminal = {"completed", "succeeded", "failed", "cancelled", "canceled"}
    active = {"running", "queued", "pending", "starting", "waiting", "waiting_approval", "blocked"}
    for run in evidence["runs"]:
        status = run.get("status")
        if status in terminal:
            continue
        if status not in active:
            raise Ineligible("unknown run state")
        associations = [run.get("task_id"), run.get("branch"), run.get("worktree")]
        if not any(associations):
            raise Ineligible("active run has unknown ownership")
        if (run.get("task_id") == receipt["task_id"] or run.get("branch") == receipt["branch"]
                or (run.get("worktree") and
                    _under(Path(run["worktree"]).resolve(), Path(receipt["worktree"]).resolve()))):
            raise Ineligible("active or queued run owns the task, branch or worktree")
        if not all(associations):
            raise Ineligible("active run ownership inventory is incomplete")


def _finalization(repo, receipt, remote):
    path = receipt["finalization"]["path"]
    if (not isinstance(path, str) or not path.startswith("docs/reports/") or
            ".." in Path(path).parts or Path(path).is_absolute() or "\\" in path):
        raise Ineligible("finalization must use a repository-relative docs/reports path")
    ref = "refs/remotes/" + remote + "/app:" + path
    try:
        content = _git_bytes(repo, "show", ref)
        blob = _git(repo, "rev-parse", ref)
        if _git(repo, "cat-file", "-t", blob) != "blob":
            raise Ineligible("finalization is not a Git blob")
    except Ineligible as exc:
        raise Ineligible("finalization is not preserved in origin/app") from exc
    if hashlib.sha256(content).hexdigest() != receipt["finalization"]["sha256"]:
        raise Ineligible("finalization content hash differs")
    if receipt["task_id"].encode() not in content or receipt["tested_sha"].encode() not in content:
        raise Ineligible("finalization lacks task_id or tested_sha marker")
    return "gitblob:" + blob


def _validate_git(repo, receipt, target, remote, require_worktree):
    pr = receipt["pr"]
    head = pr["head_sha"]
    for value in (head, pr["base_sha"], pr["merge_sha"], receipt["tested_sha"]):
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", value):
            raise Ineligible("invalid commit identity")
    if receipt["tested_sha"] != head:
        raise Ineligible("tested SHA differs from PR head")
    if pr["base_ref"] != "app":
        raise Ineligible("PR was not merged into app")
    if _git(repo, "rev-parse", "refs/heads/" + receipt["branch"]) != head:
        raise Ineligible("local branch head changed")
    remote_head = _remote_head(repo, remote, receipt["branch"])
    if remote_head not in (None, head):
        raise Ineligible("remote branch head changed")
    # Доверенное live PR evidence связывает SHA с сервером. Git проверяет сами объекты.
    _git(repo, "merge-base", "--is-ancestor", pr["base_sha"], head)
    _git(repo, "merge-base", "--is-ancestor", pr["merge_sha"], "refs/remotes/" + remote + "/app")
    parents = _git(repo, "rev-list", "--parents", "-n", "1", pr["merge_sha"]).split()[1:]
    if len(parents) not in (1, 2):
        raise Ineligible("unsupported merge shape")
    if len(parents) == 2 and parents[1] != head:
        raise Ineligible("merge parent is not verified PR head")
    before = pr["base_sha"]
    # Полный binary diff сохраняет пути, режимы, удаления и точное содержимое.
    flags = ("--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-renames")
    feature_diff = _git(repo, "diff", *flags, before, head, "--")
    merged_diff = _git(repo, "diff", *flags, parents[0], pr["merge_sha"], "--")
    if not feature_diff or feature_diff != merged_diff:
        raise Ineligible("actual PR diff and merged diff differ or are empty")
    if require_worktree:
        if _git(target, "rev-parse", "HEAD") != head:
            raise Ineligible("worktree head changed")
        entries = _git(target, "ls-files", "-v", "-z").split("\0")
        if any(item and (item[0].islower() or item[0] == "S") for item in entries):
            raise Ineligible("index flags can hide unsaved files")
        if _git(target, "status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"):
            raise Ineligible("dirty worktree includes tracked, untracked or ignored artifacts")
        if (target / ".gitmodules").exists():
            raise Ineligible("submodule worktrees require separate proof")
    return remote_head


@contextlib.contextmanager
def _lock(path):
    path = _plain_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise Ineligible("cleanup lock is held") from exc
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _append_log(path, record):
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "a") as handle:
        handle.write(json.dumps(record, sort_keys=True, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    directory_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def cleanup(repo, receipt, evidence_provider, *, owned_root, log_dir=None,
            apply=False, remote="origin", max_age=60):
    """Проверить/удалить worktree. Для apply provider.live и guard обязательны.

    read(receipt) возвращает нормализованные живые доказательства; guard(receipt)
    запрещает новые dispatch на весь период удаления. JSON-снимок годится для dry-run.
    """
    result = {"status": "skipped", "applied": False, "actions": [], "runtime_gc": runtime_gc({})}
    log_path = None
    try:
        repo = _plain_path(repo)
        if receipt.get("schema_version") != 1:
            raise Ineligible("unsupported receipt schema")
        target = _validate_identity(repo, receipt, owned_root, True)
        common = Path(_git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")).resolve()
        logs = _plain_path(log_dir or common.parent.parent / ".autonomy-cleanup" / common.parent.name)
        if any(_under(logs, Path(tree["worktree"]).resolve()) for tree in _worktrees(repo)):
            raise Ineligible("cleanup log must be outside every worktree")
        logs.mkdir(parents=True, exist_ok=True)
        log_path = logs / "cleanup.jsonl"
        result.update({"log_path": str(log_path), "task_id": receipt["task_id"],
                       "receipt_sha256": canonical_hash(receipt), "worktree": str(target),
                       "branch": receipt["branch"], "head_sha": receipt["pr"]["head_sha"],
                       "finalization_sha256": receipt["finalization"]["sha256"],
                       "pr_number": receipt["pr"]["number"], "merge_sha": receipt["pr"]["merge_sha"]})
        if apply and not getattr(evidence_provider, "live", False):
            raise Ineligible("apply requires live external proof; snapshot is dry-run only")
        if apply and not callable(getattr(evidence_provider, "guard", None)):
            raise Ineligible("apply requires a dispatch fence")
        if not 0 < max_age <= 60:
            raise Ineligible("evidence freshness must be between 0 and 60 seconds")
        evidence = evidence_provider.read(receipt)
        _validate_evidence(receipt, evidence, max_age)
        artifact_id = _finalization(repo, receipt, remote)
        _validate_evidence(receipt, evidence, max_age, artifact_id)
        result["finalization_artifact_id"] = artifact_id
        remote_head = _validate_git(repo, receipt, target, remote, True)
        result["evidence_sha256"] = canonical_hash(evidence)
        if not apply:
            result.update(status="eligible", reason="all snapshot and Git checks passed; dry-run")
        else:
            with _lock(common / "autonomy-cleanup.lock"), evidence_provider.guard(receipt):
                # Повторный запрос под общей с dispatch блокировкой ловит смену состояния.
                evidence = evidence_provider.read(receipt)
                _validate_evidence(receipt, evidence, max_age, artifact_id)
                _validate_identity(repo, receipt, owned_root, True)
                if _finalization(repo, receipt, remote) != artifact_id:
                    raise Ineligible("finalization changed before removal")
                remote_head = _validate_git(repo, receipt, target, remote, True)
                _validate_evidence(receipt, evidence, max_age, artifact_id)
                result["evidence_sha256"] = canonical_hash(evidence)
                # Запись намерения обязательна до первого необратимого действия.
                _append_log(log_path, dict(result, status="removing", timestamp=time.time()))
                _git(repo, "worktree", "remove", str(target))
                result["actions"].append("worktree_removed")
                result["applied"] = True
                evidence = evidence_provider.read(receipt)
                _validate_evidence(receipt, evidence, max_age, artifact_id)
                _validate_identity(repo, receipt, owned_root, False)
                if _finalization(repo, receipt, remote) != artifact_id:
                    raise Ineligible("finalization changed after worktree removal")
                current_remote = _validate_git(repo, receipt, target, remote, False)
                _validate_evidence(receipt, evidence, max_age)
                # Remote-ветка остаётся на origin (решение владельца 2026-09-19), но её смена —
                # признак новой работы, поэтому локальная ветка тогда сохраняется.
                if current_remote != remote_head:
                    raise Ineligible("remote branch changed after worktree removal")
                # update-ref поддерживает CAS и корректен для подтверждённого merge-коммита и squash.
                _validate_identity(repo, receipt, owned_root, False)
                _git(repo, "update-ref", "-d", "refs/heads/" + receipt["branch"], receipt["pr"]["head_sha"])
                result["actions"].append("local_branch_deleted")
                result.update(status="removed", reason="verified worktree and local branch ref removed; remote branch kept")
    except Ineligible as exc:
        result.update(status="partial" if result["applied"] else "skipped", reason=str(exc))
    except Exception as exc:
        # Исключения адаптера могут содержать секреты в URL/заголовках.
        result.update(status="partial" if result["applied"] else "skipped",
                      reason="cleanup check failed: " + type(exc).__name__)
    if log_path:
        try:
            _append_log(log_path, dict(result, timestamp=time.time()))
        except OSError:
            result.update(status="partial" if result["applied"] else "skipped",
                          reason="durable cleanup log could not be written")
    return result


def runtime_gc(evidence, *, apply=False):
    """Native runtime GC запускает только подтверждённый механизм самого daemon."""
    return {"status": "unsupported", "reason": "native daemon GC adapter is not configured; no runtime artifacts deleted"}


class SnapshotEvidence:
    live = False

    def __init__(self, path):
        self.path = Path(path)

    def read(self, receipt):
        return json.loads(self.path.read_text())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--owned-root", required=True)
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--activity-json", required=True)
    parser.add_argument("--log-dir")
    parser.add_argument("--apply", action="store_true", help="requires live provider; snapshots cannot authorize apply")
    args = parser.parse_args(argv)
    receipt = json.loads(Path(args.receipt).read_text())
    result = cleanup(args.repo, receipt, SnapshotEvidence(args.activity_json),
                     owned_root=args.owned_root, log_dir=args.log_dir, apply=args.apply)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] in {"eligible", "removed"} else 2


if __name__ == "__main__":
    raise SystemExit(main())
