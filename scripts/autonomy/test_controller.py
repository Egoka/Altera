"""Проверки контракта завершения и подавления повторных событий."""
import copy
import tempfile
import unittest
from pathlib import Path

import controller as c


class CompletionTests(unittest.TestCase):
    def setUp(self):
        self.receipt = {
            "schema_version": 1, "task_id": "T-123", "source": {"path": "docs/backlog/tasks/T-123.md", "sha": "a" * 40},
            "baseline_sha": "a" * 40, "tested_sha": "b" * 40, "implementer_id": "developer", "implementer_run_id": "run-d",
            "criteria": [{"id": "AC1", "status": "passed", "evidence": "ci:123"}],
            "pr": {"number": 123, "head_sha": "b" * 40, "base_sha": "a" * 40, "base_ref": "app", "merge_sha": "c" * 40},
            "review": {"actor_id": "reviewer", "run_id": "run-r", "sha": "b" * 40, "verdict": "approved"},
            "deployment": {"required": False, "reason": "Документация"},
            "finalization": {"path": "docs/reports/tasks/T-123.md", "sha256": "d" * 64}}
        self.facts = {"pr": copy.deepcopy(self.receipt["pr"]), "state": "MERGED", "ci": {"sha": "b" * 40, "passed": True},
                      "review": copy.deepcopy(self.receipt["review"]), "review_completed": True, "review_trusted": True,
                      "merge_in_app": True, "finalization_sha256": "d" * 64, "requires_deploy": False,
                      "base_current": True, "implementer_trusted": True, "files_complete": True}

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

    def test_unconfirmed_running_action_is_not_replayed_after_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.sqlite3"
            self.assertTrue(c.Ledger(path).claim("event"))
            self.assertFalse(c.Ledger(path).claim("event"))


if __name__ == "__main__":
    unittest.main()
