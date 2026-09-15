"""Сбор до native Claude и дедупликация суточного handoff."""

import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest

import daily_runtime


def snapshot():
    return {"schema_version": 1, "collected_at": "2026-09-15T08:00:00Z",
            "coverage": {"issues": {"status": "complete"}, "executions": {"status": "complete"}},
            "issues": [], "executions": [], "agent_tasks": [], "receipts": []}


class DailyRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.config = {"state_dir": str(self.root), "daily_agent_ids": ["auditor"],
                       "repo": str(self.root / "repo"), "claude_binary": "/native/claude"}
        self.now = dt.datetime(2026, 9, 15, 7, 0, tzinfo=dt.timezone.utc)
        self.calls = []
        self.publications = []

    def tearDown(self):
        self.temporary.cleanup()

    def model(self, config, args, message):
        self.calls.append((config, args, message))
        return 0

    def publish(self, config, date, snapshot):
        self.publications.append(date)
        return {"status": "published", "pr": {"number": 1, "url": "https://example.test/pr/1"},
                "branch": "codex/report"}

    def run_daily(self, collect, **kwargs):
        return daily_runtime.run(self.config, ["--output-format", "stream-json"], "auditor",
                                 collect=collect, model=self.model, publish=self.publish, now=self.now, **kwargs)

    def test_collector_failure_never_calls_model(self):
        def failed(_):
            raise RuntimeError("private transport detail")
        result = self.run_daily(failed)
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["model_called"])
        self.assertEqual(self.calls, [])
        self.assertNotIn("private transport", json.dumps(result))

    def test_unchanged_closed_day_with_new_observation_time_skips_model(self):
        first = self.run_daily(lambda _: snapshot())
        later = {**snapshot(), "collected_at": "2026-09-15T09:00:00Z"}
        second = self.run_daily(lambda _: later)
        self.assertEqual(first["status"], "completed")
        self.assertEqual(second["status"], "no_action")
        self.assertFalse(second["model_called"])
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.publications, ["2026-09-15"])

    def test_before_model_files_exist_and_native_handoff_is_bounded(self):
        data = snapshot()
        data["issues"] = [{"id": str(index), "title": "RAW HISTORY " * 100,
                           "created_at": "2026-09-14T12:00:00Z"} for index in range(400)]
        args = ["--input-format", "stream-json", "--output-format", "stream-json", "--mcp-config", "/managed/mcp.json"]
        captured = []
        def native(config, actual_args, message):
            handoff = json.loads(message.split("ALTERA_DAILY_PREPARED_V1\n", 1)[1])
            source = Path(handoff["snapshot_path"])
            report = Path(handoff["report_json"])
            self.assertTrue(source.is_file())
            self.assertEqual(json.loads(source.read_text())["issues"][0]["id"], "0")
            self.assertEqual(json.loads(report.read_text())["tasks"]["created"], 400)
            self.assertEqual(handoff["publication"]["pr"]["url"], "https://example.test/pr/1")
            self.assertNotIn("publisher_argv", handoff)
            self.assertLess(len(message), 8192)
            self.assertNotIn("RAW HISTORY", message)
            captured.append(actual_args)
            return 0
        result = daily_runtime.run(self.config, args, "auditor", collect=lambda _: data,
                                   model=native, publish=self.publish, now=self.now)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(captured, [args])

    def test_unknown_agent_cannot_collect_or_invoke_native_model(self):
        collected = []
        result = daily_runtime.run(self.config, [], "other-agent", collect=lambda _: collected.append(True),
                                   model=self.model, now=self.now)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(collected, [])
        self.assertEqual(self.calls, [])

    def test_publisher_failure_keeps_prepared_data_and_never_calls_model(self):
        def failed(*args):
            raise RuntimeError("publisher failed after safe preparation")
        result = daily_runtime.run(self.config, [], "auditor", collect=lambda _: snapshot(),
                                   model=self.model, publish=failed, now=self.now)
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["model_called"])
        self.assertTrue((self.root / "daily/prepared/docs/reports/autonomy/2026-09-15.json").is_file())
        self.assertEqual(self.calls, [])

    def test_already_published_unchanged_day_does_not_call_model(self):
        result = daily_runtime.run(self.config, [], "auditor", collect=lambda _: snapshot(),
                                   model=self.model, publish=lambda *args: {
                                       "status": "unchanged", "pr": {"number": 1, "url": "https://example.test/pr/1"}},
                                   now=self.now)
        self.assertEqual(result["status"], "no_action")
        self.assertEqual(self.calls, [])

    def test_last_closed_day_changes_exactly_at_ten_moscow(self):
        before = daily_runtime.closed_date(dt.datetime(2026, 9, 15, 6, 59, 59, tzinfo=dt.timezone.utc))
        boundary = daily_runtime.closed_date(self.now)
        self.assertEqual(before, "2026-09-14")
        self.assertEqual(boundary, "2026-09-15")

    def test_partial_critical_inventory_is_saved_without_model(self):
        data = snapshot()
        data["coverage"]["issues"] = {"status": "partial", "reason": "source_command_failed"}
        result = self.run_daily(lambda _: data)
        self.assertEqual(result["status"], "failed")
        self.assertTrue(Path(result["snapshot_path"]).is_file())
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
