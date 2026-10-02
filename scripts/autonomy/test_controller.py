"""Проверки контракта завершения и подавления повторных событий."""
import copy
import hashlib
import json
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

import controller as c


class ReadCommandTests(unittest.TestCase):
    def test_read_command_retries_transient_runtime_errors(self):
        with patch.object(c, "command", side_effect=[RuntimeError("temporary"), {"ok": True}]) as source:
            self.assertEqual(c.read_command(["multica", "issue", "list"], pause=0), {"ok": True})
        self.assertEqual(source.call_count, 2)

    def test_mutating_multica_command_is_not_retried(self):
        live = c.Live({"multica": "multica", "server_url": "https://example.invalid",
                       "workspace_id": "workspace", "repo": "/unused"})
        with patch.object(c, "command", side_effect=RuntimeError("failed")) as source:
            with self.assertRaises(RuntimeError):
                live.multica("issue", "status", "issue", "done")
        self.assertEqual(source.call_count, 1)


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
                      "mergeable": True, "implementer_trusted": True, "files_complete": True, "issue_scope_valid": True}

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

    def test_review_of_earlier_sha_needs_controller_confirmed_same_patch(self):
        self.receipt["review"]["sha"] = "e" * 40
        self.facts["review"] = copy.deepcopy(self.receipt["review"])
        self.assertIn("review", c.validate(self.receipt, self.facts))
        self.facts["review_equivalent"] = True
        self.assertEqual(c.validate(self.receipt, self.facts), [])
        self.assertEqual(c.validate(self.receipt, {**self.facts, "state": "OPEN"}, "merge"), [])

    def test_review_sha_must_be_full_sha_even_with_same_patch(self):
        for value in (None, "", "e" * 39, 7):
            with self.subTest(value=value):
                self.receipt["review"]["sha"] = value
                self.facts["review"] = copy.deepcopy(self.receipt["review"])
                self.facts["review_equivalent"] = True
                self.assertIn("review", c.validate(self.receipt, self.facts))

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

    def test_missing_deploy_and_finalization_block_done_but_not_merge(self):
        # Отказ Done читался как запрет слияния, и готовые PR оставались открытыми.
        self.receipt["deployment"] = {"required": True}
        self.facts["requires_deploy"] = True
        self.facts["deployment"] = {"status": "not_run", "sha": None, "health": False}
        self.facts["finalization_sha256"] = None
        done = c.validate(self.receipt, self.facts)
        self.assertIn("deployment", done)
        self.assertIn("finalization", done)
        self.assertEqual(c.validate(self.receipt, {**self.facts, "state": "OPEN"}, "merge"), [])

    def test_conflicting_or_unknown_mergeability_blocks_premerge(self):
        for value in (False, None):
            with self.subTest(mergeable=value):
                facts = {**self.facts, "state": "OPEN", "mergeable": value}
                self.assertIn("base", c.validate(self.receipt, facts, phase="merge"))

    def test_unknown_schema_or_empty_criteria_rejected(self):
        self.receipt["criteria"] = []
        self.assertIn("criteria", c.validate(self.receipt, self.facts))

    def test_receipt_commit_on_top_of_tested_head_needs_controller_confirmation(self):
        # Итог задачи, дописанный в ветку, сдвигает head: сам контроллер решает, что сдвинули.
        facts = copy.deepcopy(self.facts)
        facts["pr"]["head_sha"] = "f" * 40
        facts["ci"] = {"sha": "f" * 40, "passed": True}
        self.assertIn("pr", c.validate(self.receipt, facts))
        facts["head_receipt_only"] = True
        self.assertEqual(c.validate(self.receipt, facts), [])
        self.assertEqual(c.validate(self.receipt, {**facts, "state": "OPEN"}, "merge"), [])

    def test_ci_must_be_green_on_the_live_head_not_on_the_earlier_tested_sha(self):
        facts = copy.deepcopy(self.facts)
        facts["pr"]["head_sha"] = "f" * 40
        facts["head_receipt_only"] = True
        self.assertIn("ci", c.validate(self.receipt, facts))


class HeadReceiptOnlyTests(unittest.TestCase):
    """Что именно дописали в ветку поверх проверенного head, читается из git, не из текста агента."""

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, capture_output=True, text=True, check=True).stdout.strip()

    def commit(self, path, body):
        target = Path(self.root) / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body)
        self.git("add", "-A")
        self.git("-c", "user.email=test@example.invalid", "-c", "user.name=test", "commit", "-q", "-m", path)
        return self.git("rev-parse", "HEAD")

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = self.directory.name
        self.git("init", "-q", "-b", "app")
        # Без фонового `git maintenance run --auto --detach`: он переживает commit и гоняется с cleanup.
        self.git("config", "maintenance.auto", "false")
        self.live = c.Live({"repo": self.root})
        self.base = self.commit("README.md", "base\n")
        self.tested = self.commit("server/src/feature.ts", "export const feature = 1\n")

    def test_own_finalization_written_after_the_work_is_accepted(self):
        for path in ("docs/reports/tasks/T-123.json", "docs/reports/tasks/T-123.md",
                     "docs/reports/2026-09-20-t123-report.md"):
            with self.subTest(path=path):
                self.git("reset", "-q", "--hard", self.tested)
                head = self.commit(path, "финализация\n")
                self.assertTrue(self.live.head_receipt_only(self.tested, head, "T-123"))

    def test_code_or_another_task_receipt_on_top_is_rejected(self):
        for path in ("server/src/feature.ts", "docs/reports/tasks/T-456.json",
                     "docs/spec/00-registries/roles.md", "docs/plans/2026-09-20-plan.md",
                     "docs/reports/autonomy/2026-09-20.md", "docs/reports/evidence/probe.json"):
            with self.subTest(path=path):
                self.git("reset", "-q", "--hard", self.tested)
                head = self.commit(path, "changed\n")
                self.assertFalse(self.live.head_receipt_only(self.tested, head, "T-123"))

    def test_head_that_does_not_build_on_the_tested_commit_is_rejected(self):
        self.git("checkout", "-q", "--orphan", "rewritten")
        rewritten = self.commit("docs/reports/tasks/T-123.json", '{"task_id": "T-123"}\n')
        self.assertFalse(self.live.head_receipt_only(self.tested, rewritten, "T-123"))

    def test_review_survives_regenerated_graphql_artifacts(self):
        # Сгенерированное подтверждается проверкой codegen в CI, а исходники остаются в патче.
        self.commit("web/app/graphql/generated/schema.graphql", "type Query { a: Int }\n")
        reviewed = self.live.patch_fingerprint(self.git("rev-parse", "HEAD"), self.base, "T-123")
        regenerated = self.commit("web/app/graphql/generated/schema.graphql", "type Query { a: Int, b: Int }\n")
        self.assertEqual(self.live.patch_fingerprint(regenerated, self.base, "T-123"), reviewed)
        changed_source = self.commit("web/app/graphql/operations/pages/home.graphql", "query Home { b }\n")
        self.assertNotEqual(self.live.patch_fingerprint(changed_source, self.base, "T-123"), reviewed)

    def test_review_survives_its_own_finalization_but_not_other_changes(self):
        reviewed = self.live.patch_fingerprint(self.tested, self.base, "T-123")
        self.assertIsNotNone(reviewed)
        for path in ("docs/reports/2026-09-20-t123-report.md", "docs/reports/tasks/T-123.md"):
            with self.subTest(path=path):
                self.git("reset", "-q", "--hard", self.tested)
                head = self.commit(path, "финализация\n")
                self.assertEqual(self.live.patch_fingerprint(head, self.base, "T-123"), reviewed)
        for path in ("docs/reports/evidence/probe.json", "docs/reports/tasks/T-456.md", "server/src/feature.ts"):
            with self.subTest(path=path):
                self.git("reset", "-q", "--hard", self.tested)
                head = self.commit(path, "не финализация\n")
                self.assertNotEqual(self.live.patch_fingerprint(head, self.base, "T-123"), reviewed)

    def test_unknown_or_malformed_shas_are_rejected_without_network(self):
        for tested, head in [(None, "f" * 40), ("b" * 40, "short"), ("b" * 40, "f" * 40)]:
            with self.subTest(tested=tested, head=head):
                self.assertFalse(self.live.head_receipt_only(tested, head, "T-123"))


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

    def test_merge_uses_merge_commit_not_squash(self):
        open_facts = {**self.facts, "state": "OPEN"}
        class OpenLive(c.Live):
            def facts(inner, receipt):
                return open_facts
        calls = []
        with tempfile.TemporaryDirectory() as root:
            live = OpenLive({"repo": root, "github_repo": "example/project"})
            with patch.object(c, "command", side_effect=lambda args, *rest, **kw: calls.append(args)):
                result = live.transition(self.receipt, "merge", root)
        self.assertTrue(result["ok"], result)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][:4], ["gh", "pr", "merge", "123"])
        self.assertIn("--merge", calls[0])
        self.assertNotIn("--squash", calls[0])
        self.assertEqual(calls[0][calls[0].index("--match-head-commit") + 1], "b" * 40)

    def test_merge_matches_the_live_head_carrying_the_receipt_commit(self):
        open_facts = copy.deepcopy(self.facts)
        open_facts["state"] = "OPEN"
        open_facts["pr"]["head_sha"] = "f" * 40
        open_facts["ci"] = {"sha": "f" * 40, "passed": True}
        open_facts["head_receipt_only"] = True
        class OpenLive(c.Live):
            def facts(inner, receipt):
                return open_facts
        calls = []
        with tempfile.TemporaryDirectory() as root:
            live = OpenLive({"repo": root, "github_repo": "example/project"})
            with patch.object(c, "command", side_effect=lambda args, *rest, **kw: calls.append(args)):
                result = live.transition(self.receipt, "merge", root)
        self.assertTrue(result["ok"], result)
        self.assertEqual(calls[0][calls[0].index("--match-head-commit") + 1], "f" * 40)

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

    def test_stale_done_running_is_retried_when_native_issue_is_not_done(self):
        # Сбой после захвата ключа `done` оставлял `running` навсегда (T-007, 2026-09-19):
        # карточка не в Done, значит запись статуса не состоялась, и повтор безопасен.
        state = {"status": "in_review", "status_category": "started", "writes": 0}
        class VerifiedLive(c.Live):
            def facts(inner, receipt): return self.facts
            def multica(inner, *args):
                if args[:2] == ("issue", "status"):
                    state.update(status="done", status_category="completed", writes=state["writes"] + 1)
                return {"id": "issue-123", "workspace_id": "workspace", "project_id": "project",
                        "metadata": {"task_id": "T-123"}, **state}

        with tempfile.TemporaryDirectory() as root:
            key = c.fingerprint({"phase": "done", "task": "T-123", "sha": "b" * 40})
            self.assertTrue(c.Ledger(Path(root) / "ledger.sqlite3").claim(key))
            live = VerifiedLive({"repo": root, "workspace_id": "workspace", "project_id": "project"})
            result = live.transition(self.receipt, "done", root)
            self.assertTrue(result["ok"], result)
            self.assertEqual(state["writes"], 1)
            self.assertIsNotNone(c.Ledger(Path(root) / "ledger.sqlite3").completed_at(key))

    def test_stale_done_running_respects_retry_budget(self):
        class VerifiedLive(c.Live):
            def facts(inner, receipt): return self.facts
            def multica(inner, *args):
                if args[:2] == ("issue", "status"):
                    raise AssertionError("retry budget exhausted, status must not be written")
                return {"id": "issue-123", "workspace_id": "workspace", "project_id": "project",
                        "metadata": {"task_id": "T-123"}, "status": "in_review", "status_category": "started"}

        with tempfile.TemporaryDirectory() as root:
            key = c.fingerprint({"phase": "done", "task": "T-123", "sha": "b" * 40})
            ledger = c.Ledger(Path(root) / "ledger.sqlite3")
            for _ in range(2):
                ledger.claim(key); ledger.finish(key, False)
            self.assertTrue(ledger.claim(key))
            live = VerifiedLive({"repo": root, "workspace_id": "workspace", "project_id": "project"})
            self.assertEqual(live.transition(self.receipt, "done", root)["blocked"], ["duplicate_or_reconciliation_required"])

    def test_stale_merge_running_is_still_not_replayed(self):
        open_facts = {**self.facts, "state": "OPEN"}
        class OpenLive(c.Live):
            def facts(inner, receipt): return open_facts
        with tempfile.TemporaryDirectory() as root:
            key = c.fingerprint({"phase": "merge", "task": "T-123", "sha": "b" * 40})
            self.assertTrue(c.Ledger(Path(root) / "ledger.sqlite3").claim(key))
            live = OpenLive({"repo": root, "github_repo": "example/project"})
            with patch.object(c, "command", side_effect=AssertionError("must not merge again")):
                result = live.transition(self.receipt, "merge", root)
            self.assertEqual(result["blocked"], ["duplicate_or_reconciliation_required"])


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
        # Без фонового автообслуживания после commit/push; receive-pack читает конфиг самого remote.
        for repository in (self.remote, self.repo):
            subprocess.run(["git", "-C", str(repository), "config", "maintenance.auto", "false"], capture_output=True, check=True)
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("remote", "add", "origin", str(self.remote))
        self.git("commit", "--allow-empty", "-m", "initial")
        self.git("checkout", "-b", "feature")
        (self.repo / "feature.txt").write_text("tested change\n")
        self.git("add", "feature.txt")
        self.git("commit", "-m", "tested change")
        self.head = self.git("rev-parse", "HEAD")
        self.git("checkout", "app")
        self.git("commit", "--allow-empty", "-m", "app advanced independently")
        self.base = self.git("rev-parse", "HEAD")
        self.git("push", "origin", "app", "feature:refs/pull/123/head")
        self.receipt["pr"].update(base_sha=self.base, head_sha=self.head)
        self.receipt["tested_sha"] = self.head
        self.receipt["review"]["sha"] = self.head
        self.mergeable = True
        self.live = c.Live({"repo": str(self.repo), "workspace_id": "ws", "project_id": "project", "reviewer_ids": ["reviewer"]})

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, capture_output=True, text=True, check=True).stdout.strip()

    def facts(self):
        def gh(endpoint):
            if endpoint.endswith("/pulls/123"):
                return {"head": {"sha": self.head}, "base": {"ref": "app", "sha": self.base}, "state": "open",
                        "mergeable": self.mergeable, "mergeable_state": "clean" if self.mergeable else "dirty", "changed_files": 1}
            if "/check-runs?" in endpoint:
                return {"check_runs": [{"name": "test", "app": {"slug": "github-actions"}, "id": 1, "conclusion": "success"}]}
            if endpoint.endswith("/git/ref/heads/app"):
                return {"object": {"sha": self.base}}
            raise AssertionError(endpoint)
        def multica(*args):
            if args[:2] == ("issue", "get"):
                return {"id": "issue-123", "workspace_id": "ws", "project_id": "project", "metadata": {"task_id": "T-123"}}
            if args[:2] == ("issue", "runs"):
                marker = "ALTERA_REVIEW_V1 " + json.dumps({"sha": self.receipt["review"]["sha"], "verdict": "approved"})
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

    def test_app_advancing_does_not_block_green_mergeable_head(self):
        # Решение владельца 2026-09-19: отставание от app не требует обновления ветки перед merge.
        refs = self.git("show-ref")
        self.assertNotEqual(subprocess.run(["git", "merge-base", "--is-ancestor", self.base, self.head],
                                           cwd=self.repo).returncode, 0)
        facts = self.facts()
        self.assertIs(facts["ci"]["passed"], True)
        self.assertIs(facts["mergeable"], True)
        self.assertEqual(c.validate(self.receipt, facts, "merge"), [])
        self.assertEqual(self.git("show-ref"), refs)

    def test_conflict_or_pending_mergeability_blocks_merge(self):
        for value in (False, None):
            with self.subTest(mergeable=value):
                self.mergeable = value
                facts = self.facts()
                self.assertIs(facts["mergeable"], False)
                self.assertEqual(c.validate(self.receipt, facts, "merge"), ["base"])

    def test_branch_update_with_same_patch_keeps_review_of_earlier_head(self):
        reviewed = self.head
        self.git("checkout", "feature")
        self.git("merge", "--no-edit", "app")
        self.head = self.git("rev-parse", "HEAD")
        self.git("push", "origin", "feature:refs/pull/123/head")
        self.receipt["tested_sha"] = self.receipt["pr"]["head_sha"] = self.head
        self.assertEqual(self.receipt["review"]["sha"], reviewed)
        facts = self.facts()
        self.assertIs(facts["review_equivalent"], True)
        self.assertIs(facts["review_trusted"], True)
        self.assertEqual(c.validate(self.receipt, facts, "merge"), [])

    def test_code_pushed_after_review_requires_new_review(self):
        self.git("checkout", "feature")
        (self.repo / "feature.txt").write_text("changed after review\n")
        self.git("commit", "-am", "unreviewed change")
        self.git("merge", "--no-edit", "app")
        self.head = self.git("rev-parse", "HEAD")
        self.git("push", "origin", "feature:refs/pull/123/head")
        self.receipt["tested_sha"] = self.receipt["pr"]["head_sha"] = self.head
        facts = self.facts()
        self.assertIs(facts["review_equivalent"], False)
        self.assertEqual(c.validate(self.receipt, facts, "merge"), ["review"])

    def test_mismatched_or_missing_pr_ref_fails_closed(self):
        # GitHub reports a compatible head, but the fetched PR ref remains the old commit.
        self.head = self.base
        self.receipt["tested_sha"] = self.receipt["pr"]["head_sha"] = self.receipt["review"]["sha"] = self.head
        self.assertIs(self.facts()["mergeable"], False)
        self.git("push", "origin", ":refs/pull/123/head")
        self.assertIs(self.facts()["mergeable"], False)

    def test_done_validation_does_not_require_open_mergeable_pr(self):
        CompletionTests.setUp(self)
        self.facts["mergeable"] = False
        self.assertEqual(c.validate(self.receipt, self.facts, "done"), [])


class ReviewEquivalenceTests(unittest.TestCase):
    """Одобрение переживает обновление ветки от app, пока патч ветки не меняется."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        self.git("init", "-b", "app")
        self.git("config", "maintenance.auto", "false")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        self.write("server/a.ts", "".join(f"line {i}\n" for i in range(1, 101)))
        self.base = self.commit("base")
        self.git("checkout", "-b", "feature")
        self.replace("server/a.ts", "line 80\n", "changed 80\n")
        self.reviewed = self.commit("reviewed change")
        self.live = c.Live({"repo": str(self.repo)})

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, capture_output=True, text=True, check=True).stdout.strip()

    def write(self, path, text):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def replace(self, path, old, new):
        self.write(path, (self.repo / path).read_text().replace(old, new))

    def commit(self, message):
        self.git("add", "-A")
        self.git("commit", "-m", message)
        return self.git("rev-parse", "HEAD")

    def rebase_after_app_change(self, old, new):
        self.git("checkout", "app")
        self.replace("server/a.ts", old, new)
        app = self.commit("app advanced")
        self.git("checkout", "feature")
        self.git("rebase", "app")
        return app, self.git("rev-parse", "HEAD")

    def test_rebase_over_distant_app_change_keeps_review(self):
        app, head = self.rebase_after_app_change("line 5\n", "changed 5\n")
        self.assertNotEqual(head, self.reviewed)
        self.assertTrue(self.live.review_equivalent(self.reviewed, head, app, "T-123"))

    def test_app_change_inside_review_context_requires_new_review(self):
        app, head = self.rebase_after_app_change("line 78\n", "changed 78\n")
        self.assertFalse(self.live.review_equivalent(self.reviewed, head, app, "T-123"))

    def test_only_own_receipt_is_ignored(self):
        self.write("docs/reports/tasks/T-123.json", "{}\n")
        own = self.commit("own receipt")
        self.assertTrue(self.live.review_equivalent(self.reviewed, own, self.base, "T-123"))
        self.write("docs/reports/tasks/T-999.json", "{}\n")
        foreign = self.commit("foreign receipt")
        self.assertFalse(self.live.review_equivalent(self.reviewed, foreign, self.base, "T-123"))

    def test_changed_code_or_binary_requires_new_review(self):
        self.replace("server/a.ts", "line 90\n", "changed 90\n")
        self.assertFalse(self.live.review_equivalent(self.reviewed, self.commit("more code"), self.base, "T-123"))
        self.git("reset", "--hard", self.reviewed)
        (self.repo / "image.bin").write_bytes(b"\x00\x01")
        with_binary = self.commit("binary")
        (self.repo / "image.bin").write_bytes(b"\x00\x02")
        other_binary = self.commit("other binary")
        self.assertFalse(self.live.review_equivalent(with_binary, other_binary, self.base, "T-123"))

    def test_unknown_input_fails_closed(self):
        for reviewed, head, base, task in [("f" * 40, self.reviewed, self.base, "T-123"),
                                            (None, self.reviewed, self.base, "T-123"),
                                            (self.reviewed, self.reviewed + "0", self.base, "T-123"),
                                            (self.reviewed, self.base, self.base, "T-123"),
                                            (self.reviewed, self.reviewed, self.base, "../T-123"),
                                            (self.reviewed, self.reviewed, self.base, 123)]:
            with self.subTest(reviewed=reviewed, head=head, task=task):
                self.assertFalse(self.live.review_equivalent(reviewed, head, base, task))

    def test_identical_head_is_equivalent_without_git(self):
        live = c.Live({"repo": "/nonexistent"})
        self.assertTrue(live.review_equivalent(self.reviewed, self.reviewed, self.base, "T-123"))


class CleanupEvidenceTests(unittest.TestCase):
    """Живые доказательства уборки: внешний I/O подменён, правила адаптера настоящие."""

    def setUp(self):
        CompletionTests.setUp(self)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.verified = {**copy.deepcopy(self.receipt), "branch": "feat/t-123", "verified": True,
                         "accepted_at": "2026-10-01T00:00:00+00:00", "enforcement": "managed_path_only"}
        (self.root / "verified").mkdir()
        (self.root / "verified" / "T-123.json").write_text(json.dumps(self.verified))
        self.answers = {
            ("agent", "list", "--include-archived"): {"agents": [{"id": "finalizer"}, {"id": "developer"}]},
            ("agent", "tasks", "finalizer"): [{"id": "run-self", "issue_id": None, "status": "running"},
                                              {"id": "old", "issue_id": "issue-123", "status": "completed"}],
            ("agent", "tasks", "developer"): {"tasks": [
                {"id": "run-q", "issue_id": "issue-9", "status": "waiting_local_directory"},
                {"id": "run-r", "issue_id": "issue-123", "status": "queued"}]},
            ("issue", "get", "issue-9"): {"id": "issue-9", "metadata": {"task_id": "T-9"}},
            ("issue", "get", "issue-123"): {"id": "issue-123", "workspace_id": "workspace", "project_id": "project",
                                            "metadata": {"task_id": "T-123"}, "status": "done"},
        }
        answers = self.answers

        class FakeLive(c.Live):
            def multica_read(inner, *args):
                return copy.deepcopy(answers[args])

            def gh(inner, endpoint):
                self.assertEqual(endpoint, "repos/example/project/pulls/123")
                return {"number": 123, "state": "closed", "merged": True, "merge_commit_sha": "c" * 40,
                        "html_url": "https://github.com/example/project/pull/123",
                        "head": {"sha": "b" * 40}, "base": {"ref": "app", "sha": "a" * 40}}

        self.live = FakeLive({"repo": str(self.root), "github_repo": "example/project", "workspace_id": "workspace",
                              "project_id": "project", "cleanup_owned_root": str(self.root / "owned")})
        self.evidence = c.CleanupEvidence(self.live, self.root, "finalizer")

    def test_inventory_identifies_caller_and_maps_waiting_runs_to_tasks(self):
        runs, caller = self.evidence.inventory(self.receipt)
        self.assertEqual(caller, "run-self")
        self.assertEqual(runs, [{"id": "run-self", "status": "running"},
                                {"id": "run-q", "status": "waiting_local_directory", "task_id": "T-9"},
                                {"id": "run-r", "status": "queued", "task_id": "T-123"}])

    def test_inventory_fails_closed_on_ambiguous_caller_or_payload(self):
        self.answers[("agent", "tasks", "finalizer")].append({"id": "run-2", "status": "running"})
        with self.assertRaises(RuntimeError):
            self.evidence.inventory(self.receipt)
        self.answers[("agent", "tasks", "finalizer")].pop()
        self.answers[("agent", "tasks", "developer")]["has_more"] = True
        with self.assertRaises(RuntimeError):
            self.evidence.inventory(self.receipt)
        self.answers[("agent", "list", "--include-archived")] = {"unexpected": []}
        with self.assertRaises(RuntimeError):
            c.CleanupEvidence(self.live, self.root, "finalizer").inventory(self.receipt)

    def test_inventory_without_caller_agent_reports_no_caller(self):
        runs, caller = c.CleanupEvidence(self.live, self.root, None).inventory(self.receipt)
        self.assertIsNone(caller)
        self.assertIn({"id": "run-self", "status": "running"}, runs)

    def test_fence_ready_mirrors_cleanup_rules(self):
        self.assertTrue(self.evidence.fence_ready())
        self.assertFalse(c.CleanupEvidence(self.live, self.root, None).fence_ready())
        self.answers[("agent", "tasks", "developer")]["tasks"].append({"id": "x", "issue_id": None, "status": "running"})
        self.assertFalse(c.CleanupEvidence(self.live, self.root, "finalizer").fence_ready())
        self.answers[("agent", "tasks", "finalizer")] = []
        self.assertFalse(c.CleanupEvidence(self.live, self.root, "finalizer").fence_ready())
        self.answers[("agent", "tasks", "developer")] = []
        self.assertTrue(c.CleanupEvidence(self.live, self.root, None).fence_ready())

    def test_read_reports_exclusive_fence_and_controller_acceptance(self):
        receipt = self.live.cleanup_receipt(self.verified, str(self.root / "owned" / "task"))
        with patch.object(self.evidence, "app_artifact", return_value=("e" * 40, "d" * 64)), \
                patch.object(self.evidence, "worktree_in_use", return_value=False):
            value = self.evidence.read(receipt)
            self.assertEqual(value["fence"], "exclusive")
            self.assertEqual(value["caller_run_id"], "run-self")
            self.assertIs(value["worktree_in_use"], False)
            self.assertIs(value["complete"], True)
            self.assertEqual(value["task"], {
                "id": "T-123", "status": "done", "confirmed_done": True, "finalized_in_app": True,
                "receipt_sha256": c.worktree_cleanup.canonical_hash(receipt),
                "artifacts": [{"id": "gitblob:" + "e" * 40, "sha256": "d" * 64}]})
            self.assertEqual(value["pr"], {**receipt["pr"], "state": "MERGED"})
            # Итог, не принятый контроллером, или не тот receipt не подтверждают Done.
            changed = copy.deepcopy(receipt)
            changed["tested_sha"] = "f" * 40
            self.assertIs(self.evidence.read(changed)["task"]["confirmed_done"], False)
            (self.root / "verified" / "T-123.json").unlink()
            self.assertIs(self.evidence.read(receipt)["task"]["confirmed_done"], False)

    def test_read_requires_native_done_in_project(self):
        self.answers[("issue", "get", "issue-123")]["status"] = "in_review"
        receipt = self.live.cleanup_receipt(self.verified, str(self.root / "owned" / "task"))
        with patch.object(self.evidence, "app_artifact", return_value=None), \
                patch.object(self.evidence, "worktree_in_use", return_value=False):
            task = self.evidence.read(receipt)["task"]
        self.assertEqual(task["status"], "in_review")
        self.assertIs(task["confirmed_done"], False)
        self.assertIs(task["finalized_in_app"], False)

    def test_guard_requires_held_dispatch_lock(self):
        with self.assertRaises(RuntimeError):
            with self.evidence.guard(self.receipt):
                pass
        with c.lock(self.root / "dispatch.lock"):
            with self.evidence.guard(self.receipt):
                pass

    def test_worktree_in_use_reads_process_working_directories(self):
        target = self.root / "owned" / "task"
        target.mkdir(parents=True)

        def lsof(stdout, code=0):
            return subprocess.CompletedProcess(["lsof"], code, stdout=stdout, stderr="")

        cases = [(lsof(f"p1\nn{self.root}\np2\nn{target}/web\n"), True),
                 (lsof(f"p1\nn{self.root}\np2\nn{self.root}/owned/task-2\n"), False),
                 (lsof("", 1), None)]
        for completed, expected in cases:
            with self.subTest(expected=expected), patch.object(c.subprocess, "run", return_value=completed):
                self.assertIs(c.CleanupEvidence.worktree_in_use(str(target)), expected)
        with patch.object(c.subprocess, "run", side_effect=OSError("no lsof")):
            self.assertIsNone(c.CleanupEvidence.worktree_in_use(str(target)))


class CleanupAfterDoneTests(unittest.TestCase):
    """Уборка встроена в Done, но никогда не меняет его результат."""

    def setUp(self):
        CompletionTests.setUp(self)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.receipt["branch"] = "feat/t-123"
        self.state = {"status": "in_review", "status_category": "started"}
        state, facts = self.state, self.facts

        class VerifiedLive(c.Live):
            def facts(inner, receipt):
                return facts

            def multica(inner, *args):
                if args[:2] == ("issue", "status"):
                    state.update(status="done", status_category="completed")
                return {"id": "issue-123", "workspace_id": "workspace", "project_id": "project",
                        "metadata": {"task_id": "T-123"}, **state}

        self.config = {"repo": str(self.root), "github_repo": "example/project", "workspace_id": "workspace",
                       "project_id": "project", "cleanup_owned_root": str(self.root / "owned")}
        self.live = VerifiedLive(self.config)

    def test_done_cleans_task_worktree_and_pending_ones(self):
        (self.root / "verified").mkdir()
        older = {**copy.deepcopy(self.receipt), "task_id": "T-1", "branch": "feat/t-1", "verified": True}
        (self.root / "verified" / "T-1.json").write_text(json.dumps(older))
        trees = [{"worktree": str(self.root / "owned" / "t-1"), "branch": "refs/heads/feat/t-1"}]
        calls = []
        with patch.object(c.worktree_cleanup, "_worktrees", return_value=trees), \
                patch.object(c.CleanupEvidence, "fence_ready", return_value=True), \
                patch.object(c.Live, "cleanup_task", lambda inner, verified, state_dir, apply=True: calls.append(verified["task_id"]) or {"status": "removed"}):
            result = self.live.transition(self.receipt, "done", str(self.root))
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["cleanup"], {"status": "removed"})
        self.assertEqual(result["cleanup_pending"], [{"task_id": "T-1", "status": "removed"}])
        self.assertEqual(calls, ["T-123", "T-1"])
        self.assertEqual(c.Live.cleanup_attempts(self.root), {})

    def write_verified_tasks(self, *task_ids):
        (self.root / "verified").mkdir(exist_ok=True)
        for task_id in task_ids:
            value = {**copy.deepcopy(self.receipt), "task_id": task_id, "branch": "feat/" + task_id, "verified": True}
            (self.root / "verified" / (task_id + ".json")).write_text(json.dumps(value))
        return [{"worktree": str(self.root / "owned" / task_id), "branch": "refs/heads/feat/" + task_id} for task_id in task_ids]

    def test_pending_rotates_by_last_attempt_so_stuck_tasks_do_not_block_others(self):
        trees = self.write_verified_tasks("T-1", "T-2", "T-3")
        c.Live.cleanup_attempts(self.root, {"T-1": "2026-09-30T00:00:00+00:00", "T-2": "2026-09-29T00:00:00+00:00"})
        calls = []

        def stuck(inner, verified, state_dir, apply=True):
            calls.append(verified["task_id"])
            return {"status": "skipped", "reason": "dirty worktree"}

        with patch.object(c.worktree_cleanup, "_worktrees", return_value=trees), \
                patch.object(c.CleanupEvidence, "fence_ready", return_value=True), \
                patch.object(c.Live, "cleanup_task", stuck):
            self.live.cleanup_pending(str(self.root), limit=2)
            self.live.cleanup_pending(str(self.root), limit=2)
        self.assertEqual(calls, ["T-3", "T-2", "T-1", "T-3"])

    def test_pending_defers_without_exclusive_fence_or_time_budget(self):
        trees = self.write_verified_tasks("T-1")
        with patch.object(c.worktree_cleanup, "_worktrees", return_value=trees), \
                patch.object(c.Live, "cleanup_task", side_effect=AssertionError("must not attempt")):
            with patch.object(c.CleanupEvidence, "fence_ready", return_value=False):
                self.assertEqual(self.live.cleanup_pending(str(self.root))[0]["status"], "deferred")
            with patch.object(c.CleanupEvidence, "fence_ready", side_effect=AssertionError("budget is checked first")):
                result = self.live.cleanup_pending(str(self.root), deadline=c.time.monotonic() - 1)
        self.assertEqual(result, [{"status": "deferred", "reason": "cleanup time budget is spent"}])

    def test_dry_run_neither_requires_fence_nor_records_attempts(self):
        trees = self.write_verified_tasks("T-1")
        modes = []
        with patch.object(c.worktree_cleanup, "_worktrees", return_value=trees), \
                patch.object(c.CleanupEvidence, "fence_ready", side_effect=AssertionError("dry run needs no fence")), \
                patch.object(c.Live, "cleanup_task", lambda inner, verified, state_dir, apply=True: modes.append(apply) or {"status": "eligible"}):
            result = self.live.cleanup_command(str(self.root), apply=False)
        self.assertEqual(result["results"], [{"task_id": "T-1", "status": "eligible"}])
        self.assertIs(result["applied"], False)
        self.assertEqual(modes, [False])
        self.assertFalse((self.root / "cleanup-attempts.json").exists())

    def test_protected_shared_folder_is_never_cleaned(self):
        shared = self.root / "owned" / "autopilot"
        self.config["cleanup_protected_worktrees"] = [str(shared)]
        trees = [{"worktree": str(shared), "branch": "refs/heads/feat/t-123"}]
        with patch.object(c.worktree_cleanup, "_worktrees", return_value=trees), \
                patch.object(c.worktree_cleanup, "cleanup", side_effect=AssertionError("protected")):
            result = self.live.cleanup_task({**self.receipt, "verified": True}, str(self.root))
        self.assertEqual(result, {"status": "skipped", "reason": "worktree is protected by configuration"})

    def test_cli_cleanup_needs_no_receipt_and_other_actions_do(self):
        config = self.root / "config.json"
        config.write_text(json.dumps({**self.config, "state_dir": str(self.root)}))
        seen = []
        with patch.object(c.Live, "cleanup_command", lambda inner, state_dir, limit=5, apply=True: seen.append((limit, apply)) or {"ok": True}), \
                patch("sys.stdout"):
            with patch("sys.argv", ["controller.py", "cleanup", "--config", str(config), "--dry-run", "--limit", "20"]):
                self.assertEqual(c.main(), 0)
            with patch("sys.argv", ["controller.py", "done", "--config", str(config)]), patch("sys.stderr"):
                with self.assertRaises(SystemExit):
                    c.main()
        self.assertEqual(seen, [(20, False)])

    def test_cleanup_failure_keeps_done_result(self):
        with patch.object(c.Live, "cleanup_task", side_effect=RuntimeError("network")):
            result = self.live.transition(self.receipt, "done", str(self.root))
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["cleanup"], {"status": "skipped", "reason": "cleanup failed: RuntimeError"})
        self.assertTrue((self.root / "verified" / "T-123.json").exists())

    def test_reconciled_done_also_cleans(self):
        self.state.update(status="done", status_category="completed")
        with patch.object(c.Live, "cleanup_task", return_value={"status": "absent"}), \
                patch.object(c.worktree_cleanup, "_worktrees", return_value=[]):
            result = self.live.transition(self.receipt, "done", str(self.root))
        self.assertTrue(result["reconciled"], result)
        self.assertEqual(result["cleanup"], {"status": "absent"})

    def test_unconfigured_cleanup_leaves_done_unchanged(self):
        del self.config["cleanup_owned_root"]
        with patch.object(c.Live, "cleanup_task", side_effect=AssertionError("cleanup is disabled")):
            result = self.live.transition(self.receipt, "done", str(self.root))
        self.assertEqual(result, {"ok": True, "phase": "done", "task_id": "T-123"})

    def test_cleanup_task_uses_git_worktree_of_branch_and_live_fence(self):
        verified = {**copy.deepcopy(self.receipt), "verified": True}
        trees = [{"worktree": str(self.root), "branch": "refs/heads/app"},
                 {"worktree": str(self.root / "owned" / "t-123"), "branch": "refs/heads/feat/t-123"}]
        captured = {}

        def fake_cleanup(repo, receipt, provider, **options):
            captured.update(receipt=receipt, provider=provider, **options)
            return {"status": "removed"}

        with patch.object(c.worktree_cleanup, "_worktrees", return_value=trees), \
                patch.object(c.worktree_cleanup, "cleanup", side_effect=fake_cleanup), \
                patch.dict(c.os.environ, {"MULTICA_AGENT_ID": "finalizer"}):
            self.assertEqual(self.live.cleanup_task(verified, str(self.root)), {"status": "removed"})
        self.assertEqual(captured["receipt"]["worktree"], str(self.root / "owned" / "t-123"))
        self.assertEqual(captured["receipt"]["pr"]["url"], "https://github.com/example/project/pull/123")
        self.assertIs(captured["apply"], True)
        self.assertEqual(captured["owned_root"], str(self.root / "owned"))
        self.assertIsInstance(captured["provider"], c.CleanupEvidence)
        self.assertEqual(captured["provider"].caller_agent_id, "finalizer")

    def test_cleanup_task_without_branch_or_worktree_does_nothing(self):
        with patch.object(c.worktree_cleanup, "_worktrees", return_value=[]), \
                patch.object(c.worktree_cleanup, "cleanup", side_effect=AssertionError("nothing to clean")):
            self.assertEqual(self.live.cleanup_task({**self.receipt, "verified": True}, str(self.root))["status"], "absent")
            receipt = {**self.receipt, "verified": True}
            del receipt["branch"]
            self.assertEqual(self.live.cleanup_task(receipt, str(self.root))["status"], "skipped")

    def test_cleanup_command_sweeps_under_dispatch_lock(self):
        seen = []

        def pending(inner, state_dir, limit=3, exclude=(), deadline=None, apply=True):
            with self.assertRaises(BlockingIOError):
                with (Path(state_dir) / "dispatch.lock").open("a") as stream:
                    c.fcntl.flock(stream, c.fcntl.LOCK_EX | c.fcntl.LOCK_NB)
            seen.append(limit)
            return [{"task_id": "T-1", "status": "removed"}]

        with patch.object(c.Live, "cleanup_pending", pending):
            result = self.live.cleanup_command(str(self.root))
        self.assertEqual(result, {"ok": True, "phase": "cleanup", "applied": True,
                                  "results": [{"task_id": "T-1", "status": "removed"}]})
        self.assertEqual(seen, [5])


class BacklogSyncAfterDoneTests(unittest.TestCase):
    """Сверка бэклога встроена в Done, включается ключом и никогда не меняет его результат."""

    def setUp(self):
        CleanupAfterDoneTests.setUp(self)
        del self.config["cleanup_owned_root"]
        self.config["backlog_sync_root"] = str(self.root / "sync")

    def test_done_publishes_backlog_sync_with_full_project_inventory(self):
        calls = []
        issues = [{"identifier": "ALTE-1"}]

        def publish(config, task_id, rows):
            calls.append((config["backlog_sync_root"], task_id, rows))
            return {"status": "published", "pr": 7}

        with patch.object(c.Live, "project_issues", return_value=issues), \
                patch.object(c.backlog_sync, "publish", side_effect=publish):
            result = self.live.transition(self.receipt, "done", str(self.root))
        self.assertEqual(result, {"ok": True, "phase": "done", "task_id": "T-123",
                                  "backlog_sync": {"status": "published", "pr": 7}})
        self.assertEqual(calls, [(str(self.root / "sync"), "T-123", issues)])

    def test_reconciled_done_also_syncs(self):
        self.state.update(status="done", status_category="completed")
        with patch.object(c.Live, "project_issues", return_value=[]), \
                patch.object(c.backlog_sync, "publish", return_value={"status": "unchanged"}):
            result = self.live.transition(self.receipt, "done", str(self.root))
        self.assertTrue(result["reconciled"], result)
        self.assertEqual(result["backlog_sync"], {"status": "unchanged"})

    def test_sync_failure_keeps_done_result_and_hides_unsafe_details(self):
        with patch.object(c.Live, "project_issues", return_value=[]), \
                patch.object(c.backlog_sync, "publish", side_effect=c.backlog_sync.PublishError("Command failed: git push (exit 1)")):
            result = self.live.transition(self.receipt, "done", str(self.root))
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["backlog_sync"], {"status": "skipped",
                                                  "reason": "backlog sync failed: Command failed: git push (exit 1)"})
        with patch.object(c.Live, "project_issues", side_effect=ValueError("https://token@example.test")):
            result = self.live.transition(self.receipt, "done", str(self.root))
        self.assertEqual(result["backlog_sync"], {"status": "skipped", "reason": "backlog sync failed: ValueError"})
        self.assertTrue((self.root / "verified" / "T-123.json").exists())

    def test_unconfigured_sync_is_not_attempted(self):
        del self.config["backlog_sync_root"]
        with patch.object(c.backlog_sync, "publish", side_effect=AssertionError("sync is disabled")):
            result = self.live.transition(self.receipt, "done", str(self.root))
        self.assertEqual(result, {"ok": True, "phase": "done", "task_id": "T-123"})

    def test_project_issues_reads_every_page_of_the_project(self):
        pages = [{"issues": [{"identifier": f"ALTE-{n}"} for n in range(100)], "has_more": True},
                 {"issues": [{"identifier": "ALTE-100"}], "has_more": False}]
        seen = []

        def read(inner, *args):
            seen.append(args)
            return pages[len(seen) - 1]

        with patch.object(c.Live, "multica_read", read):
            issues = self.live.project_issues()
        self.assertEqual(len(issues), 101)
        self.assertEqual([args[args.index("--offset") + 1] for args in seen], ["0", "100"])
        self.assertTrue(all(args[:4] == ("issue", "list", "--project", "project") for args in seen))


class CleanupIntegrationTests(unittest.TestCase):
    """Адаптер контроллера и настоящий `cleanup.py` на временном Git-репозитории."""

    def git(self, cwd, *args):
        return subprocess.check_output(["git", "-C", str(cwd), *args], stderr=subprocess.PIPE, text=True).strip()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name).resolve()
        self.repo, self.owned, self.state = root / "repository", root / "owned", root / "state"
        self.repo.mkdir()
        self.git(self.repo, "init", "-b", "app")
        for key, value in (("maintenance.auto", "false"), ("user.name", "Cleanup Test"),
                           ("user.email", "cleanup@example.invalid"), ("commit.gpgsign", "false")):
            self.git(self.repo, "config", key, value)
        (self.repo / ".gitignore").write_text("node_modules/\n")
        (self.repo / "product.txt").write_text("base\n")
        self.git(self.repo, "add", ".")
        self.git(self.repo, "commit", "-m", "base")
        base = self.git(self.repo, "rev-parse", "HEAD")
        remote = root / "origin.git"
        self.git(self.repo, "init", "--bare", str(remote))
        self.git(remote, "config", "maintenance.auto", "false")
        self.git(self.repo, "remote", "add", "origin", str(remote))
        self.worktree = self.owned / "t-123"
        self.git(self.repo, "worktree", "add", "-b", "feat/t-123", str(self.worktree))
        (self.worktree / "product.txt").write_text("feature\n")
        self.git(self.worktree, "commit", "-am", "feature")
        (self.worktree / "node_modules").mkdir()
        (self.worktree / "node_modules" / "pkg.js").write_text("installed\n")
        head = self.git(self.worktree, "rev-parse", "HEAD")
        self.git(self.repo, "merge", "--no-ff", "-m", "merge feature", "feat/t-123")
        merge = self.git(self.repo, "rev-parse", "HEAD")
        report = self.repo / "docs" / "reports" / "tasks" / "T-123.md"
        report.parent.mkdir(parents=True)
        report.write_text(f"T-123 tested {head}\n")
        self.git(self.repo, "add", ".")
        self.git(self.repo, "commit", "-m", "finalization")
        self.git(self.repo, "push", "-q", "origin", "app", "feat/t-123")
        self.verified = {
            "schema_version": 1, "task_id": "T-123", "issue_id": "issue-123", "tested_sha": head,
            "branch": "feat/t-123", "verified": True,
            "pr": {"number": 123, "head_sha": head, "base_ref": "app", "base_sha": base, "merge_sha": merge},
            "finalization": {"path": "docs/reports/tasks/T-123.md", "sha256": hashlib.sha256(report.read_bytes()).hexdigest()}}
        (self.state / "verified").mkdir(parents=True)
        (self.state / "verified" / "T-123.json").write_text(json.dumps(self.verified))
        self.head, self.base = head, base
        self.tasks = [{"id": "run-self", "issue_id": None, "status": "running"}]
        tasks, pull = self.tasks, {"number": 123, "state": "closed", "merged": True, "merge_commit_sha": merge,
                                   "html_url": "https://github.com/example/project/pull/123",
                                   "head": {"sha": head}, "base": {"ref": "app", "sha": base}}
        issue = {"id": "issue-123", "workspace_id": "workspace", "project_id": "project",
                 "metadata": {"task_id": "T-123"}, "status": "done"}
        self.facts = None
        test = self

        class FakeLive(c.Live):
            def multica_read(inner, *args):
                if args[:2] == ("agent", "list"):
                    return [{"id": "finalizer"}]
                if args[:2] == ("agent", "tasks"):
                    return copy.deepcopy(tasks)
                return copy.deepcopy(issue)

            def multica(inner, *args):
                test.assertEqual(args[:2], ("issue", "get"))
                return copy.deepcopy(issue)

            def facts(inner, receipt):
                return copy.deepcopy(test.facts)

            def gh(inner, endpoint):
                return copy.deepcopy(pull)

        self.live = FakeLive({"repo": str(self.repo), "github_repo": "example/project", "workspace_id": "workspace",
                              "project_id": "project", "cleanup_owned_root": str(self.owned),
                              "cleanup_log_dir": str(root / "cleanup-logs")})

    def cleanup(self):
        with c.lock(self.state / "dispatch.lock"), \
                patch.object(c.CleanupEvidence, "worktree_in_use", return_value=False), \
                patch.dict(c.os.environ, {"MULTICA_AGENT_ID": "finalizer"}):
            return self.live.cleanup_task(self.verified, str(self.state))

    def test_done_task_worktree_and_branch_are_removed(self):
        result = self.cleanup()
        self.assertEqual(result["status"], "removed", result)
        self.assertFalse(self.worktree.exists())
        self.assertEqual(self.git(self.repo, "branch", "--list", "feat/t-123"), "")
        self.assertEqual(self.git(self.repo, "ls-remote", "origin", "feat/t-123"), "")

    def test_done_transition_removes_worktree_through_real_cleanup(self):
        # Done уже записан в карточке: сверка перезаписывает принятый итог и под своим lock убирает worktree.
        receipt = {key: value for key, value in copy.deepcopy(self.verified).items() if key != "verified"}
        receipt.update(source={"path": "docs/backlog/tasks/T-123.md"}, baseline_sha=self.base,
                       implementer_id="developer", implementer_run_id="run-d",
                       criteria=[{"id": "AC1", "status": "passed", "evidence": "ci:1"}],
                       review={"actor_id": "reviewer", "run_id": "run-r", "sha": self.head, "verdict": "approved"},
                       deployment={"required": False, "reason": "Документация"})
        self.facts = {"issue_scope_valid": True, "pr": copy.deepcopy(receipt["pr"]), "state": "MERGED",
                      "ci": {"sha": self.head, "passed": True}, "review": copy.deepcopy(receipt["review"]),
                      "review_completed": True, "review_trusted": True, "merge_in_app": True,
                      "finalization_sha256": receipt["finalization"]["sha256"], "requires_deploy": False,
                      "implementer_trusted": True, "files_complete": True}
        with patch.object(c.CleanupEvidence, "worktree_in_use", return_value=False), \
                patch.dict(c.os.environ, {"MULTICA_AGENT_ID": "finalizer"}):
            result = self.live.transition(receipt, "done", str(self.state))
        self.assertTrue(result["reconciled"], result)
        self.assertEqual(result["cleanup"]["status"], "removed", result)
        self.assertEqual(result["cleanup_pending"], [])
        self.assertFalse(self.worktree.exists())

    def test_waiting_rework_of_the_same_task_keeps_worktree(self):
        self.tasks.append({"id": "rework", "issue_id": "issue-123", "status": "queued"})
        result = self.cleanup()
        self.assertEqual(result["status"], "skipped", result)
        self.assertIn("active", result["reason"])
        self.assertTrue(self.worktree.exists())


if __name__ == "__main__":
    unittest.main()
