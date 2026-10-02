"""Сверка после Done проверяется реальным временным Git, заглушкой sync_status и изолированным GitHub."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

try:
    from . import backlog_sync
except ImportError:
    import backlog_sync


def git(directory, *args):
    return subprocess.run(["git", "-C", str(directory), *args], text=True,
                          capture_output=True, check=True).stdout.strip()


# Заглушка пишет то, что велит STUB_MODE, и сохраняет переданные ей карточки для проверки.
STUB = '''import json, os, sys
from pathlib import Path
root = Path(__file__).resolve().parents[2]
args = sys.argv[1:]
issues = json.loads(Path(args[args.index("--issues-json") + 1]).read_text())
mode = os.environ.get("STUB_MODE", "change")
if mode in ("change", "outside"):
    (root / "docs/backlog/matrix.md").write_text("tasks: " + ",".join(i["identifier"] for i in issues) + "\\n")
if mode == "outside":
    (root / "product.txt").write_text("changed\\n")
if mode == "fail":
    sys.exit(1)
'''


class FakeGithub:
    def __init__(self):
        self.repository = "owner/repo"
        self.prs = {}
        self.closed = []
        self.auto = []
        self.extra_open = []

    def find(self, branch):
        return self.prs.get(branch)

    def publish(self, branch, title, body):
        self.prs[branch] = {"number": 100 + len(self.prs), "state": "OPEN", "title": title, "body": body}
        return self.prs[branch]

    def auto_merge(self, number):
        self.auto.append(number)
        return True

    def open_sync_prs(self):
        rows = [{"number": pr["number"], "headRefName": branch} for branch, pr in self.prs.items() if pr["state"] == "OPEN"]
        return rows + self.extra_open

    def close_superseded(self, number, replacement):
        self.closed.append((number, replacement))
        return True


class BacklogSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / "remote.git"
        self.repo = self.root / "repo"
        subprocess.run(["git", "init", "--bare", str(self.remote)], capture_output=True, check=True)
        git(self.remote, "config", "maintenance.auto", "false")
        subprocess.run(["git", "clone", "--config", "maintenance.auto=false", str(self.remote), str(self.repo)],
                       capture_output=True, check=True)
        git(self.repo, "config", "user.email", "test@example.test")
        git(self.repo, "config", "user.name", "Test")
        git(self.repo, "checkout", "-b", "app")
        (self.repo / "scripts/backlog").mkdir(parents=True)
        (self.repo / "scripts/backlog/sync_status.py").write_text(STUB)
        (self.repo / "docs/backlog").mkdir(parents=True)
        (self.repo / "docs/backlog/matrix.md").write_text("tasks: stale\n")
        (self.repo / "product.txt").write_text("baseline\n")
        # Хук, который упал бы на любом коммите: публикация не должна запускать общие хуки.
        hooks = self.root / "hooks"
        hooks.mkdir()
        (hooks / "pre-commit").write_text("#!/bin/sh\nexit 1\n")
        (hooks / "pre-commit").chmod(0o755)
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-m", "chore: baseline")
        git(self.repo, "push", "origin", "app")
        git(self.repo, "config", "core.hooksPath", str(hooks))
        self.config = {"repo": str(self.repo), "github_repo": "owner/repo", "project_id": "project",
                       "backlog_sync_root": str(self.root / "sync")}
        self.issues = [{"identifier": "ALTE-1", "status": "done"}, {"identifier": "ALTE-2", "status": "done"}]
        self.gh = FakeGithub()
        self.base = git(self.repo, "rev-parse", "app")

    def publish(self, mode="change", task="T-123"):
        with patch.dict(os.environ, {"STUB_MODE": mode}):
            return backlog_sync.publish(self.config, task, self.issues, github=self.gh)

    def assert_no_local_leftovers(self):
        self.assertEqual(git(self.repo, "worktree", "list").count("\n"), 0)
        self.assertEqual(git(self.repo, "branch", "--list", "codex/*"), "")

    def test_changes_are_pushed_as_one_docs_pr_with_auto_merge(self):
        result = self.publish()
        branch = f"codex/backlog-sync-t-123-{self.base[:8]}"
        self.assertEqual(result, {"status": "published", "branch": branch, "pr": 100, "auto_merge": True,
                                  "superseded": []})
        self.assertEqual(self.gh.auto, [100])
        git(self.repo, "fetch", "origin")
        self.assertEqual(git(self.repo, "show", f"origin/{branch}:docs/backlog/matrix.md"), "tasks: ALTE-1,ALTE-2")
        self.assertEqual(git(self.repo, "diff", "--name-only", f"app..origin/{branch}"), "docs/backlog/matrix.md")
        self.assertEqual(git(self.repo, "rev-parse", f"origin/{branch}^"), self.base)
        self.assertIn("T-123", self.gh.prs[branch]["title"])
        self.assert_no_local_leftovers()

    def test_new_sync_closes_older_open_sync_prs_but_not_other_prs(self):
        self.gh.extra_open = [{"number": 7, "headRefName": "codex/backlog-sync-t-100-0000aaaa"}]
        self.publish()
        self.assertEqual(self.gh.closed, [(7, 100)])

    def test_unchanged_backlog_publishes_nothing(self):
        self.assertEqual(self.publish("none"), {"status": "unchanged", "base": self.base})
        self.assertEqual(self.gh.prs, {})
        self.assertEqual(git(self.repo, "ls-remote", "--heads", "origin", "codex/*"), "")
        self.assert_no_local_leftovers()

    def test_changes_outside_backlog_are_never_published(self):
        with self.assertRaises(backlog_sync.PublishError):
            self.publish("outside")
        self.assertEqual(self.gh.prs, {})
        self.assertEqual(git(self.repo, "ls-remote", "--heads", "origin", "codex/*"), "")
        self.assert_no_local_leftovers()

    def test_failed_sync_leaves_no_worktree_or_branch(self):
        with self.assertRaises(backlog_sync.PublishError):
            self.publish("fail")
        self.assert_no_local_leftovers()

    def test_repeated_done_on_same_app_revision_reuses_existing_pr(self):
        first = self.publish()
        second = self.publish()
        self.assertEqual(second, {"status": "exists", "branch": first["branch"], "pr": 100})
        self.assertEqual(len(self.gh.prs), 1)

    def test_invalid_task_id_is_rejected_before_git(self):
        with self.assertRaises(backlog_sync.PublishError):
            self.publish(task="../T-1")
        self.assertFalse((self.root / "sync").exists())


if __name__ == "__main__":
    unittest.main()
