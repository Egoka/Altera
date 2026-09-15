"""Публикация проверяется реальным временным Git и изолированным GitHub adapter."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import sys

try:
    from . import daily_publish
except ImportError:
    import daily_publish


def git(directory, *args):
    return subprocess.run(["git", "-C", str(directory), *args], text=True,
                          capture_output=True, check=True).stdout.strip()


class FakeGithub:
    def __init__(self):
        self.prs = {}
        self.created = 0
        self.crash_after_create = False

    def find(self, branch):
        return self.prs.get(branch)

    def publish(self, branch, title, body):
        if branch not in self.prs:
            self.created += 1
            self.prs[branch] = {"number": self.created, "state": "OPEN", "url": "https://example.test/pr/1"}
        if self.crash_after_create:
            self.crash_after_create = False
            raise RuntimeError("simulated response loss after PR creation")
        return self.prs[branch]


class DailyPublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.remote = self.root / "remote.git"
        self.repo = self.root / "repo"
        subprocess.run(["git", "init", "--bare", str(self.remote)], capture_output=True, check=True)
        subprocess.run(["git", "clone", str(self.remote), str(self.repo)], capture_output=True, check=True)
        git(self.repo, "config", "user.email", "test@example.test")
        git(self.repo, "config", "user.name", "Test")
        git(self.repo, "checkout", "-b", "app")
        (self.repo / "product.txt").write_text("baseline\n")
        git(self.repo, "add", "product.txt")
        git(self.repo, "commit", "-m", "chore: baseline")
        git(self.repo, "push", "origin", "app")
        self.config = {"repo": str(self.repo), "github_repo": "owner/repo", "state_dir": str(self.root / "state"),
                       "reports_worktree_root": str(self.root / "reports")}
        self.snapshot = {"schema_version": 1, "collected_at": "2026-09-15T08:00:00Z",
                         "coverage": {}, "issues": [], "executions": [], "receipts": []}
        self.gh = FakeGithub()

    def tearDown(self):
        self.temp.cleanup()

    def test_crash_after_pr_creation_reuses_remote_branch_and_existing_pr(self):
        self.gh.crash_after_create = True
        with self.assertRaises(RuntimeError):
            daily_publish.run(self.config, "2026-09-15", self.snapshot, github=self.gh)
        result = daily_publish.run(self.config, "2026-09-15", self.snapshot, github=self.gh)
        self.assertEqual(self.gh.created, 1)
        self.assertEqual(result["pr"]["number"], 1)
        self.assertEqual(git(self.repo, "branch", "--show-current"), "app")
        self.assertFalse((self.repo / "PROGRESS.md").exists())
        self.assertEqual(git(self.repo, "rev-list", "--count", "app..codex/autonomy-report-2026-09-15"), "1")

    def test_dirty_product_file_in_report_worktree_is_preserved_and_blocks_publish(self):
        result = daily_publish.run(self.config, "2026-09-15", self.snapshot, github=self.gh)
        worktree = Path(result["worktree"])
        (worktree / "product.txt").write_text("someone else's change\n")
        with self.assertRaises(daily_publish.PublishError):
            daily_publish.run(self.config, "2026-09-15", self.snapshot, github=self.gh)
        self.assertEqual((worktree / "product.txt").read_text(), "someone else's change\n")

    def test_remote_head_advanced_by_other_writer_is_not_overwritten(self):
        result = daily_publish.run(self.config, "2026-09-15", self.snapshot, github=self.gh)
        other = self.root / "other"
        subprocess.run(["git", "clone", "--branch", result["branch"], str(self.remote), str(other)],
                       capture_output=True, check=True)
        git(other, "config", "user.email", "other@example.test")
        git(other, "config", "user.name", "Other")
        (other / "product.txt").write_text("remote change\n")
        git(other, "commit", "-am", "fix: someone else")
        git(other, "push", "origin", result["branch"])
        remote_head = git(other, "rev-parse", "HEAD")
        with self.assertRaises(daily_publish.PublishError):
            daily_publish.run(self.config, "2026-09-15", self.snapshot, github=self.gh)
        self.assertIn(remote_head, git(self.repo, "ls-remote", "--heads", "origin", result["branch"]))

    def test_merged_same_content_is_noop_and_late_data_creates_one_correction_pr(self):
        first = daily_publish.run(self.config, "2026-09-15", self.snapshot, github=self.gh)
        git(self.repo, "merge", "--ff-only", first["branch"])
        git(self.repo, "push", "origin", "app")
        self.gh.prs[first["branch"]]["state"] = "MERGED"
        same = daily_publish.run(self.config, "2026-09-15", self.snapshot, github=self.gh)
        self.assertEqual(same["status"], "unchanged")
        corrected = {**self.snapshot, "collected_at": "2026-09-15T09:00:00Z",
                     "executions": [{"id": "late", "created_at": "2026-09-14T09:00:00Z"}]}
        second = daily_publish.run(self.config, "2026-09-15", corrected, github=self.gh)
        again = daily_publish.run(self.config, "2026-09-15",
                                  {**corrected, "collected_at": "2026-09-15T09:01:00Z"}, github=self.gh)
        self.assertIn("-correction-", second["branch"])
        self.assertEqual(second["branch"], again["branch"])
        self.assertEqual(self.gh.created, 2)

    def test_collection_timestamp_only_does_not_create_correction_pr(self):
        first = daily_publish.run(self.config, "2026-09-15", self.snapshot, github=self.gh)
        git(self.repo, "merge", "--ff-only", first["branch"])
        git(self.repo, "push", "origin", "app")
        self.gh.prs[first["branch"]]["state"] = "MERGED"
        for observed_at in ("2026-09-15T09:00:00Z", "2026-09-15T09:01:00Z"):
            result = daily_publish.run(self.config, "2026-09-15",
                                       {**self.snapshot, "collected_at": observed_at}, github=self.gh)
            self.assertEqual(result["status"], "unchanged")
        self.assertEqual(self.gh.created, 1)

    def test_open_report_retry_preserves_newer_app_reports_and_rebuilds_index(self):
        first = daily_publish.run(self.config, "2026-09-15", self.snapshot, github=self.gh)
        daily_publish.reporting.publish(self.snapshot, "2026-09-16", self.repo)
        git(self.repo, "add", "PROGRESS.md", "docs/reports/autonomy")
        git(self.repo, "commit", "-m", "docs(autonomy): report next day")
        git(self.repo, "push", "origin", "app")
        current_app = git(self.repo, "rev-parse", "HEAD")
        second = daily_publish.run(self.config, "2026-09-15", self.snapshot, github=self.gh)
        worktree = Path(second["worktree"])
        self.assertTrue((worktree / "docs/reports/autonomy/2026-09-16.json").exists())
        progress = (worktree / "PROGRESS.md").read_text()
        self.assertIn("2026-09-15", progress)
        self.assertIn("2026-09-16", progress)
        self.assertEqual(json.loads((worktree / "docs/reports/autonomy/periods.json").read_text())["7"]["covered_days"], 2)
        git(worktree, "merge-base", "--is-ancestor", current_app, "HEAD")
        self.assertEqual(first["branch"], second["branch"])
        self.assertEqual(self.gh.created, 1)

    def test_scoped_formatted_report_commit_does_not_run_repo_wide_hooks(self):
        hooks = self.root / "hooks"
        hooks.mkdir()
        hook = hooks / "pre-commit"
        hook.write_text("#!/bin/sh\nexit 91\n")
        hook.chmod(0o755)
        git(self.repo, "config", "core.hooksPath", str(hooks))
        self.config["report_formatter"] = [sys.executable, "-c", "import sys; assert all(p.endswith(('.md','.json')) for p in sys.argv[1:])"]
        result = daily_publish.run(self.config, "2026-09-15", self.snapshot, github=self.gh)
        self.assertEqual(result["status"], "published")
        self.assertEqual(git(self.repo, "config", "--get", "core.hooksPath"), str(hooks))
        changed = git(Path(result["worktree"]), "diff", "--name-only", "app..HEAD").splitlines()
        self.assertTrue(all(path == "PROGRESS.md" or path.startswith("docs/reports/autonomy/") for path in changed))


if __name__ == "__main__":
    unittest.main()
