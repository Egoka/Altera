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
            snapshot = {"issues": [{"id": "i", "status": "todo"}], "prs": []}
            first = r.dispatch(config, snapshot, "prompt", model)
            second = r.dispatch(config, snapshot, "other delivery wrapper", model)
            self.assertEqual(first["model_called"], True)
            self.assertEqual(second["model_called"], False)
            self.assertEqual(len(calls), 1)

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
            for version in ["v1", "v2"]:
                r.dispatch({"state_dir": root, "instructions_version": version}, {}, "p", lambda p: calls.append(p) or 0)
            self.assertEqual(len(calls), 2)

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

            def multica(inner, *args):
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
        with patch.object(r, "command", return_value=prs if prs is not None else [self.page([], False)]):
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
        with patch.object(r, "command", return_value=pages) as source:
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

    def test_failed_event_allows_only_two_retries(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []
            for _ in range(5):
                r.dispatch({'state_dir': root}, {'app_sha': 'x'}, 'p', lambda p: calls.append(p) or 1)
            self.assertEqual(len(calls), 3)
