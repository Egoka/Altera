"""Проверки отчётности на независимых небольших срезах."""

import copy
import json
from pathlib import Path
import tempfile
import unittest
import sys
from unittest.mock import patch

try:
    from . import reporting
except ImportError:
    import reporting


def snapshot():
    return {
        "schema_version": 1,
        "collected_at": "2026-09-15T08:00:00Z",
        "coverage": {"issues": "complete", "executions": "complete"},
        "issues": [], "executions": [], "agent_tasks": [], "receipts": [],
    }


def run(identifier="r1", **extra):
    return {"id": identifier, "created_at": "2026-09-14T08:00:00Z",
            "completed_at": "2026-09-14T08:10:00Z", "status": "completed",
            "usage": [{"model": "test-model", "input_tokens": 100,
                       "output_tokens": 20, "cache_read_tokens": 0,
                       "cache_write_tokens": 5}], **extra}


class ReportingTests(unittest.TestCase):
    def test_collector_pages_all_issue_states_and_links_autopilot_native_usage(self):
        def command(args):
            if "issue" in args and "list" in args:
                offset = int(args[args.index("--offset") + 1])
                if offset == 0:
                    return {"issues": [{"id": "i1", "project_id": "project", "status": "closed",
                                        "metadata": {"task_id": "T-1", "api_key": "redact"}}],
                            "has_more": True}
                return {"issues": [{"id": "i2", "project_id": "project", "status": "open"}],
                        "has_more": False}
            if "issue" in args and "runs" in args:
                return [run("native", issue_id="i1")] if "i1" in args else []
            if "autopilot" in args and "list" in args:
                return {"autopilots": [{"id": "ap", "project_id": "project"}], "total": 1}
            if "autopilot" in args and "runs" in args:
                return {"runs": [{"id": "ap-event", "task_id": "ap-native", "autopilot_id": "ap"}], "total": 1}
            if "agent" in args and "list" in args:
                return [{"id": "agent"}]
            if "agent" in args and "tasks" in args:
                return [run("native", issue_id="i1"), run("ap-native"),
                        run("other-project", issue_id="unrelated")]
            return []

        data = reporting.collect_live("multica", "https://example.test", "workspace", "project",
                                      "owner/repo", run_json=command,
                                      collected_at="2026-09-15T08:00:00Z")
        self.assertEqual(len(data["issues"]), 2)
        self.assertEqual(data["issues"][0]["metadata"], {"task_id": "T-1"})
        result = reporting.build_report(data, "2026-09-15")
        self.assertEqual(result["executions"]["ids"], ["ap-native", "native"])
        self.assertEqual(result["executions"]["autopilot"], 1)
        self.assertEqual(result["tokens"]["input_tokens"]["observed"], 200)

    def test_collection_failure_or_page_cap_is_visible_partial_coverage(self):
        def command(args):
            if "issue" in args and "list" in args:
                return {"issues": [{"id": "i1"}], "has_more": True}
            if "issue" in args and "runs" in args:
                raise RuntimeError("sensitive error must not be copied")
            return []

        data = reporting.collect_live("multica", "https://example.test", "workspace", "project",
                                      "owner/repo", run_json=command, max_pages=1)
        self.assertEqual(data["coverage"]["issues"]["status"], "partial")
        self.assertEqual(data["coverage"]["executions"]["status"], "partial")
        self.assertNotIn("sensitive", json.dumps(data))

    def test_unique_native_execution_ids_include_autopilot_without_double_billing(self):
        data = snapshot()
        data["executions"] = [run()]
        data["agent_tasks"] = [run(), run("ap-task", kind="autopilot")]
        result = reporting.build_report(data, "2026-09-15")
        self.assertEqual(result["executions"]["count"], 2)
        self.assertEqual(result["executions"]["autopilot"], 1)
        self.assertEqual(result["tokens"]["input_tokens"]["observed"], 200)

    def test_duplicate_usage_rows_keep_autopilot_link_from_agent_history(self):
        data = snapshot()
        data["executions"] = [run()]
        data["agent_tasks"] = [run(autopilot_id="ap", kind="autopilot")]
        result = reporting.build_report(data, "2026-09-15")
        self.assertEqual(result["executions"]["autopilot"], 1)
        self.assertEqual(result["tokens"]["input_tokens"]["observed"], 100)

    def test_missing_autopilot_usage_still_counts_known_native_attempt(self):
        def command(args):
            if "issue" in args and "list" in args:
                return {"issues": [], "has_more": False}
            if "autopilot" in args and "list" in args:
                return {"autopilots": [{"id": "ap", "project_id": "project"}]}
            if "autopilot" in args and "runs" in args:
                return {"runs": [{"id": "event", "task_id": "native", "autopilot_id": "ap",
                                  "created_at": "2026-09-14T08:00:00Z"}], "total": 1}
            return []
        data = reporting.collect_live("multica", "https://example.test", "workspace", "project",
                                      "owner/repo", run_json=command)
        result = reporting.build_report(data, "2026-09-15")
        self.assertEqual(result["executions"]["count"], 1)
        self.assertEqual(result["tokens"]["input_tokens"]["total_runs"], 1)
        self.assertIsNone(result["tokens"]["input_tokens"]["observed"])
        self.assertEqual(data["coverage"]["executions"]["status"], "partial")

    def test_partial_usage_is_unknown_and_zero_remains_measured_zero(self):
        data = snapshot()
        data["executions"] = [run(), run("r2", usage=None),
                              run("r3", usage=[{"model": "other", "input_tokens": 0}])]
        result = reporting.build_report(data, "2026-09-15")
        self.assertEqual(result["tokens"]["input_tokens"],
                         {"observed": 100, "known_runs": 2, "total_runs": 3, "complete": False})
        self.assertEqual(result["tokens"]["output_tokens"]["known_runs"], 1)
        empty = reporting.build_report(snapshot(), "2026-09-15")
        self.assertIsNone(empty["tokens"]["input_tokens"]["observed"])

    def test_half_open_moscow_window_and_late_completion_use_created_cohort(self):
        data = snapshot()
        data["executions"] = [run("before", created_at="2026-09-14T06:59:59Z"),
                              run("start", created_at="2026-09-14T07:00:00Z",
                                  completed_at="2026-09-15T07:30:00Z"),
                              run("end", created_at="2026-09-15T07:00:00Z"),
                              run("missing", created_at=None)]
        result = reporting.build_report(data, "2026-09-15")
        self.assertEqual(result["executions"]["ids"], ["start"])
        self.assertEqual(result["executions"]["late_completed"], 1)
        self.assertEqual(result["executions"]["unknown_created_at"], 1)
        self.assertEqual(result["window"]["start"], "2026-09-14T07:00:00Z")

    def test_claimed_done_is_not_verified_and_acceptance_has_own_cohort(self):
        data = snapshot()
        data["issues"] = [
            {"id": "old", "created_at": "2026-08-01T00:00:00Z", "status_category": "completed"},
            {"id": "unproven", "created_at": "2026-09-14T08:00:00Z", "status_category": "completed"},
            {"id": "repair", "created_at": "2026-09-14T08:00:00Z", "parent_issue_id": "old"},
        ]
        data["receipts"] = [
            {"task_id": "old", "verified": True, "accepted_at": "2026-09-14T09:00:00Z",
             "work_class": "product", "acceptance": {"passed": 3, "total": 3}},
            {"task_id": "unproven", "verified": False, "accepted_at": "2026-09-14T10:00:00Z"},
            {"task_id": "repair", "verified": True, "accepted_at": "2026-09-14T11:00:00Z",
             "work_class": "self_rework"},
        ]
        result = reporting.build_report(data, "2026-09-15")
        self.assertEqual(result["tasks"]["created"], 2)
        self.assertEqual(result["tasks"]["created_parents"], 1)
        self.assertEqual(result["tasks"]["verified_accepted"], 2)
        self.assertEqual(result["tasks"]["useful_accepted"], 1)
        self.assertEqual(result["tasks"]["self_rework_accepted"], 1)
        self.assertEqual(result["tasks"]["done_without_verified_receipt"], 1)

    def test_publication_is_idempotent_and_corrections_preserve_prior_version(self):
        data = snapshot()
        data["executions"] = [run(usage=None)]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reporting.publish(data, "2026-09-15", root)
            path = root / "docs/reports/autonomy/2026-09-15.json"
            first = path.read_bytes()
            reporting.publish(data, "2026-09-15", root)
            self.assertEqual(first, path.read_bytes())
            self.assertEqual(list((path.parent / ".history").glob("**/*.json")), [])
            corrected = copy.deepcopy(data)
            corrected["executions"] = [run()]
            reporting.publish(corrected, "2026-09-15", root)
            versions = list((path.parent / ".history").glob("**/*.json"))
            self.assertEqual(len(versions), 1)
            self.assertEqual(versions[0].read_bytes(), first)
            self.assertIn("2026-09-15", (root / "PROGRESS.md").read_text())
            self.assertEqual(json.loads(path.read_text())["revision"], 2)

    def test_period_metrics_report_missing_days_and_do_not_average_daily_medians(self):
        one, two = snapshot(), snapshot()
        one["executions"] = [run("a", started_at="2026-09-14T08:00:00Z",
                                 completed_at="2026-09-14T08:00:01Z"),
                             run("b", started_at="2026-09-14T08:00:00Z",
                                 completed_at="2026-09-14T08:00:03Z")]
        two["executions"] = [run("c", created_at="2026-09-15T08:00:00Z",
                                 started_at="2026-09-15T08:00:00Z",
                                 completed_at="2026-09-15T08:01:40Z")]
        reports = [reporting.build_report(one, "2026-09-15"),
                   reporting.build_report(two, "2026-09-16")]
        result = reporting.aggregate_period(reports, "2026-09-16", 7)
        self.assertEqual(result["covered_days"], 2)
        self.assertEqual(len(result["missing_dates"]), 5)
        self.assertEqual(result["timings"]["execution_seconds"]["median"], 3)
        self.assertEqual(result["timings"]["execution_seconds"]["p90"], 100)

    def test_receipt_links_canonical_task_to_native_issue_and_raw_output_is_not_published(self):
        data = snapshot()
        data["issues"] = [{"id": "native-issue", "status_category": "completed",
                           "metadata": {"task_id": "T-123"}}]
        data["receipts"] = [{"task_id": "T-123", "verified": True,
                             "accepted_at": "2026-09-14T09:00:00Z",
                             "source": {"issue_id": "native-issue"},
                             "tests": {"passed": 3, "skipped": 1, "raw_logs": "sensitive output"}}]
        result = reporting.build_report(data, "2026-09-15")
        self.assertEqual(result["tasks"]["done_without_verified_receipt"], 0)
        self.assertNotIn("sensitive output", json.dumps(result))

    def test_malformed_github_payload_cannot_claim_complete_coverage(self):
        def command(args):
            if args[0] == "gh":
                return {"error": "not an actual list"}
            if "issue" in args:
                return {"issues": [], "has_more": False}
            return []
        result = reporting.collect_live("multica", "https://example.test", "ws", "project",
                                        "owner/repo", run_json=command)
        self.assertEqual(result["coverage"]["pull_requests"]["status"], "partial")

    def test_only_explicit_native_no_action_marker_counts(self):
        self.assertIs(reporting.no_action_result({"output": "NO_ACTION"}), True)
        self.assertIs(reporting.no_action_result({"output": '{"no_action": false}'}), False)
        self.assertIsNone(reporting.no_action_result({"output": "I considered NO_ACTION but made a fix"}))

    def test_controller_receipts_directory_ignores_unverified_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "verified.json").write_text(json.dumps({"task_id": "T-1", "verified": True}))
            (root / "unverified.json").write_text(json.dumps({"task_id": "T-2", "verified": False}))
            result = reporting.load_controller_receipts(root)
            self.assertEqual([row["task_id"] for row in result], ["T-1"])

    def test_issue_metadata_drops_credentials_and_raw_stdio(self):
        data = snapshot()
        data["issues"] = [{"id": "issue", "metadata": {
            "task_id": "T-1", "DATABASE_URL": "postgresql://u:synthetic-secret@host/db",
            "stdout": "private execution trace", "neutral": "postgresql://u:synthetic-secret@host/db",
            "environment": {"JWT_ACCESS_SECRET": "another secret"}}}]
        result = reporting.build_report(data, "2026-09-15")
        serialized = json.dumps(result)
        self.assertNotIn("synthetic-secret", serialized)
        self.assertNotIn("private execution trace", serialized)
        self.assertNotIn("another secret", serialized)
        self.assertEqual(result["issue_metadata"][0]["metadata"]["task_id"], "T-1")

    def test_publication_rejects_output_directory_symlink_outside_root(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root, outside = parent / "root", parent / "outside"
            (root / "docs/reports").mkdir(parents=True)
            outside.mkdir()
            (root / "docs/reports/autonomy").symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError):
                reporting.publish(snapshot(), "2026-09-15", root)
            self.assertEqual(list(outside.iterdir()), [])

    def test_malformed_multica_payload_cannot_claim_empty_complete_inventory(self):
        def command(args):
            if "issue" in args:
                return {"has_more": False, "error": "unauthorized"}
            return []
        result = reporting.collect_live("multica", "https://example.test", "ws", "project",
                                        "owner/repo", run_json=command)
        self.assertEqual(result["coverage"]["issues"]["status"], "partial")
        self.assertEqual(result["coverage"]["executions"]["status"], "partial")

    def test_report_is_short_with_large_source_inventory_and_covers_legacy_work(self):
        data = snapshot()
        data["coverage"] = {f"issue:{index}": {"status": "complete"} for index in range(300)}
        data["coverage"]["ci"] = {"status": "partial", "reason": "timeout"}
        data["issues"] = [{"id": "old", "title": "Legacy task", "created_at": "2026-08-01T00:00:00Z",
                           "status_category": "completed"}]
        data["executions"] = [run(issue_id="old")]
        result = reporting.build_report(data, "2026-09-15")
        self.assertEqual(result["task_evidence"][0]["task_id"], "old")
        self.assertIs(result["task_evidence"][0]["verified"], False)
        markdown = reporting.render_report(result)
        self.assertIn("Legacy task", markdown)
        self.assertIn("ci", markdown)
        self.assertNotIn('"issue:299"', markdown)
        self.assertLess(len(markdown.splitlines()), 150)

    def test_controller_criteria_and_native_issue_id_are_recognized(self):
        data = snapshot()
        data["issues"] = [{"id": "native", "status_category": "completed"}]
        data["receipts"] = [{"task_id": "T-1", "issue_id": "native", "verified": True,
                             "accepted_at": "2026-09-14T12:00:00Z",
                             "criteria": [{"id": "AC1", "passed": True}, {"id": "AC2", "passed": False}]}]
        result = reporting.build_report(data, "2026-09-15")
        self.assertEqual(result["tasks"]["done_without_verified_receipt"], 0)
        self.assertEqual(result["task_evidence"][0]["acceptance"], {"passed": 1, "total": 2})

    def test_source_command_retries_transient_read_failure_once(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "attempt"
            program = (
                "from pathlib import Path; import sys; "
                "p=Path(sys.argv[1]); n=int(p.read_text()) if p.exists() else 0; "
                "p.write_text(str(n+1)); print('{\"ok\": true}'); sys.exit(1 if n==0 else 0)"
            )
            result = reporting.json_command([sys.executable, "-c", program, str(marker)])
            self.assertEqual(result, {"ok": True})
            self.assertEqual(marker.read_text(), "2")

    def test_controller_verified_review_is_bound_to_distinct_actor_and_tested_sha(self):
        data = snapshot()
        data["receipts"] = [{"task_id": "T-1", "verified": True, "implementer_id": "builder",
                             "accepted_at": "2026-09-14T12:00:00Z", "tested_sha": "abc",
                             "review": {"actor_id": "reviewer", "verdict": "approved", "tested_sha": "abc"}}]
        self.assertEqual(reporting.build_report(data, "2026-09-15")["quality"]["independent_review_verified"], 1)
        data["receipts"][0]["review"]["actor_id"] = "builder"
        self.assertEqual(reporting.build_report(data, "2026-09-15")["quality"]["independent_review_verified"], 0)

    def test_actual_controller_verified_receipt_uses_review_sha(self):
        data = snapshot()
        data["receipts"] = [{"task_id": "T-1", "verified": True, "implementer_id": "builder",
                             "accepted_at": "2026-09-14T12:00:00Z", "tested_sha": "abc",
                             "review": {"actor_id": "reviewer", "verdict": "approved", "sha": "abc"}}]
        self.assertEqual(reporting.build_report(data, "2026-09-15")["quality"]["independent_review_verified"], 1)

    def test_missing_receipt_directory_does_not_discard_collected_snapshot(self):
        data = snapshot()
        data["executions"] = [run()]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "snapshot.json"
            with patch.object(reporting, "collect_live", return_value=data):
                result = reporting.main(["collect", "--server-url", "https://example.test", "--workspace-id", "ws",
                                         "--project-id", "project", "--repo", "owner/repo",
                                         "--receipts-dir", str(root / "not-created"), "--output", str(output)])
            saved = json.loads(output.read_text())
            self.assertEqual(result, 0)
            self.assertEqual(len(saved["executions"]), 1)
            self.assertEqual(saved["coverage"]["receipts"]["status"], "partial")
            self.assertEqual(saved["coverage"]["receipts"]["reason"], "controller_verified_directory_missing")


if __name__ == "__main__":
    unittest.main()
