#!/usr/bin/env python3
"""Read-only preflight: реальные runtime/GitHub проверки и свежие MCP receipts.

MCP выполняет вызывающий runtime; CLI проверяет его receipts tools/call, а не список
установленных инструментов. Содержимое ответов и значения env в evidence не попадают.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


def check(name, ok, reason, evidence_ref=None):
    return {"name": name, "status": "passed" if ok else "failed", "reason": reason, "evidence_ref": evidence_ref}


def runtime_checks(node, pnpm, engine, package_manager):
    expected = package_manager.removeprefix("pnpm@").split("+")[0]
    return [
        check("runtime:node", node.strip().removeprefix("v") == engine == "24.12.0", "node_engine_match_required"),
        check("runtime:pnpm", pnpm.strip() == expected and package_manager.startswith("pnpm@"), "package_manager_match_required"),
    ]


def isolated_url(value, database, approved_database_hosts=()):
    try:
        parsed = urlsplit(value)
        if database and parsed.hostname in approved_database_hosts:
            parameters = parse_qs(parsed.query, keep_blank_values=True)
            return (
                parsed.scheme in {"postgres", "postgresql"}
                and parsed.path.startswith("/") and len(parsed.path) > 1
                and not parsed.fragment
                and set(parameters) <= {"sslmode", "connect_timeout", "pool_timeout", "pgbouncer"}
                and all(value in {"require", "verify-ca", "verify-full"} for value in parameters.get("sslmode", []))
            )
        return (
            parsed.hostname in {"localhost", "127.0.0.1", "::1"}
            and not parsed.query
            and not parsed.fragment
            and parsed.scheme in ({"postgres", "postgresql"} if database else {"redis"})
            and (parsed.path == "/altera_ci" if database else parsed.path in {"", "/", "/0"})
        )
    except ValueError:
        return False


def environment_checks(environment, required, approved_database_hosts=()):
    names = sorted(set(required))
    if any(not re.fullmatch(r"[A-Z][A-Z0-9_]*", name) for name in names):
        return [check("environment", False, "invalid_required_environment_name")]
    result = [check("env:" + name, bool(environment.get(name, "").strip()), "required_name_present") for name in names]
    for name in ("DATABASE_URL", "DATABASE_URL_UNPOOLED", "REDIS_URL"):
        if environment.get(name):
            result.append(check("isolation:" + name, isolated_url(environment[name], name != "REDIS_URL", approved_database_hosts), "local_or_explicitly_approved_database_target_required"))
    return result


def known_resource(payload):
    if isinstance(payload, list):
        return bool(payload) and all(known_resource(item) for item in payload)
    if not isinstance(payload, dict) or not payload or payload.get("error") or payload.get("errors"):
        return False
    status = payload.get("status")
    if status is not None and not isinstance(status, str):
        return False
    if status in {"error", "failed", "unknown", "unauthorized"} or payload.get("success") is False:
        return False
    if isinstance(payload.get("id"), str) and payload["id"].strip():
        return True
    return any(known_resource(payload.get(key)) for key in ("workspaces", "workspace", "service", "deploy", "branch", "endpoint", "endpoints"))


def successful_response(response):
    if not isinstance(response, dict) or response.get("isError", False) is not False:
        return False
    if "structuredContent" in response:
        payload = response["structuredContent"]
    else:
        blocks = response.get("content", [])
        if not isinstance(blocks, list) or not blocks:
            return False
        texts = [block.get("text") for block in blocks if isinstance(block, dict) and block.get("type") == "text"]
        if len(texts) != 1 or not isinstance(texts[0], str):
            return False
        try:
            payload = json.loads(texts[0])
        except (ValueError, TypeError):
            return False
    return known_resource(payload)


def mcp_checks(receipts, required, runtime_id, run_id, now):
    result = []
    for tool in sorted(set(required)):
        valid = False
        ref = None
        for receipt in receipts:
            if not isinstance(receipt, dict) or receipt.get("tool") != tool:
                continue
            try:
                observed = datetime.fromisoformat(receipt.get("observed_at", "").replace("Z", "+00:00"))
                age = (now - observed).total_seconds()
            except (ValueError, TypeError, AttributeError):
                continue
            valid = (
                receipt.get("runtime_id") == runtime_id
                and receipt.get("run_id") == run_id
                and receipt.get("method") == "tools/call"
                and 0 <= age <= 300
                and successful_response(receipt.get("response"))
            )
            if valid:
                ref = "sha256:" + hashlib.sha256(json.dumps(receipt, sort_keys=True).encode()).hexdigest()
                break
        result.append(check("mcp:" + tool, valid, "fresh_successful_runtime_tool_call_required", ref))
    return result


def command(argv, root):
    """Вывод используется только внутренне; ошибки и credentials не сериализуются."""
    try:
        result = subprocess.run(argv, cwd=root, capture_output=True, text=True, timeout=20, check=False)
        return result.returncode == 0, result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired, UnicodeError):
        return False, ""


def repository_checks(root, repo):
    result = []
    ok, raw = command(["gh", "api", "repos/" + repo], root)
    try:
        readable = ok and json.loads(raw).get("full_name", "").lower() == repo.lower()
    except (ValueError, AttributeError):
        readable = False
    result.append(check("github:repository", readable, "authenticated_repository_read_required"))
    ok, remote = command(["git", "remote", "get-url", "origin"], root)
    expected = {"https://github.com/" + repo, "git@github.com:" + repo, "ssh://git@github.com/" + repo}
    result.append(check("git:origin", ok and remote.removesuffix(".git") in expected, "origin_must_match_repository"))
    ok, branch = command(["git", "branch", "--show-current"], root)
    result.append(check("git:worktree", ok and bool(branch) and branch != "app" and (root / ".git").is_file(), "isolated_non_app_worktree_required"))
    ok, dirty = command(["git", "status", "--porcelain"], root)
    result.append(check("git:clean_start", ok and not dirty, "clean_initial_worktree_required"))
    ok, raw = command(["git", "ls-remote", "--exit-code", "origin", "refs/heads/app"], root)
    sha = raw.split()[0] if raw else ""
    fresh = ok and bool(re.fullmatch(r"[0-9a-f]{40}", sha))
    ancestor = False
    if fresh:
        ancestor, _ = command(["git", "merge-base", "--is-ancestor", sha, "HEAD"], root)
    result.append(check("git:fresh_app_baseline", fresh and ancestor, "live_app_must_be_ancestor_of_head", "git:" + sha if fresh else None))
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--repo", default="Egoka/Altera")
    parser.add_argument("--runtime-id", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--require-env", action="append", default=[])
    parser.add_argument("--server", action="store_true", help="Require server runtime LOG_HASH_SECRET")
    parser.add_argument("--approved-db-host", action="append", default=[], help="Exact development branch host from approved task configuration")
    parser.add_argument("--require-mcp", action="append", default=[])
    parser.add_argument("--mcp-receipts", type=Path)
    args = parser.parse_args(argv)
    now = datetime.now(timezone.utc)
    checks = []
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repo):
        checks.append(check("github:repository", False, "invalid_repository_name"))
    else:
        checks.extend(repository_checks(args.root.resolve(), args.repo))
    try:
        package = json.loads((args.root / "package.json").read_text())
        node_ok, node = command(["node", "--version"], args.root)
        pnpm_ok, pnpm = command(["pnpm", "--version"], args.root)
        checks.extend(runtime_checks(node if node_ok else "", pnpm if pnpm_ok else "", package["engines"]["node"], package["packageManager"]))
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        checks.append(check("runtime", False, "runtime_or_package_contract_unavailable"))
    required_env = args.require_env + (["LOG_HASH_SECRET"] if args.server else [])
    checks.extend(environment_checks(os.environ, required_env, args.approved_db_host))
    receipts = []
    if args.mcp_receipts:
        try:
            receipts = json.loads(args.mcp_receipts.read_text())
            if not isinstance(receipts, list):
                raise ValueError()
        except (OSError, ValueError, TypeError):
            checks.append(check("mcp:receipts", False, "invalid_receipts_document"))
            receipts = []
    checks.extend(mcp_checks(receipts, args.require_mcp, args.runtime_id, args.run_id, now))
    ok = all(item["status"] == "passed" for item in checks)
    print(json.dumps({"schema_version": 1, "ok": ok, "runtime_id": args.runtime_id, "run_id": args.run_id, "checked_at": now.isoformat(), "checks": checks}, sort_keys=True))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
