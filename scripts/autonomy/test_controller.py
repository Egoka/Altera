"""Проверки контракта завершения и подавления повторных событий."""
import copy
import json
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

import controller as c


class CompletionTests(unittest.TestCase):
    def setUp(self):
        self.receipt = {
            "schema_version": 1, "task_id": "T-123", "source": {"path": "docs/backlog/tasks/T-123.md", "sha": "a" * 40},
            "issue_id": "issue-123",
            "baseline_sha": "a" * 40, "tested_sha": "b" * 40, "implementer_id": "developer", "implementer_run_id": "run-d",
            "criteria": [{"id": "AC1", "status": "passed", "evidence": "ci:123"}],
            "pr": {"number": 123, "head_sha": "b" * 40, "base_sha": "a" * 40, "base_ref": "app", "merge_sha": "c" * 40},
            "review": {"actor_id": "reviewer", "run_id": "run-r", "sha": "b" * 40, "verdict": "approved"},
            "deployment": {"required": False, "reason": "Документация"},
            "finalization": {"path": "docs/reports/tasks/T-123.md", "sha256": "d" * 64}}
        self.facts = {"pr": copy.deepcopy(self.receipt["pr"]), "state": "MERGED", "ci": {"sha": "b" * 40, "passed": True},
                      "review": copy.deepcopy(self.receipt["review"]), "review_completed": True, "review_trusted": True,
                      "merge_in_app": True, "finalization_sha256": "d" * 64, "requires_deploy": False,
                      "base_current": True, "implementer_trusted": True, "files_complete": True, "issue_scope_valid": True}

    def test_missing_implementer_and_incomplete_diff_reject(self):
        self.facts["implementer_trusted"] = False
        self.assertIn("review", c.validate(self.receipt, self.facts))
        self.facts["files_complete"] = False
        self.assertIn("pr_files", c.validate(self.receipt, self.facts))

    def test_review_marker_must_be_final_and_exact(self):
        marker = 'ALTERA_REVIEW_V1 {"sha": "' + 'b' * 40 + '", "verdict": "approved"}'
        self.assertTrue(c.review_approved(marker, 'b' * 40))
        self.assertFalse(c.review_approved(marker + '\nActually rejected', 'b' * 40))

    def test_complete_chain_accepted(self):
        self.assertEqual(c.validate(self.receipt, self.facts), [])

    def test_unknown_or_wrong_issue_scope_blocks_merge_and_done(self):
        for phase in ("merge", "done"):
            with self.subTest(phase=phase):
                facts = {**self.facts, "issue_scope_valid": False}
                self.assertIn("issue_scope", c.validate(self.receipt, facts, phase))

    def test_wrong_sha_missing_review_and_unsynced_report_block(self):
        for key, value, expected in [("ci", {"sha": "a" * 40, "passed": True}, "ci"),
                                     ("review_completed", False, "review"),
                                     ("finalization_sha256", None, "finalization")]:
            with self.subTest(key=key):
                facts = copy.deepcopy(self.facts); facts[key] = value
                self.assertIn(expected, c.validate(self.receipt, facts))

    def test_self_review_and_untrusted_review_block(self):
        self.receipt["review"]["actor_id"] = "developer"
        self.facts["review"] = self.receipt["review"]
        self.assertIn("review", c.validate(self.receipt, self.facts))

    def test_backend_cannot_claim_deploy_not_applicable(self):
        self.facts["requires_deploy"] = True
        self.assertIn("deployment", c.validate(self.receipt, self.facts))

    def test_failed_or_wrong_sha_deploy_blocks(self):
        self.receipt["deployment"] = {"required": True}
        for dep in [{"status": "update_failed", "sha": "c" * 40, "health": True},
                    {"status": "live", "sha": "a" * 40, "health": True}]:
            self.facts["deployment"] = dep
            self.assertIn("deployment", c.validate(self.receipt, self.facts))

    def test_old_base_blocks_premerge(self):
        self.facts["state"] = "OPEN"; self.facts["base_current"] = False
        self.assertIn("base", c.validate(self.receipt, self.facts, phase="merge"))

    def test_unknown_schema_or_empty_criteria_rejected(self):
        self.receipt["criteria"] = []
        self.assertIn("criteria", c.validate(self.receipt, self.facts))


class LedgerTests(unittest.TestCase):
    def test_completed_duplicate_never_readmitted(self):
        with tempfile.TemporaryDirectory() as directory:
            db = c.Ledger(Path(directory) / "ledger.sqlite3")
            key = c.fingerprint({"task": "T-1", "sha": "a", "cursor": 7})
            self.assertTrue(db.claim(key))
            self.assertFalse(db.claim(key))
            db.finish(key, True)
            self.assertFalse(db.claim(key))
            self.assertTrue(db.claim(c.fingerprint({"task": "T-1", "sha": "b", "cursor": 7})))

    def test_failure_retry_budget_and_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.sqlite3"
            db = c.Ledger(path)
            for _ in range(3):
                self.assertTrue(db.claim("event")); db.finish("event", False)
            self.assertFalse(c.Ledger(path).claim("event"))


class ReconciliationTests(unittest.TestCase):
    setUp = CompletionTests.setUp
    def test_already_merged_is_reconciled_without_second_merge(self):
        class VerifiedLive(c.Live):
            def facts(inner, receipt):
                return self.facts
        with tempfile.TemporaryDirectory() as root:
            live = VerifiedLive({"repo": root})
            with patch.object(c, "command", side_effect=AssertionError("must not merge again")):
                result = live.transition(self.receipt, "merge", root)
            self.assertTrue(result["ok"])
            self.assertTrue(result["reconciled"])

    def test_unconfirmed_running_action_is_not_replayed_after_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.sqlite3"
            self.assertTrue(c.Ledger(path).claim("event"))
            self.assertFalse(c.Ledger(path).claim("event"))

    def test_done_reconciliation_repairs_missing_verified_file_without_status_write(self):
        class VerifiedLive(c.Live):
            def facts(inner, receipt):
                return self.facts

            def multica(inner, *args):
                self.assertEqual(args, ("issue", "get", "issue-123"))
                return {"id": "issue-123", "workspace_id": "workspace", "project_id": "project",
                        "metadata": {"task_id": "T-123"}, "status": "custom_finished", "status_category": "completed"}

        with tempfile.TemporaryDirectory() as root:
            key = c.fingerprint({"phase": "done", "task": "T-123", "sha": "b" * 40})
            ledger = c.Ledger(Path(root) / "ledger.sqlite3")
            ledger.claim(key)
            ledger.finish(key, True)
            live = VerifiedLive({"repo": root, "workspace_id": "workspace", "project_id": "project"})
            result = live.transition(self.receipt, "done", root)
            self.assertTrue(result["ok"])
            self.assertTrue(result["reconciled"])
            path = Path(root) / "verified/T-123.json"
            value = json.loads(path.read_text())
            self.assertIs(value["verified"], True)
            self.assertEqual(value["tested_sha"], "b" * 40)
            # Повторное чтение не переносит принятие на новые сутки.
            live.transition(self.receipt, "done", root)
            self.assertEqual(json.loads(path.read_text())["accepted_at"], value["accepted_at"])

    def test_live_facts_rejects_issue_outside_project_before_other_sources(self):
        for changed in ({"project_id": "other"}, {"workspace_id": "other"}, {"metadata": {"task_id": "T-999"}}, {"id": "other"}):
            issue = {"id": "issue-123", "workspace_id": "workspace", "project_id": "project", "metadata": {"task_id": "T-123"}, **changed}
            live = c.Live({"repo": "/unused", "workspace_id": "workspace", "project_id": "project"})
            with patch.object(live, "multica", return_value=issue), patch.object(live, "gh", side_effect=AssertionError("must stop before other evidence")):
                facts = live.facts(self.receipt)
                self.assertIs(facts.get("issue_scope_valid"), False)

    def test_crash_after_native_done_restores_receipt_and_preserves_ledger_acceptance(self):
        state = {"status": "in_review", "status_category": "started", "writes": 0}
        class VerifiedLive(c.Live):
            def facts(inner, receipt): return self.facts
            def multica(inner, *args):
                if args[:2] == ("issue", "status"):
                    state.update(status="done", status_category="completed", writes=state["writes"] + 1)
                else:
                    self.assertEqual(args, ("issue", "get", "issue-123"))
                return {"id": "issue-123", "workspace_id": "workspace", "project_id": "project",
                        "metadata": {"task_id": "T-123"}, **state}

        with tempfile.TemporaryDirectory() as root:
            live = VerifiedLive({"repo": root, "workspace_id": "workspace", "project_id": "project"})
            with patch.object(c.os, "replace", side_effect=OSError("simulated disk failure")):
                with self.assertRaises(OSError):
                    live.transition(self.receipt, "done", root)
            key = c.fingerprint({"phase": "done", "task": "T-123", "sha": "b" * 40})
            accepted = c.Ledger(Path(root) / "ledger.sqlite3").completed_at(key)
            self.assertIsNotNone(accepted)
            self.assertTrue(live.transition(self.receipt, "done", root)["ok"])
            verified = json.loads((Path(root) / "verified/T-123.json").read_text())
            self.assertEqual(verified["accepted_at"], accepted)
            self.assertEqual(state["writes"], 1)

    def test_successful_status_command_without_native_readback_cannot_publish_receipt(self):
        class VerifiedLive(c.Live):
            def facts(inner, receipt): return self.facts
            def multica(inner, *args):
                return {"id": "issue-123", "workspace_id": "workspace", "project_id": "project",
                        "metadata": {"task_id": "T-123"}, "status": "in_review", "status_category": "started"}

        with tempfile.TemporaryDirectory() as root:
            live = VerifiedLive({"repo": root, "workspace_id": "workspace", "project_id": "project"})
            with self.assertRaises(RuntimeError):
                live.transition(self.receipt, "done", root)
            self.assertFalse((Path(root) / "verified/T-123.json").exists())

    def test_native_project_change_before_transition_blocks_status_mutation(self):
        class VerifiedLive(c.Live):
            def facts(inner, receipt): return self.facts
            def multica(inner, *args):
                self.assertEqual(args, ("issue", "get", "issue-123"))
                return {"id": "issue-123", "workspace_id": "workspace", "project_id": "other",
                        "metadata": {"task_id": "T-123"}, "status": "in_review"}
        with tempfile.TemporaryDirectory() as root:
            live = VerifiedLive({"repo": root, "workspace_id": "workspace", "project_id": "project"})
            self.assertEqual(live.transition(self.receipt, "done", root)["blocked"], ["issue_scope"])


class FreshBaseTests(unittest.TestCase):
    def setUp(self):
        CompletionTests.setUp(self)
        del self.facts
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name) / "repo"
        self.remote = Path(self.temporary.name) / "remote.git"
        subprocess.run(["git", "init", "--bare", str(self.remote)], capture_output=True, check=True)
        subprocess.run(["git", "init", "-b", "app", str(self.repo)], capture_output=True, check=True)
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("remote", "add", "origin", str(self.remote))
        self.git("commit", "--allow-empty", "-m", "initial")
        self.git("checkout", "-b", "feature")
        self.git("commit", "--allow-empty", "-m", "tested change")
        self.head = self.git("rev-parse", "HEAD")
        self.git("checkout", "app")
        self.git("commit", "--allow-empty", "-m", "app advanced independently")
        self.base = self.git("rev-parse", "HEAD")
        self.git("push", "origin", "app", "feature:refs/pull/123/head")
        self.receipt["pr"].update(base_sha=self.base, head_sha=self.head)
        self.receipt["tested_sha"] = self.head
        self.receipt["review"]["sha"] = self.head
        self.live = c.Live({"repo": str(self.repo), "workspace_id": "ws", "project_id": "project", "reviewer_ids": ["reviewer"]})

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, capture_output=True, text=True, check=True).stdout.strip()

    def facts(self):
        def gh(endpoint):
            if endpoint.endswith("/pulls/123"):
                return {"head": {"sha": self.head}, "base": {"ref": "app", "sha": self.base}, "state": "open", "mergeable_state": "clean", "changed_files": 1}
            if "/check-runs?" in endpoint:
                return {"check_runs": [{"name": "test", "app": {"slug": "github-actions"}, "id": 1, "conclusion": "success"}]}
            if endpoint.endswith("/git/ref/heads/app"):
                return {"object": {"sha": self.base}}
            raise AssertionError(endpoint)
        def multica(*args):
            if args[:2] == ("issue", "get"):
                return {"id": "issue-123", "workspace_id": "ws", "project_id": "project", "metadata": {"task_id": "T-123"}}
            if args[:2] == ("issue", "runs"):
                marker = "ALTERA_REVIEW_V1 " + json.dumps({"sha": self.head, "verdict": "approved"})
                return [{"id": "run-d", "agent_id": "developer", "status": "completed"},
                        {"id": "run-r", "agent_id": "reviewer", "status": "completed", "result": {"output": marker}}]
            raise AssertionError(args)
        original = c.command
        def command(args, cwd=None, as_json=True):
            if args[:2] == ["gh", "api"]:
                return [[{"filename": "docs/example.md"}]]
            return original(args, cwd, as_json)
        with patch.object(self.live, "gh", side_effect=gh), patch.object(self.live, "multica", side_effect=multica), patch.object(c, "command", side_effect=command):
            return self.live.facts(self.receipt)

    def test_advanced_base_blocks_old_green_head_and_updated_head_passes(self):
        refs = self.git("show-ref")
        facts = self.facts()
        self.assertIs(facts["ci"]["passed"], True)
        self.assertIs(facts["base_current"], False)
        self.assertEqual(c.validate(self.receipt, facts, "merge"), ["base"])
        self.assertEqual(self.git("show-ref"), refs)
        self.git("checkout", "feature")
        self.git("merge", "--no-edit", "app")
        self.head = self.git("rev-parse", "HEAD")
        self.git("push", "origin", "feature:refs/pull/123/head")
        self.receipt["tested_sha"] = self.receipt["pr"]["head_sha"] = self.receipt["review"]["sha"] = self.head
        refs = self.git("show-ref")
        self.assertEqual(c.validate(self.receipt, self.facts(), "merge"), [])
        self.assertEqual(self.git("show-ref"), refs)

    def test_mismatched_or_missing_pr_ref_fails_closed(self):
        # GitHub reports a compatible head, but the fetched PR ref remains the old commit.
        self.head = self.base
        self.receipt["tested_sha"] = self.receipt["pr"]["head_sha"] = self.receipt["review"]["sha"] = self.head
        self.assertIs(self.facts()["base_current"], False)
        self.git("push", "origin", ":refs/pull/123/head")
        self.assertIs(self.facts()["base_current"], False)

    def test_done_validation_does_not_require_current_base_ancestry(self):
        CompletionTests.setUp(self)
        self.facts["base_current"] = False
        self.assertEqual(c.validate(self.receipt, self.facts, "done"), [])


if __name__ == "__main__":
    unittest.main()
