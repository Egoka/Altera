"""Суточный сбор до Claude: bounded handoff, сохранённые входы и Ledger no-op."""

import datetime as dt
import json
import os
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

from controller import Ledger, fingerprint, lock
from daily_publish import run as publish_report
from resource_probe import measure_resources
import reporting
from runtime_bridge import emit, native_model


def closed_date(now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None:
        raise ValueError("daily runtime clock requires timezone")
    local = now.astimezone(ZoneInfo("Europe/Moscow"))
    return (local.date() if local.hour >= 10 else (local - dt.timedelta(days=1)).date()).isoformat()


def collect_snapshot(config):
    snapshot = reporting.collect_live(
        config["multica"], config["server_url"], config["workspace_id"], config["project_id"],
        config["github_repo"], maintenance_autopilot_ids=config.get("maintenance_autopilot_ids", [])
    )
    receipts = Path(config.get("receipts_dir", Path(config["state_dir"]) / "verified"))
    reporting.attach_controller_receipts(snapshot, receipts)
    roots = [Path(config["repo"]) / ".worktrees"]
    if config.get("runtime_workspace_root"):
        roots.append(Path(config["runtime_workspace_root"]))
    snapshot["disk"] = measure_resources(roots, max_entries=1_000_000, timeout_seconds=30)
    return snapshot


def source_status(value):
    return value.get("status", "unknown") if isinstance(value, dict) else value


def prepared_handoff(config, date, report, snapshot_path, prepared_root, publication):
    coverage = report["source_coverage"]
    partial = sorted(name for name, value in coverage.items() if source_status(value) != "complete")
    tasks = report["tasks"]
    summary = {
        "attempts": report["executions"]["count"], "autopilot_attempts": report["executions"]["autopilot"],
        "verified_product": tasks["useful_accepted"], "verified_maintenance": tasks["maintenance_accepted"],
        "verified_self_rework": tasks["self_rework_accepted"],
        "legacy_done_without_new_receipt": tasks["done_without_verified_receipt"],
        "tokens": report["tokens"], "source_count": len(coverage), "partial_source_count": len(partial),
        "partial_sources": [name[:120] for name in partial[:5]],
        "test_coverage_known": report["quality"]["tests"]["coverage"] is not None,
    }
    payload = {
        "date": date, "window": report["window"], "summary": summary,
        "snapshot_path": str(snapshot_path),
        "report_json": str(prepared_root / "docs/reports/autonomy" / f"{date}.json"),
        "report_markdown": str(prepared_root / "docs/reports/autonomy" / f"{date}.md"),
        "publication": {"status": publication["status"], "branch": publication.get("branch"),
                        "pr": {key: publication["pr"].get(key) for key in ("number", "url")}},
    }
    instruction = (
        "Суточные источники и агрегаты уже собраны, а отчётный PR подтверждён программно до запуска модели. "
        "Выполняй только короткий read-only анализ готового отчёта; ничего не публикуй и не собирай заново. "
        "Идемпотентный publisher уже создал или обновил один PR в app и сохранил историю исправлений. "
        "В native run верни ссылку на PR, до трёх фактов и до пяти пробелов; модельный текст не входит в PR. "
        "Детали при необходимости читай только из report_json/report_markdown. "
        "Не меняй продукт, очередь, права, MCP, инфраструктуру и другие autopilot. "
        "При ошибке остановись с кратким blocker без секретов и raw logs.\n\nALTERA_DAILY_PREPARED_V1\n"
    )
    message = instruction + json.dumps(payload, ensure_ascii=False, sort_keys=True)
    if len(message) > 8192:
        raise ValueError("daily handoff exceeds bounded native input")
    return message


def run(config, args, agent_id, *, collect=collect_snapshot, model=native_model, publish=publish_report, now=None):
    if not agent_id or agent_id not in config.get("daily_agent_ids", []):
        return {"status": "failed", "model_called": False, "kind": "daily", "reason": "unexpected_agent", "exit_code": 2}
    root = Path(config["state_dir"])
    event_key = None
    ledger = None
    model_started = False
    try:
        with lock(root / "daily-runtime.lock"):
            date = closed_date(now)
            snapshot = collect(config)
            if not isinstance(snapshot, dict) or not isinstance(snapshot.get("issues"), list) or not isinstance(snapshot.get("executions"), list):
                raise ValueError("invalid daily source snapshot")
            report = reporting.build_report(snapshot, date)
            digest = reporting.content_digest(report)
            snapshot_path = root / "daily" / "snapshots" / date / f"{digest}.json"
            if not snapshot_path.exists():
                reporting.atomic_write(snapshot_path, reporting.encoded(reporting.sanitize(snapshot)))
                snapshot_path.chmod(0o600)
            # Каждый запуск сохраняет доступный срез; incompleteness не маскируется модельным анализом.
            prepared_root = root / "daily" / "prepared"
            reporting.publish(snapshot, date, prepared_root)
            critical = [name for name in ("issues", "executions")
                        if source_status(snapshot.get("coverage", {}).get(name)) != "complete"]
            if critical:
                return {"status": "failed", "model_called": False, "kind": "daily", "date": date,
                        "reason": "incomplete_critical_sources", "sources": critical,
                        "snapshot_path": str(snapshot_path), "exit_code": 2}
            event_key = fingerprint({"kind": "daily", "date": date, "semantic_report": digest,
                                     "instructions": config.get("daily_instructions_version", "daily-v1")})
            ledger = Ledger(root / "daily-ledger.sqlite3")
            if not ledger.claim(event_key):
                done = ledger.completed_at(event_key) is not None
                return {"status": "no_action" if done else "failed", "model_called": False,
                        "kind": "daily", "date": date, "event_key": event_key,
                        "reason": "unchanged_day" if done else "reconciliation_required",
                        "snapshot_path": str(snapshot_path), "exit_code": 0 if done else 2}
            # Публикация не зависит от обещания модели выполнить CLI или от её exit code.
            pinned_snapshot = json.loads(snapshot_path.read_text())
            publication = publish(config, date, pinned_snapshot)
            if publication.get("status") not in ("published", "unchanged") or not (publication.get("pr") or {}).get("url"):
                raise ValueError("daily publisher did not confirm report PR")
            reporting.atomic_write(root / "daily" / "publications" / date / f"{digest}.json", reporting.encoded(publication))
            if publication["status"] == "unchanged":
                ledger.finish(event_key, True)
                return {"status": "no_action", "model_called": False, "kind": "daily", "date": date,
                        "event_key": event_key, "reason": "already_published", "pr": publication["pr"], "exit_code": 0}
            message = prepared_handoff(config, date, report, snapshot_path, prepared_root, publication)
            model_started = True
            result = model(config, args, message)
            ledger.finish(event_key, result == 0)
            return {"status": "completed" if result == 0 else "failed", "model_called": True,
                    "kind": "daily", "date": date, "event_key": event_key,
                    "snapshot_path": str(snapshot_path), "exit_code": result}
    except Exception as error:
        if ledger is not None and event_key is not None:
            ledger.finish(event_key, False)
        return {"status": "failed", "model_called": model_started, "kind": "daily",
                "error_type": type(error).__name__, "exit_code": 2}
    finally:
        if ledger is not None:
            ledger.db.close()


def main():
    if sys.argv[1:] == ["--version"]:
        print("altera-daily-runtime 1.0.0")
        return 0
    config_path = os.environ.get("ALTERA_AUTONOMY_CONFIG")
    if not config_path:
        raise ValueError("missing daily runtime config")
    config = json.loads(Path(config_path).read_text())
    config["_config_path"] = config_path
    initial = json.loads(sys.stdin.readline())
    if initial.get("type") != "user" or not isinstance(initial.get("message"), dict):
        raise ValueError("expected native user stream-json frame")
    # Сырой prompt/history не передаётся модели; native_model продолжает relay control frames.
    result = run(config, sys.argv[1:], os.environ.get("MULTICA_AGENT_ID"))
    if not result["model_called"]:
        emit(result)
    return result.get("exit_code", 0)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        emit({"status": "failed", "model_called": False, "kind": "daily", "error_type": type(error).__name__})
        sys.exit(2)
