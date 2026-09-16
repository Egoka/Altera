import datetime as dt
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import runtime_bridge as r


class BridgeTests(unittest.TestCase):
    def test_duplicate_snapshot_does_not_invoke_model(self):
        with tempfile.TemporaryDirectory() as root:
            config = {"state_dir": root}
            calls = []
            def model(message):
                calls.append(message)
                return 0
            snapshot = {"issues": [
                {"id": "a", "status": "in_progress"},
                {"id": "i", "status": "todo"},
                {"id": "j", "status": "todo"},
                {"id": "k", "status": "todo"},
            ], "prs": []}
            first = r.dispatch(config, snapshot, "prompt", model)
            second = r.dispatch(config, snapshot, "other delivery wrapper", model)
            self.assertEqual(first["model_called"], True)
            self.assertEqual(second["model_called"], False)
            self.assertEqual(second["status"], "no_action")
            self.assertEqual(second["exit_code"], 0)
            self.assertEqual(len(calls), 1)

    def test_queue_deficit_rechecks_once_in_each_liveness_window(self):
        with tempfile.TemporaryDirectory() as root:
            config = {"state_dir": root, "queue_target_todo": 3, "liveness_interval_seconds": 3600}
            calls = []
            current = dt.datetime(2026, 9, 16, 3, 0, tzinfo=dt.timezone.utc)
            snapshot = {"issues": [{"id": "i", "status": "todo"}], "prs": []}
            first = r.dispatch(config, snapshot, "prompt", lambda message: calls.append(message) or 0,
                               now=current)
            duplicate = r.dispatch(config, snapshot, "prompt", lambda message: calls.append(message) or 0,
                                   now=current + dt.timedelta(minutes=30))
            next_window = r.dispatch(config, snapshot, "prompt", lambda message: calls.append(message) or 0,
                                     now=current + dt.timedelta(hours=1))
            self.assertTrue(first["model_called"])
            self.assertFalse(duplicate["model_called"])
            self.assertTrue(next_window["model_called"])
            self.assertEqual(len(calls), 2)
            attention = json.loads(calls[-1].split("ALTERA_CONTROLLER_ATTENTION_V1\n")[1]
                                   .split("\n\nALTERA_CONTROLLER_DELTA_V1", 1)[0])
            self.assertEqual(attention["todo_count"], 1)
            self.assertEqual(attention["todo_deficit"], 2)
            self.assertIn("refill_queue", attention["reasons"])
            self.assertIn("dispatch_ready_work", attention["reasons"])

    def test_status_category_drives_queue_attention(self):
        snapshot = {"issues": [
            {"id": "a", "status": "custom", "status_category": "started"},
            {"id": "i", "status": "custom", "status_category": "todo"},
            {"id": "j", "status": "custom", "status_category": "todo"},
            {"id": "k", "status": "custom", "status_category": "todo"},
        ]}
        self.assertIsNone(r.queue_attention({"queue_target_todo": 3}, snapshot))

    def test_interrupted_event_requires_reconciliation_without_repeating_model(self):
        with tempfile.TemporaryDirectory() as root:
            config = {"state_dir": root}
            calls = []
            def interrupted(message):
                calls.append(message)
                raise RuntimeError("native process interrupted")
            with self.assertRaises(RuntimeError):
                r.dispatch(config, {}, "prompt", interrupted)
            result = r.dispatch(config, {}, "prompt", interrupted)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["reason"], "reconciliation_required")
            self.assertEqual(result["exit_code"], 2)
            self.assertFalse(result["model_called"])
            self.assertEqual(len(calls), 1)
            output = io.StringIO()
            r.emit(result, output)
            self.assertTrue(json.loads(output.getvalue())["is_error"])

    def test_exhausted_attempts_remain_failed_without_repeating_model(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []
            def failed(message):
                calls.append(message)
                return 1
            results = [r.dispatch({"state_dir": root}, {}, "prompt", failed) for _ in range(4)]
            self.assertEqual([result["status"] for result in results], ["failed"] * 4)
            self.assertEqual(results[-1]["reason"], "reconciliation_required")
            self.assertEqual(results[-1]["exit_code"], 2)
            self.assertFalse(results[-1]["model_called"])
            self.assertEqual(len(calls), 3)

    def test_new_data_dispatches_once(self):
        with tempfile.TemporaryDirectory() as root:
            config = {"state_dir": root}
            calls = []
            for status in ["todo", "in_progress", "in_progress"]:
                r.dispatch(config, {"issues": [{"id": "i", "status": status}], "prs": []}, "prompt", lambda p: calls.append(p) or 0)
            self.assertEqual(len(calls), 2)

    def test_change_of_instruction_invalidates_snapshot(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []
            snapshot = {"issues": [{"id": "i", "status": "todo"}], "prs": []}
            for version in ["v1", "v2"]:
                r.dispatch({"state_dir": root, "instructions_version": version}, snapshot, "p", lambda p: calls.append(p) or 0)
            self.assertEqual(len(calls), 2)
            for message in calls:
                self.assertEqual(json.loads(message.split("ALTERA_CONTROLLER_DELTA_V1\n")[1]), snapshot)

    def test_allowed_agents_have_separate_events_and_snapshot_cursors(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "config.json"
            path.write_text(json.dumps({"state_dir": root, "controller_agent_ids": ["diagnostic", "real"],
                                        "event_namespace": "must_be_overridden"}))
            snapshot = {"issues": [{"id": "i", "status": "todo"}], "prs": []}
            calls = []
            emitted = []
            def native(config, args, message):
                calls.append((config["event_namespace"], json.loads(message.split("ALTERA_CONTROLLER_DELTA_V1\n")[1])))
                return 0
            with patch.object(r, "Live"), patch.object(r, "snapshot", return_value=snapshot), \
                    patch.object(r, "native_model", side_effect=native), patch.object(r, "emit", side_effect=emitted.append), \
                    patch.object(r.sys, "argv", ["runtime_bridge.py"]):
                for actor in ["diagnostic", "real", "diagnostic", "real"]:
                    with patch.dict(r.os.environ, {"ALTERA_AUTONOMY_CONFIG": str(path), "MULTICA_AGENT_ID": actor}), \
                            patch.object(r.sys, "stdin", io.StringIO(json.dumps({"message": {"content": "prompt"}}) + "\n")):
                        self.assertEqual(r.main(), 0)
            self.assertEqual(calls, [("diagnostic", snapshot), ("real", snapshot)])
            self.assertEqual([result["status"] for result in emitted], ["no_action", "no_action"])
            self.assertTrue(all(result["model_called"] is False for result in emitted))

    def test_protocol_result_truthfully_identifies_controller(self):
        output = io.StringIO()
        r.emit({"status": "no_action", "model_called": False}, output)
        result = json.loads(output.getvalue().splitlines()[-1])
        self.assertEqual(result["type"], "result")
        self.assertEqual(result["usage"]["input_tokens"], 0)
        self.assertEqual(result["session_id"], "")
        self.assertIn("controller", result["result"])


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        class FixtureLive:
            config = {"project_id": "project", "controller_agent_ids": ["coordinator"]}
            gh_repo = "owner/repo"
            comments = [{"id": "c1", "author_id": "human", "content": "first comment"}]
            runs = [{"id": "run1", "agent_id": "developer", "status": "running", "result": None}]
            reads = []

            def multica_read(inner, *args):
                inner.reads.append(args)
                if args[:2] == ("issue", "list"):
                    return {"issues": [{"id": "i1", "status": "todo"}], "has_more": False}
                if args[:2] == ("issue", "runs"):
                    return inner.runs
                if args[:3] == ("issue", "comment", "list"):
                    self.assertNotIn("--since", args)
                    return inner.comments
                raise AssertionError("unexpected read")

            def gh(inner, endpoint):
                return {"object": {"sha": "a" * 40}}

        self.live = FixtureLive()

    def snapshot(self, prs=None):
        with patch.object(r, "read_command", return_value=prs if prs is not None else [self.page([], False)]):
            return r.snapshot(self.live)

    @staticmethod
    def page(prs, more, cursor="last"):
        return {"data": {"repository": {"pullRequests": {"nodes": prs, "pageInfo": {"hasNextPage": more, "endCursor": cursor}}}}}

    @staticmethod
    def pr(number, contexts=None, more_contexts=False):
        return {"number": number, "state": "OPEN", "headRefOid": "a" * 40, "baseRefName": "app",
                "commits": {"nodes": [{"commit": {"statusCheckRollup": {"contexts": {
                    "nodes": contexts or [], "pageInfo": {"hasNextPage": more_contexts}
                }}}}]}}

    def test_comment_edit_without_revision_changes_event_key_and_unchanged_rerun_is_noop(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []
            config = {"state_dir": root}
            initial = self.snapshot()
            one = r.dispatch(config, initial, "p", lambda message: calls.append(message) or 0)
            self.live.comments[0]["content"] = "edited comment"
            edited = self.snapshot()
            two = r.dispatch(config, edited, "p", lambda message: calls.append(message) or 0)
            three = r.dispatch(config, self.snapshot(), "p", lambda message: calls.append(message) or 0)
            self.assertNotEqual(one["event_key"], two["event_key"])
            self.assertFalse(three["model_called"])
            self.assertEqual(len(calls), 2)
            self.assertNotIn("edited comment", json.dumps(edited))

    def test_updated_at_detects_edit_beyond_unchanged_summary(self):
        self.live.comments[0].update(content="same preview", content_truncated=True, updated_at="2026-09-15T10:00:00Z")
        before = self.snapshot()
        self.live.comments[0]["updated_at"] = "2026-09-15T10:01:00Z"
        self.assertNotEqual(r.fingerprint(before), r.fingerprint(self.snapshot()))

    def test_native_run_completion_changes_event_key_once(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []
            config = {"state_dir": root}
            before = r.dispatch(config, self.snapshot(), "p", lambda message: calls.append(message) or 0)
            self.live.runs[0].update(status="completed", result={"output": "finished"})
            after = r.dispatch(config, self.snapshot(), "p", lambda message: calls.append(message) or 0)
            repeated = r.dispatch(config, self.snapshot(), "p", lambda message: calls.append(message) or 0)
            self.assertNotEqual(before["event_key"], after["event_key"])
            self.assertFalse(repeated["model_called"])
            self.assertEqual(len(calls), 2)

    def test_all_pr_pages_beyond_one_hundred_are_collected_with_check_projection(self):
        checks = [{"__typename": "CheckRun", "name": "test", "status": "COMPLETED", "conclusion": "SUCCESS"},
                  {"__typename": "StatusContext", "context": "external", "state": "SUCCESS"}]
        pages = [self.page([self.pr(number) for number in range(1, 101)], True, "cursor-100"),
                 self.page([self.pr(101, checks)], False, "cursor-101")]
        with patch.object(r, "read_command", return_value=pages) as source:
            result = r.snapshot(self.live)
        self.assertEqual(len(result["prs"]), 101)
        self.assertEqual(result["prs"][-1]["checks"], [("external", "SUCCESS", ""), ("test", "SUCCESS", "COMPLETED")])
        args = source.call_args.args[0]
        self.assertEqual(args[:5], ["gh", "api", "graphql", "--paginate", "--slurp"])
        self.assertIn("owner=owner", args)
        self.assertIn("name=repo", args)

    def test_missing_final_pr_page_and_incomplete_check_contexts_are_rejected(self):
        for pages in ([self.page([self.pr(1)], True)], [self.page([self.pr(1, more_contexts=True)], False)]):
            with self.subTest(pages=pages), self.assertRaises(RuntimeError):
                self.snapshot(pages)

    def test_truncated_summary_without_edit_metadata_is_explicitly_partial(self):
        self.live.comments[0]["content_truncated"] = True
        self.assertEqual(self.snapshot()["issues"][0]["comment_edit_coverage"], "partial")

    def test_done_issues_do_not_trigger_deep_run_or_comment_reads(self):
        original = self.live.multica_read
        def multica_read(*args):
            if args[:2] == ("issue", "list"):
                return {"issues": [
                    {"id": "done", "status": "done", "status_category": "done"},
                    {"id": "todo", "status": "todo", "status_category": "todo"},
                ], "has_more": False}
            return original(*args)
        self.live.multica_read = multica_read
        result = self.snapshot()
        deep_ids = [args[2] if args[:2] == ("issue", "runs") else args[3]
                    for args in self.live.reads
                    if args[:2] == ("issue", "runs") or args[:3] == ("issue", "comment", "list")]
        self.assertEqual(deep_ids, ["todo", "todo"])
        self.assertEqual([item["id"] for item in result["issues"]], ["done", "todo"])


class FailureReportingTests(unittest.TestCase):
    def test_command_failure_reports_safe_source_without_stderr(self):
        error = r.ExternalCommandError(["/secret/path/multica", "issue", "list"], 17)
        details = r.failure_details(error)
        self.assertEqual(details, {"error_type": "ExternalCommandError", "error_code": "external_command_failed",
                                   "error_source": "multica", "exit_code": 17})
        self.assertNotIn("secret", json.dumps(details))


if __name__ == "__main__":
    unittest.main()

class NativeProtocolTests(unittest.TestCase):
    def test_native_child_receives_input_eof(self):
        from unittest.mock import patch
        import sys
        with tempfile.TemporaryDirectory() as root:
            child = Path(root) / 'child.py'
            output = Path(root) / 'received.json'
            child.write_text('import sys\nfrom pathlib import Path\nPath(sys.argv[1]).write_text(sys.stdin.read())\n')
            with patch.object(r.sys, 'stdin', io.StringIO('')):
                code = r.native_model({'claude_binary': sys.executable}, [str(child), str(output)], 'hello')
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(output.read_text())['message']['content'], 'hello')

    def test_native_child_receives_canonical_multica_scope(self):
        import sys
        with tempfile.TemporaryDirectory() as root:
            child = Path(root) / "child.py"
            output = Path(root) / "env.json"
            child.write_text(
                "import json,os,sys\n"
                "from pathlib import Path\n"
                "Path(sys.argv[1]).write_text(json.dumps({k: os.environ.get(k) for k in "
                "['MULTICA_SERVER_URL','MULTICA_WORKSPACE_ID','ALTERA_MULTICA_PROJECT_ID',"
                "'ALTERA_MULTICA_BINARY','PATH']}))\n"
            )
            config = {
                "claude_binary": sys.executable,
                "server_url": "https://api.example.test",
                "workspace_id": "workspace",
                "project_id": "project",
                "multica": "/opt/multica",
                "multica_guard_dir": str(Path(root) / "guard"),
            }
            with patch.object(r.sys, "stdin", io.StringIO("")):
                self.assertEqual(r.native_model(config, [str(child), str(output)], "hello"), 0)
            env = json.loads(output.read_text())
            self.assertEqual(env["MULTICA_SERVER_URL"], config["server_url"])
            self.assertEqual(env["MULTICA_WORKSPACE_ID"], "workspace")
            self.assertEqual(env["ALTERA_MULTICA_PROJECT_ID"], "project")
            self.assertEqual(env["ALTERA_MULTICA_BINARY"], "/opt/multica")
            self.assertEqual(env["PATH"].split(r.os.pathsep)[0], config["multica_guard_dir"])

    def test_failed_event_allows_only_two_retries(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []
            for _ in range(5):
                r.dispatch({'state_dir': root}, {'app_sha': 'x'}, 'p', lambda p: calls.append(p) or 1)
            self.assertEqual(len(calls), 3)
