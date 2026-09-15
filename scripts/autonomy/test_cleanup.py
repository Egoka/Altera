"""Проверки очистки на настоящих временных Git-репозиториях."""

import contextlib
import copy
import fcntl
import hashlib
import importlib.util
import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

MODULE = Path(__file__).with_name("cleanup.py")
if MODULE.exists():
    spec = importlib.util.spec_from_file_location("autonomy_cleanup", MODULE)
    cleanup_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cleanup_module)
else:
    cleanup_module = None


def git(repo, *args):
    return subprocess.check_output(
        ["git", "-C", str(repo), *args], stderr=subprocess.PIPE, text=True
    ).strip()


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


class LiveEvidence:
    """Граница внешнего I/O: Git в тестах остаётся настоящим."""

    live = True

    def __init__(self, evidence):
        self.evidence = evidence
        self.reads = 0
        self.on_read = None
        self.guarded = False

    @contextlib.contextmanager
    def guard(self, receipt):
        self.guarded = True
        try:
            yield
        finally:
            self.guarded = False

    def read(self, receipt):
        self.reads += 1
        if self.on_read:
            self.on_read(self)
        return copy.deepcopy(self.evidence)


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(cleanup_module, "safe cleanup module is not implemented")
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.repo = self.root / "repository"
        self.repo.mkdir()
        git(self.repo, "init", "-b", "app")
        git(self.repo, "config", "user.name", "Cleanup Test")
        git(self.repo, "config", "user.email", "cleanup@example.invalid")
        git(self.repo, "config", "merge.ff", "true")
        git(self.repo, "config", "commit.gpgsign", "false")
        (self.repo / ".gitignore").write_text("ignored/\n")
        (self.repo / "product.txt").write_text("base\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-m", "base")
        self.base = git(self.repo, "rev-parse", "HEAD")
        self.remote = self.root / "origin.git"
        git(self.repo, "init", "--bare", str(self.remote))
        git(self.repo, "remote", "add", "origin", str(self.remote))
        self.owned = self.root / "owned"
        self.owned.mkdir()
        self.worktree = self.owned / "task"
        self.branch = "codex/finished-task"
        git(self.repo, "worktree", "add", "-b", self.branch, str(self.worktree))
        (self.worktree / "product.txt").write_text("completed feature\n")
        git(self.worktree, "commit", "-am", "feature")
        self.head = git(self.worktree, "rev-parse", "HEAD")
        git(self.repo, "merge", "--squash", self.branch)
        git(self.repo, "commit", "-m", "squash feature")
        self.merge = git(self.repo, "rev-parse", "HEAD")
        git(self.repo, "push", "origin", "app", self.branch)
        self.finalization = self.repo / "docs" / "reports" / "finalization.md"
        self.finalization.parent.mkdir(parents=True)
        self.finalization.write_text("Verified task-1 report for " + self.head + "\n")
        git(self.repo, "add", "docs/reports/finalization.md")
        git(self.repo, "commit", "-m", "finalization report")
        git(self.repo, "push", "origin", "app")
        self.artifact_id = "gitblob:" + git(self.repo, "rev-parse", "origin/app:docs/reports/finalization.md")
        report_hash = hashlib.sha256(self.finalization.read_bytes()).hexdigest()
        self.receipt = {
            "schema_version": 1,
            "task_id": "task-1",
            "tested_sha": self.head,
            "worktree": str(self.worktree),
            "branch": self.branch,
            "pr": {
                "number": 123,
                "head_sha": self.head,
                "base_ref": "app",
                "base_sha": self.base,
                "merge_sha": self.merge,
                "url": "https://github.com/example/project/pull/123",
            },
            "finalization": {"path": "docs/reports/finalization.md", "sha256": report_hash},
        }
        self.evidence = {
            "observed_at": time.time(),
            "complete": True,
            "task": {
                "id": "task-1", "status": "done", "confirmed_done": True,
                "finalized_in_app": True, "receipt_sha256": digest(self.receipt),
                "artifacts": [{"id": self.artifact_id, "sha256": report_hash}],
            },
            "pr": dict(self.receipt["pr"], state="MERGED"),
            "runs": [],
        }
        self.provider = LiveEvidence(self.evidence)
        self.logs = self.root / "cleanup-logs"

    def run_cleanup(self, apply=False):
        return cleanup_module.cleanup(
            self.repo, self.receipt, self.provider, owned_root=self.owned,
            log_dir=self.logs, apply=apply,
        )

    def assert_preserved(self, reason=None, apply=True):
        result = self.run_cleanup(apply=apply)
        self.assertEqual(result["status"], "skipped", result)
        if reason:
            self.assertIn(reason, result["reason"])
        self.assertTrue(self.worktree.exists())
        self.assertEqual(git(self.repo, "rev-parse", self.branch), self.head)
        return result

    def test_dry_run_valid_squash_preserves_worktree_and_refs(self):
        result = self.run_cleanup()
        self.assertEqual(result["status"], "eligible", result)
        self.assertTrue(self.worktree.exists())
        self.assertEqual(git(self.repo, "rev-parse", self.branch), self.head)
        self.assertIn(self.head, git(self.repo, "ls-remote", "origin", self.branch))

    def test_apply_verified_squash_removes_only_owned_worktree_and_refs(self):
        result = self.run_cleanup(apply=True)
        self.assertEqual(result["status"], "removed", result)
        self.assertFalse(self.worktree.exists())
        self.assertEqual(git(self.repo, "branch", "--list", self.branch), "")
        self.assertEqual(git(self.repo, "ls-remote", "origin", self.branch), "")
        self.assertTrue(self.repo.exists())
        self.assertTrue(self.finalization.exists())
        records = [json.loads(line) for line in Path(result["log_path"]).read_text().splitlines()]
        self.assertEqual(records[-1]["status"], "removed")
        self.assertEqual(records[-1]["receipt_sha256"], digest(self.receipt))
        self.assertGreaterEqual(self.provider.reads, 3)

    def test_untracked_report_blocks_cleanup(self):
        (self.worktree / "unsaved-report.md").write_text("evidence")
        self.assert_preserved("dirty")

    def test_ignored_artifacts_block_cleanup(self):
        (self.worktree / "ignored").mkdir()
        (self.worktree / "ignored" / "report.md").write_text("evidence")
        self.assert_preserved("dirty")

    def test_tracked_modification_blocks_cleanup(self):
        (self.worktree / "product.txt").write_text("new work")
        self.assert_preserved("dirty")

    def test_running_or_queued_related_task_blocks_cleanup(self):
        for state in ("running", "queued", "waiting_approval"):
            with self.subTest(state=state):
                self.evidence["runs"] = [{"id": "run-2", "task_id": "task-1", "status": state}]
                self.assert_preserved("active")

    def test_run_matching_branch_or_path_blocks_cleanup(self):
        for match in ({"branch": self.branch}, {"worktree": str(self.worktree)}):
            with self.subTest(match=match):
                self.evidence["runs"] = [dict(match, id="run-2", status="running")]
                self.assert_preserved("active")

    def test_unknown_run_state_or_missing_identity_fails_closed(self):
        self.evidence["runs"] = [{"id": "run-2", "status": "mysterious"}]
        self.assert_preserved("run")

    def test_stale_or_incomplete_evidence_blocks_cleanup(self):
        self.evidence["observed_at"] = time.time() - 301
        self.assert_preserved("stale")
        self.evidence["observed_at"] = time.time()
        self.evidence["complete"] = False
        self.assert_preserved("incomplete")

    def test_done_boolean_cannot_replace_verified_receipt(self):
        self.evidence["task"]["receipt_sha256"] = "wrong"
        self.assert_preserved("receipt")

    def test_finalization_must_be_preserved_in_app_and_on_disk(self):
        self.evidence["task"]["artifacts"] = []
        self.assert_preserved("artifact")
        self.evidence["task"]["artifacts"] = [{"id": self.artifact_id, "sha256": self.receipt["finalization"]["sha256"]}]
        self.finalization.write_text("changed")
        git(self.repo, "commit", "-am", "changed finalization")
        git(self.repo, "push", "origin", "app")
        self.assert_preserved("finalization")

    def test_current_main_or_shared_checkout_is_protected(self):
        self.receipt["worktree"] = str(self.repo)
        self.receipt["branch"] = "app"
        result = self.run_cleanup(apply=True)
        self.assertEqual(result["status"], "skipped", result)
        self.assertTrue(self.repo.exists())

    def test_symlink_or_escaped_path_is_protected(self):
        alias = self.owned / "alias"
        alias.symlink_to(self.worktree, target_is_directory=True)
        self.receipt["worktree"] = str(alias)
        self.assert_preserved("symlink")
        self.receipt["worktree"] = str(self.root / "outside")
        self.assert_preserved("owned")

    def test_squash_with_wrong_actual_diff_is_rejected(self):
        (self.repo / "product.txt").write_text("unrelated change\n")
        git(self.repo, "commit", "-am", "other change")
        wrong_merge = git(self.repo, "rev-parse", "HEAD")
        git(self.repo, "push", "origin", "app")
        self.receipt["pr"]["merge_sha"] = wrong_merge
        self.evidence["pr"]["merge_sha"] = wrong_merge
        self.evidence["task"]["receipt_sha256"] = digest(self.receipt)
        self.assert_preserved("diff")

    def test_pr_merged_but_different_head_is_rejected(self):
        self.evidence["pr"]["head_sha"] = self.base
        self.assert_preserved("PR")

    def test_branch_changed_on_remote_is_not_deleted(self):
        git(self.repo, "push", "--force", "origin", self.merge + ":refs/heads/" + self.branch)
        self.assert_preserved("remote")
        self.assertIn(self.merge, git(self.repo, "ls-remote", "origin", self.branch))

    def test_repeat_check_catches_new_run_before_worktree_removal(self):
        def race(provider):
            if provider.reads == 2:
                self.evidence["runs"] = [{"id": "new", "task_id": "task-1", "status": "queued"}]
        self.provider.on_read = race
        self.assert_preserved("active")

    def test_repeat_check_catches_new_file_before_worktree_removal(self):
        def race(provider):
            if provider.reads == 2:
                (self.worktree / "new-report.md").write_text("new evidence")
        self.provider.on_read = race
        self.assert_preserved("dirty")

    def test_snapshot_cannot_authorize_apply(self):
        self.provider.live = False
        self.assert_preserved("live")

    def test_index_flags_cannot_hide_unsaved_work(self):
        for flag in ("--assume-unchanged", "--skip-worktree"):
            with self.subTest(flag=flag):
                git(self.worktree, "update-index", flag, "product.txt")
                (self.worktree / "product.txt").write_text("hidden unsaved work\n")
                self.assert_preserved("index")
                git(self.worktree, "update-index", "--no-assume-unchanged", "--no-skip-worktree", "product.txt")
                (self.worktree / "product.txt").write_text("completed feature\n")

    def test_remote_change_after_removal_keeps_both_branch_refs(self):
        def race(provider):
            if provider.reads == 3:
                git(self.repo, "push", "--force", "origin", self.merge + ":refs/heads/" + self.branch)
        self.provider.on_read = race
        result = self.run_cleanup(apply=True)
        self.assertEqual(result["status"], "partial", result)
        self.assertFalse(self.worktree.exists())
        self.assertIn(self.merge, git(self.repo, "ls-remote", "origin", self.branch))
        self.assertEqual(git(self.repo, "rev-parse", self.branch), self.head)

    def test_local_change_after_removal_keeps_new_branch(self):
        def race(provider):
            if provider.reads == 3:
                git(self.repo, "update-ref", "refs/heads/" + self.branch, self.merge, self.head)
        self.provider.on_read = race
        result = self.run_cleanup(apply=True)
        self.assertEqual(result["status"], "partial", result)
        self.assertEqual(git(self.repo, "rev-parse", self.branch), self.merge)
        self.assertIn(self.head, git(self.repo, "ls-remote", "origin", self.branch))

    def test_provider_failure_is_logged_and_preserves_worktree(self):
        def failure(provider):
            raise RuntimeError("network unavailable")
        self.provider.on_read = failure
        result = self.assert_preserved()
        self.assertTrue(Path(result["log_path"]).exists())

    def test_repository_lock_prevents_two_cleaners_with_different_log_dirs(self):
        lock = self.repo / ".git" / "autonomy-cleanup.lock"
        with lock.open("w") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assert_preserved("lock")

    def test_log_inside_worktree_is_rejected(self):
        self.logs = self.worktree / "logs"
        self.assert_preserved("log")

    def test_cli_snapshot_default_is_dry_run_and_apply_is_refused(self):
        receipt_path = self.root / "receipt.json"
        activity_path = self.root / "activity.json"
        receipt_path.write_text(json.dumps(self.receipt))
        activity_path.write_text(json.dumps(self.evidence))
        import sys
        command = [sys.executable, str(MODULE), "--repo", str(self.repo),
                   "--owned-root", str(self.owned), "--receipt", str(receipt_path),
                   "--activity-json", str(activity_path), "--log-dir", str(self.logs)]
        check = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(check.returncode, 0, check.stderr + check.stdout)
        self.assertEqual(json.loads(check.stdout)["status"], "eligible")
        apply = subprocess.run(command + ["--apply"], capture_output=True, text=True)
        self.assertEqual(apply.returncode, 2, apply.stderr + apply.stdout)
        self.assertTrue(self.worktree.exists())

    def test_apply_requires_dispatch_fence(self):
        self.provider.guard = None
        self.assert_preserved("fence")

    def test_finalization_uses_origin_app_without_moving_local_app(self):
        git(self.repo, "reset", "--hard", self.base)
        result = self.run_cleanup(apply=True)
        self.assertEqual(result["status"], "removed", result)
        self.assertEqual(git(self.repo, "rev-parse", "app"), self.base)
        self.assertIn("task-1", git(self.repo, "show", "origin/app:docs/reports/finalization.md"))

    def test_git_blob_identity_is_required_for_report_artifact(self):
        self.evidence["task"]["artifacts"][0]["id"] = "arbitrary-id"
        self.assert_preserved("artifact")

    def test_report_cannot_omit_task_and_tested_sha_markers(self):
        self.finalization.write_text("Generic report with no verified task identity\n")
        git(self.repo, "commit", "-am", "unrelated finalization")
        git(self.repo, "push", "origin", "app")
        report_hash = hashlib.sha256(self.finalization.read_bytes()).hexdigest()
        self.receipt["finalization"]["sha256"] = report_hash
        self.evidence["task"]["receipt_sha256"] = digest(self.receipt)
        self.evidence["task"]["artifacts"] = [{"id": "gitblob:" + git(self.repo, "rev-parse", "origin/app:docs/reports/finalization.md"), "sha256": report_hash}]
        self.assert_preserved("finalization")

    def test_finalization_path_cannot_escape_reports_directory(self):
        self.receipt["finalization"]["path"] = "docs/reports/../../product.txt"
        self.evidence["task"]["receipt_sha256"] = digest(self.receipt)
        self.assert_preserved("finalization")

    def test_runtime_gc_reports_unsupported_without_removal(self):
        result = cleanup_module.runtime_gc({"daemon": "multica"}, apply=True)
        self.assertEqual(result["status"], "unsupported")
        self.assertTrue(self.worktree.exists())


if __name__ == "__main__":
    unittest.main()
