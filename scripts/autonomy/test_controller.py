"""Проверки контракта завершения и подавления повторных событий."""
import copy
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


if __name__ == "__main__":
    unittest.main()
