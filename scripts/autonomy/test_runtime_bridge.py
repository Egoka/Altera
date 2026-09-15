import io
import json
from pathlib import Path
import tempfile
import unittest

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


if __name__ == "__main__":
    unittest.main()
