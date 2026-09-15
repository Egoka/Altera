"""Проверки fail-closed preflight без обращения к внешним сервисам."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import preflight


class PreflightTests(unittest.TestCase):
    def test_runtime_mismatch_is_not_ready(self):
        checks = preflight.runtime_checks("v24.3.0", "10.18.3", "24.12.0", "pnpm@10.18.3")
        self.assertEqual(checks[0]["status"], "failed")
        self.assertEqual(checks[1]["status"], "passed")

    def test_pnpm_mismatch_is_not_ready(self):
        checks = preflight.runtime_checks("v24.12.0", "9.0.0", "24.12.0", "pnpm@10.18.3")
        self.assertEqual(checks[1]["status"], "failed")

    def test_new_required_env_missing_and_secret_never_echoed(self):
        checks = preflight.environment_checks({"LOG_HASH_SECRET": "credential-do-not-echo"}, ["MAIL_API_KEY"])
        self.assertTrue(any(c["name"] == "env:MAIL_API_KEY" and c["status"] == "failed" for c in checks))
        self.assertNotIn("credential-do-not-echo", json.dumps(checks))

    def test_document_task_does_not_require_server_secrets(self):
        self.assertEqual(preflight.environment_checks({}, []), [])
        checks = preflight.environment_checks({}, ["LOG_HASH_SECRET"])
        self.assertEqual(checks[0]["status"], "failed")

    def test_explicit_approved_database_host_allows_development_branch_only(self):
        env = {"DATABASE_URL": "postgresql://u:private-value@dev-branch.neon.tech/neondb?sslmode=require"}
        checks = preflight.environment_checks(env, [], ["dev-branch.neon.tech"])
        self.assertEqual(checks[0]["status"], "passed")
        self.assertNotIn("private-value", json.dumps(checks))
        self.assertEqual(preflight.environment_checks(env, [], ["other-branch.neon.tech"])[0]["status"], "failed")
        env["DATABASE_URL"] += "&host=production.example.com"
        self.assertEqual(preflight.environment_checks(env, [], ["dev-branch.neon.tech"])[0]["status"], "failed")

    def test_unsafe_database_host_and_override_are_rejected(self):
        for url in (
            "postgresql://u:secret@production.example.com/altera_ci",
            "postgresql://u:secret@127.0.0.1/altera_ci?host=production.example.com",
            "postgresql://u:secret@127.0.0.1/production",
        ):
            with self.subTest(url=url):
                checks = preflight.environment_checks({"DATABASE_URL": url, "LOG_HASH_SECRET": "s"}, [])
                self.assertEqual(next(c for c in checks if c["name"] == "isolation:DATABASE_URL")["status"], "failed")
                self.assertNotIn("secret", json.dumps(checks))

    def test_unknown_inventory_or_missing_result_cannot_prove_mcp(self):
        for response in ({}, {"tools": ["get_service"]}, {"structuredContent": [{"unknown": "result"}]}, {"structuredContent": {"id": None}}, {"structuredContent": {"id": "srv-example", "status": []}}, {"isError": True, "content": [{"type": "text", "text": "error"}]}):
            receipt = self.receipt(response)
            check = self.check_mcp(receipt)
            self.assertEqual(check["status"], "failed")

    def test_actual_success_receipt_is_scoped_and_fresh(self):
        receipt = self.receipt({"isError": False, "content": [{"type": "text", "text": '{"id":"srv-example"}'}]})
        self.assertEqual(self.check_mcp(receipt)["status"], "passed")
        for key, value in (("runtime_id", "other"), ("run_id", "old"), ("observed_at", "2000-01-01T00:00:00+00:00"), ("method", "tools/list")):
            with self.subTest(key=key):
                wrong = dict(receipt, **{key: value})
                self.assertEqual(self.check_mcp(wrong)["status"], "failed")

    def test_explicit_error_inside_text_response_is_rejected(self):
        receipt = self.receipt({"content": [{"type": "text", "text": '{"error":"unauthorized"}'}]})
        self.assertEqual(self.check_mcp(receipt)["status"], "failed")

    def test_missing_mcp_probe_is_failed_not_unknown_success(self):
        checks = preflight.mcp_checks([], ["render.get_service"], "actor-1", "run-1", self.now())
        self.assertEqual(checks[0]["status"], "failed")

    def test_malformed_receipt_timestamp_is_failed_without_crashing(self):
        receipt = self.receipt({"structuredContent": {"id": "srv-example"}})
        receipt["observed_at"] = 7
        self.assertEqual(self.check_mcp(receipt)["status"], "failed")

    def test_cli_checks_executed_runtime_and_never_prints_command_errors(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "package.json").write_text(json.dumps({"engines": {"node": "24.12.0"}, "packageManager": "pnpm@10.18.3"}))
            for name, version in (("node", "v24.3.0"), ("pnpm", "10.18.3")):
                executable = root / name
                executable.write_text('#!/bin/sh\nprintf "%s\\n" "' + version + '"\nprintf "%s\\n" "private-error-token" >&2\n')
                executable.chmod(0o755)
            env = {"PATH": str(root), "LOG_HASH_SECRET": "private-env-token"}
            result = subprocess.run([sys.executable, str(Path(preflight.__file__)), "--root", str(root), "--runtime-id", "test", "--run-id", "test"], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            statuses = {item["name"]: item["status"] for item in payload["checks"]}
            self.assertEqual(statuses["runtime:node"], "failed")
            self.assertEqual(statuses["runtime:pnpm"], "passed")
            self.assertNotIn("private-error-token", result.stdout + result.stderr)
            self.assertNotIn("private-env-token", result.stdout + result.stderr)

    def test_remote_app_advance_invalidates_worktree_baseline(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            origin, source, worktree = (root / name for name in ("origin.git", "source", "worktree"))

            def git(*args, cwd=root):
                subprocess.run(["git", *args], cwd=cwd, capture_output=True, check=True)

            git("init", "--bare", str(origin))
            git("init", "-b", "app", str(source))
            git("config", "user.email", "test@example.invalid", cwd=source)
            git("config", "user.name", "Test", cwd=source)
            git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "initial", cwd=source)
            git("remote", "add", "origin", str(origin), cwd=source)
            git("push", "origin", "app", cwd=source)
            git("worktree", "add", "-b", "codex/test", str(worktree), cwd=source)
            run_command = preflight.command

            def local_command(argv, cwd):
                if argv[0] == "gh":
                    return True, '{"full_name":"Egoka/Altera"}'
                return run_command(argv, cwd)

            with patch.object(preflight, "command", side_effect=local_command):
                checks = preflight.repository_checks(worktree, "Egoka/Altera")
                self.assertEqual(next(c for c in checks if c["name"] == "git:fresh_app_baseline")["status"], "passed")
                self.assertEqual(next(c for c in checks if c["name"] == "git:worktree")["status"], "passed")
                git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "advance", cwd=source)
                git("push", "origin", "app", cwd=source)
                checks = preflight.repository_checks(worktree, "Egoka/Altera")
                self.assertEqual(next(c for c in checks if c["name"] == "git:fresh_app_baseline")["status"], "failed")

    @staticmethod
    def now():
        return datetime(2026, 9, 15, 12, tzinfo=timezone.utc)

    def receipt(self, response):
        return {"runtime_id": "actor-1", "run_id": "run-1", "tool": "render.get_service", "method": "tools/call", "observed_at": self.now().isoformat(), "response": response}

    def check_mcp(self, receipt):
        return preflight.mcp_checks([receipt], ["render.get_service"], "actor-1", "run-1", self.now())[0]


if __name__ == "__main__":
    unittest.main()
