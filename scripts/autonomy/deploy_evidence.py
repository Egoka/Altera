"""Проверка записанных Multica Render tool results, без доверия пересказу модели."""
import datetime as dt
import json
import re
import urllib.request


TOOLS = {"mcp__plugin_render_render__get_deploy", "mcp__render__get_deploy"}


def render_deploy(messages, config, now, run_id=None):
    if not config.get("render_service_id") or not config.get("render_workspace_id"):
        return None
    pending = {}
    accepted = None
    messages = [message for message in messages if isinstance(message, dict) and type(message.get("seq")) is int]
    for message in sorted(messages, key=lambda x: x["seq"]):
        if run_id is not None and message.get("task_id") != run_id:
            continue
        tool = message.get("tool")
        if tool not in TOOLS:
            continue
        if message.get("type") == "tool_use":
            pending.setdefault(tool, []).append(message)
            continue
        if message.get("type") != "tool_result":
            continue
        calls = pending.pop(tool, [])
        # Без call_id параллельные одинаковые инструменты нельзя однозначно связать.
        if len(calls) != 1 or message.get("output_truncated") is not False:
            continue
        args = calls[0].get("input", {})
        if not isinstance(args, dict) or args.get("serviceId") != config.get("render_service_id") or args.get("workspaceId") != config.get("render_workspace_id"):
            continue
        try:
            stamp = dt.datetime.fromisoformat(message["created_at"].replace("Z", "+00:00"))
            if not 0 <= (now-stamp).total_seconds() <= 900:
                continue
            blocks = json.loads(message["output"])
            if not isinstance(blocks, list) or len(blocks) != 1 or blocks[0].get("type") != "text":
                continue
            value = json.loads(blocks[0]["text"])
            sha = value.get("commit", {}).get("id")
            if value.get("id") != args.get("deployId") or not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
                continue
            accepted = {"sha": value["commit"]["id"], "status": value.get("status"), "deploy_id": value["id"], "observed_at": stamp.isoformat(), "seq": message["seq"]}
        except (ValueError, KeyError, TypeError, AttributeError):
            continue
    return accepted


def health(url, expected_sha):
    """Реальная HTTP-проверка с конечным timeout; никаких URL из receipt."""
    if not isinstance(url, str) or not url.startswith("https://") or not isinstance(expected_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", expected_sha):
        return False
    try:
        with urllib.request.urlopen(url, timeout=15) as response:
            if response.status != 200 or response.geturl() != url:
                return False
            value = json.loads(response.read(65536))
            if not isinstance(value, dict) or not isinstance(value.get("checks"), dict):
                return False
            checks = value["checks"]
            return value.get("status") == "ok" and value.get("revision") == expected_sha and set(checks) == {"postgres", "redis"} and checks["postgres"] is True and checks["redis"] is True
    except (OSError, ValueError, TypeError):
        return False
