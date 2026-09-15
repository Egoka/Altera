import copy
import datetime as dt
import json
import unittest
from unittest.mock import patch
import deploy_evidence as d


class DeployEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime.now(dt.timezone.utc)
        self.config = {"render_service_id": "srv-test", "render_workspace_id": "ws-test"}
        tool = "mcp__plugin_render_render__get_deploy"
        self.messages = [
            {"type": "tool_use", "tool": tool, "seq": 10, "input": {"serviceId": "srv-test", "workspaceId": "ws-test", "deployId": "dep-test"}},
            {"type": "tool_result", "tool": tool, "seq": 11, "created_at": self.now.isoformat(), "output_truncated": False,
             "output": json.dumps([{"type": "text", "text": json.dumps({"id": "dep-test", "commit": {"id": "a"*40}, "status": "live"})}])}]

    def test_actual_tool_result_is_extracted(self):
        result = d.render_deploy(self.messages, self.config, self.now)
        self.assertIsNotNone(result)
        self.assertEqual(result["sha"], "a"*40)
        self.assertEqual(result["status"], "live")

    def test_text_claim_and_bash_echo_are_not_render_evidence(self):
        for tool in ["Bash", "text"]:
            messages = copy.deepcopy(self.messages)
            for message in messages: message["tool"] = tool
            self.assertIsNone(d.render_deploy(messages, self.config, self.now))

    def test_truncated_stale_wrong_service_ambiguous_calls_reject(self):
        bad = []
        messages = copy.deepcopy(self.messages); messages[1]["output_truncated"] = True; bad.append(messages)
        messages = copy.deepcopy(self.messages); messages[0]["input"]["serviceId"] = "other"; bad.append(messages)
        messages = copy.deepcopy(self.messages); messages[1]["created_at"] = (self.now-dt.timedelta(hours=2)).isoformat(); bad.append(messages)
        messages = copy.deepcopy(self.messages); messages.insert(1, copy.deepcopy(messages[0])); bad.append(messages)
        for messages in bad:
            with self.subTest(messages=messages): self.assertIsNone(d.render_deploy(messages, self.config, self.now))

    def test_failed_deploy_stays_failed(self):
        self.messages[1]["output"] = json.dumps([{"type":"text", "text":json.dumps({"id":"dep-test", "commit":{"id":"a"*40}, "status":"update_failed"})}])
        result = d.render_deploy(self.messages, self.config, self.now)
        self.assertIsNotNone(result)
        self.assertEqual(result["status"], "update_failed")

    def test_missing_scope_configuration_and_malformed_commit_reject(self):
        messages = copy.deepcopy(self.messages)
        del messages[0]["input"]["workspaceId"]
        del messages[0]["input"]["serviceId"]
        self.assertIsNone(d.render_deploy(messages, {}, self.now))
        self.messages[1]["output"] = json.dumps([{"type": "text", "text": json.dumps({"id": "dep-test", "commit": {"id": "unknown"}, "status": "live"})}])
        self.assertIsNone(d.render_deploy(self.messages, self.config, self.now))

    def test_health_requires_actual_boolean_checks_and_rejects_nonobject_json(self):
        class Response:
            status = 200
            def __init__(self, payload): self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def geturl(self): return "https://example.test/health"
            def read(self, size): return json.dumps(self.payload).encode()

        valid = {"status": "ok", "revision": "a" * 40, "checks": {"postgres": True, "redis": True, "migrations": True}}
        with patch.object(d.urllib.request, "urlopen", return_value=Response(valid)):
            self.assertIs(d.health("https://example.test/health", "a" * 40), True)
            self.assertIs(d.health("https://example.test/health", "b" * 40), False)
        for migration in (None, False, 1):
            payload = copy.deepcopy(valid)
            if migration is None: del payload["checks"]["migrations"]
            else: payload["checks"]["migrations"] = migration
            with patch.object(d.urllib.request, "urlopen", return_value=Response(payload)):
                self.assertIs(d.health("https://example.test/health", "a" * 40), False)
        for payload in ([], {"status": "ok", "revision": "a" * 40, "checks": {"postgres": 1, "redis": 1}}):
            with patch.object(d.urllib.request, "urlopen", return_value=Response(payload)):
                self.assertIs(d.health("https://example.test/health", "a" * 40), False)

    def test_native_run_binding_rejects_messages_from_other_execution(self):
        for message in self.messages: message["task_id"] = "native-run"
        self.assertIsNotNone(d.render_deploy(self.messages, self.config, self.now, run_id="native-run"))
        self.assertIsNone(d.render_deploy(self.messages, self.config, self.now, run_id="other-run"))

    def test_malformed_native_tool_input_is_unknown_without_exception(self):
        self.messages[0]["input"] = "invalid-input"
        self.assertIsNone(d.render_deploy(self.messages, self.config, self.now))


if __name__ == "__main__": unittest.main()
