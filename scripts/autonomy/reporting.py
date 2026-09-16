"""Детерминированные суточные отчёты; stdlib, чтение источников без мутаций."""

import argparse
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import statistics
import subprocess
import tempfile
import time as clock
from zoneinfo import ZoneInfo


TOKEN_FIELDS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens")
MOSCOW = ZoneInfo("Europe/Moscow")


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except ValueError:
        return None


def iso(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def day_window(report_date):
    end = datetime.combine(date.fromisoformat(report_date), time(10), MOSCOW)
    return end - timedelta(days=1), end


def in_window(value, start, end):
    parsed = timestamp(value)
    return parsed is not None and start <= parsed < end


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def summarize(values):
    values = sorted(value for value in values if numeric(value))
    return {"samples": values, "count": len(values),
            "median": statistics.median(values) if values else None,
            "p90": values[math.ceil(len(values) * .9) - 1] if values else None}


def duration(start, end):
    left, right = timestamp(start), timestamp(end)
    return (right - left).total_seconds() if left and right and right >= left else None


def unique_executions(snapshot):
    """Повторный снимок запуска заменяет телеметрию, а не суммируется с ней."""
    found = {}
    missing = 0
    for row in snapshot.get("executions", []) + snapshot.get("agent_tasks", []):
        identifier = row.get("id")
        if not identifier:
            missing += 1
            continue
        previous = found.get(identifier)
        if previous is None:
            found[identifier] = dict(row)
            continue
        old_time = timestamp(previous.get("observed_at") or previous.get("updated_at"))
        new_time = timestamp(row.get("observed_at") or row.get("updated_at"))
        if new_time and (not old_time or new_time > old_time):
            found[identifier] = {**previous, **row}
        elif previous.get("usage") is None and row.get("usage") is not None:
            found[identifier] = {**previous, **row}
        if row.get("autopilot_id"):
            found[identifier]["autopilot_id"] = row["autopilot_id"]
            found[identifier]["kind"] = "autopilot"
    return [found[key] for key in sorted(found)], missing


def token_summary(runs):
    result = {}
    for field in TOKEN_FIELDS:
        observed, known = 0, 0
        for run in runs:
            usage = run.get("usage")
            if isinstance(usage, dict):
                usage = [usage]
            if not isinstance(usage, list) or not usage:
                continue
            values = [item.get(field) for item in usage if isinstance(item, dict)]
            measured = [value for value in values if numeric(value)]
            observed += sum(measured)
            if len(measured) == len(usage):
                known += 1
        any_measurement = any(
            numeric(item.get(field))
            for run in runs
            for item in (run.get("usage") if isinstance(run.get("usage"), list)
                         else [run.get("usage")])
            if isinstance(item, dict)
        )
        result[field] = {"observed": observed if any_measurement else None,
                         "known_runs": known, "total_runs": len(runs),
                         "complete": bool(runs) and known == len(runs)}
    return result


def receipt_time(receipt):
    finalization = receipt.get("finalization") or {}
    return receipt.get("accepted_at") or finalization.get("accepted_at") or finalization.get("completed_at")


def latest_receipts(receipts):
    result = {}
    for receipt in receipts:
        key = receipt.get("task_id")
        if not key:
            continue
        prior = result.get(key)
        observed = timestamp(receipt.get("observed_at") or receipt_time(receipt))
        old = timestamp(prior.get("observed_at") or receipt_time(prior)) if prior else None
        if prior is None or (observed and (not old or observed > old)):
            result[key] = receipt
    return result


def build_report(snapshot, report_date):
    start, end = day_window(report_date)
    all_runs, missing_ids = unique_executions(snapshot)
    runs = [row for row in all_runs if in_window(row.get("created_at"), start, end)]
    issues_by_id = {row["id"]: row for row in snapshot.get("issues", []) if row.get("id")}
    issues = list(issues_by_id.values())
    new_issues = [row for row in issues if in_window(row.get("created_at"), start, end)]
    receipts = latest_receipts(snapshot.get("receipts", []))
    verified = {key: row for key, row in receipts.items() if row.get("verified") is True}
    verified_issue_ids = set(verified)
    for row in verified.values():
        if row.get("issue_id"):
            verified_issue_ids.add(row["issue_id"])
        source = row.get("source")
        if isinstance(source, dict) and source.get("issue_id"):
            verified_issue_ids.add(source["issue_id"])
    for row in issues:
        task_id = (row.get("metadata") or {}).get("task_id")
        if task_id in verified:
            verified_issue_ids.add(row["id"])
            issues_by_id[task_id] = row
    accepted = [row for row in verified.values() if in_window(receipt_time(row), start, end)]
    claimed_done = [row for row in issues if row.get("status_category", row.get("status")) in
                    ("completed", "done", "closed")]
    groups = defaultdict(list)
    for row in runs:
        role = row.get("role") or (row.get("attribution") or {}).get("role") or "unknown"
        usages = row.get("usage")
        usages = [usages] if isinstance(usages, dict) else usages
        if not usages:
            groups[(role, "unknown")].append({"usage": None})
        else:
            by_model = defaultdict(list)
            for item in usages:
                by_model[item.get("model") or "unknown"].append(item)
            for model, items in by_model.items():
                groups[(role, model)].append({"usage": items})
    timing_samples = {
        "queue_seconds": [duration(row.get("created_at"), row.get("started_at")) for row in runs],
        "execution_seconds": [duration(row.get("started_at"), row.get("completed_at")) for row in runs],
        "lead_seconds": [duration(issues_by_id.get(row.get("task_id"), {}).get("created_at"),
                                  receipt_time(row)) for row in accepted],
    }
    tests = [row.get("tests") for row in accepted if isinstance(row.get("tests"), dict)]
    tests_summary = {}
    for field in ("passed", "failed", "skipped", "todo"):
        values = [row[field] for row in tests if numeric(row.get(field))]
        tests_summary[field] = {"observed": sum(values) if values else None,
                                "known_receipts": len(values), "total_receipts": len(accepted)}
    tests_summary["coverage"] = [row["coverage"] for row in tests if row.get("coverage") is not None] or None
    independent = []
    for row in accepted:
        review = row.get("review") or {}
        explicit = review.get("independent") is True and review.get("verified") is True
        bound_review = (bool(review.get("actor_id")) and bool(row.get("implementer_id"))
                        and review["actor_id"] != row["implementer_id"]
                        and review.get("verdict") == "approved" and bool(row.get("tested_sha"))
                        and review.get("sha", review.get("tested_sha")) == row["tested_sha"])
        if explicit or bound_review:
            independent.append(row)
    regressions = [row for row in accepted if numeric(row.get("regressions"))]
    receipt_evidence = [{"task_id": row.get("task_id"), "verified": row.get("verified") is True,
                         "accepted_at": receipt_time(row), "work_class": row.get("work_class", "unknown"),
                         **{field: row.get(field) for field in
                            ("source", "baseline_sha", "tested_sha", "acceptance", "pr", "ci", "review",
                             "deployment", "finalization", "tests")}}
                        for row in sorted(receipts.values(), key=lambda item: item["task_id"])]
    represented_issues = set()
    for evidence in receipt_evidence:
        receipt = receipts[evidence["task_id"]]
        source = receipt.get("source")
        issue_id = receipt.get("issue_id") or (source.get("issue_id") if isinstance(source, dict) else None)
        issue = issues_by_id.get(issue_id or evidence["task_id"], {})
        if issue:
            represented_issues.add(issue["id"])
        evidence["title"] = issue.get("title")
        evidence["issue_id"] = issue.get("id") or issue_id
        evidence["identifier"] = issue.get("identifier")
        evidence["status"] = issue.get("status_name") or issue.get("status_category") or issue.get("status")
        criteria = receipt.get("criteria")
        if evidence["acceptance"] is None and isinstance(criteria, list):
            evidence["acceptance"] = {"total": len(criteria), "passed": sum(
                item.get("passed") is True or item.get("status") == "passed"
                for item in criteria if isinstance(item, dict))}
    cohort_issue_ids = {row["id"] for row in new_issues} | {row.get("issue_id") for row in runs}
    for identifier in sorted(value for value in cohort_issue_ids if value and value not in represented_issues):
        issue = issues_by_id.get(identifier, {})
        receipt_evidence.append({"task_id": (issue.get("metadata") or {}).get("task_id") or identifier,
                                 "issue_id": identifier, "identifier": issue.get("identifier"),
                                 "title": issue.get("title"), "verified": False,
                                 "status": issue.get("status_name") or issue.get("status_category") or issue.get("status"),
                                 "acceptance": None, "tested_sha": None, "pr": None,
                                 "work_class": "unknown", "legacy_assessment": "not_assessed_by_controller"})
    report = {
        "schema_version": 1, "date": report_date,
        "window": {"start": iso(start), "end": iso(end), "timezone": "Europe/Moscow", "half_open": True},
        "collected_at": snapshot.get("collected_at"),
        "period_task_ids": sorted({(issues_by_id.get(identifier, {}).get("metadata") or {}).get("task_id") or identifier
                                   for identifier in cohort_issue_ids if identifier} |
                                  {row["task_id"] for row in accepted}),
        "source_coverage": snapshot.get("coverage", {}),
        "executions": {"count": len(runs), "ids": [row["id"] for row in runs],
                       "autopilot": sum(row.get("kind") == "autopilot" or bool(row.get("autopilot_id")) for row in runs),
                       "late_completed": sum(bool(timestamp(row.get("completed_at")) and timestamp(row["completed_at"]) >= end)
                                             for row in runs),
                       "unknown_created_at": sum(timestamp(row.get("created_at")) is None for row in all_runs),
                       "missing_ids": missing_ids,
                       "retries": sum(numeric(row.get("attempt")) and row["attempt"] > 1 for row in runs),
                       "noops": sum(row.get("no_action") is True for row in runs),
                       "noop_known_runs": sum(isinstance(row.get("no_action"), bool) for row in runs),
                       "statuses": dict(sorted(Counter(row.get("status") or "unknown" for row in runs).items()))},
        "tokens": token_summary(runs),
        "tokens_by_role_model": [{"role": role, "model": model, "tokens": token_summary(group)}
                                  for (role, model), group in sorted(groups.items())],
        "tasks": {"inventory": len(issues), "created": len(new_issues),
                  "created_parents": sum(not row.get("parent_issue_id") for row in new_issues),
                  "created_stages": sum(bool(row.get("parent_issue_id")) for row in new_issues),
                  "claimed_done_inventory": len(claimed_done), "verified_accepted": len(accepted),
                  "useful_accepted": sum(row.get("work_class") == "product" for row in accepted),
                  "maintenance_accepted": sum(row.get("work_class") == "maintenance" for row in accepted),
                  "self_rework_accepted": sum(row.get("work_class") == "self_rework" for row in accepted),
                  "unclassified_accepted": sum(row.get("work_class") not in ("product", "maintenance", "self_rework")
                                               for row in accepted),
                  "done_without_verified_receipt": sum(row["id"] not in verified_issue_ids for row in claimed_done)},
        "timings": {key: summarize(values) for key, values in timing_samples.items()},
        "quality": {"independent_review_verified": len(independent),
                    "accepted_receipts": len(accepted),
                    "regressions_observed": sum(row["regressions"] for row in regressions) if regressions else None,
                    "regressions_known_receipts": len(regressions), "tests": tests_summary},
        "delivery": snapshot.get("delivery") or {"deployment": None, "sql": None, "redis": None},
        "disk": snapshot.get("disk") or {"measured_at": None, "logical_bytes": None, "reclaimed_bytes": None},
        "task_evidence": receipt_evidence,
        "issue_metadata": [safe_issue(row) for row in issues],
        "pull_requests": sanitize(snapshot.get("pull_requests", [])),
        "ci_runs": sanitize(snapshot.get("ci_runs", [])),
        "caveats": ["Запуски отнесены по created_at; usage — наблюдённая телеметрия всей попытки, не почасовой billing.",
                    "Принятие отнесено по accepted_at; инвентарь Done — состояние среза, не суточный throughput.",
                    "null означает отсутствие измерения; частичные суммы — нижняя наблюдаемая граница.",
                    "CI и receipt не заменяют независимый review; неизвестное покрытие не означает 0%.",
                    "Повторный сбор может уточнить поздний usage и ранее опубликованные сутки."],
    }
    return sanitize(report)


def aggregate_period(reports, report_date, days):
    last = date.fromisoformat(report_date)
    dates = [(last - timedelta(days=offset)).isoformat() for offset in reversed(range(days))]
    index = {report["date"]: report for report in reports}
    selected = [index[day] for day in dates if day in index]
    return {
        "days": days, "covered_days": len(selected),
        "missing_dates": [day for day in dates if day not in index],
        "tasks": {field: sum(report["tasks"][field] for report in selected) for field in
                  ("created", "verified_accepted", "useful_accepted", "maintenance_accepted", "self_rework_accepted")},
        "executions": sum(report["executions"]["count"] for report in selected),
        "tokens": {field: {
            "observed": sum(report["tokens"][field]["observed"] or 0 for report in selected)
            if any(report["tokens"][field]["observed"] is not None for report in selected) else None,
            "known_runs": sum(report["tokens"][field]["known_runs"] for report in selected),
            "total_runs": sum(report["tokens"][field]["total_runs"] for report in selected),
            "complete": len(selected) == days and all(report["tokens"][field]["complete"] for report in selected),
        } for field in TOKEN_FIELDS},
        "timings": {key: summarize([value for report in selected for value in report["timings"][key]["samples"]])
                    for key in ("queue_seconds", "execution_seconds", "lead_seconds")},
    }


def display(value):
    return "неизвестно" if value is None else str(value)


def markdown_cell(value):
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return display(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ")


def receipt_availability(report):
    source = report.get("source_coverage", {}).get("receipts")
    return (source.get("status") if isinstance(source, dict) else source) == "complete"


def review_ratio(report):
    quality = report["quality"]
    if not quality["accepted_receipts"]:
        return "n/a (нет доступной выборки принятых receipt)"
    return f"{quality['independent_review_verified']} / {quality['accepted_receipts']} доступных принятых receipt"


def evidence_task_link(row, report):
    source = row.get("source") or {}
    identifier = row.get("issue_id") or (source.get("issue_id") if isinstance(source, dict) else None)
    issue = next((item for item in report.get("issue_metadata", [])
                  if item.get("id") == (identifier or row.get("task_id"))
                  or (item.get("metadata") or {}).get("task_id") == row.get("task_id")), {})
    identifier = identifier or issue.get("id")
    parsed = re.search(r"\bT-\d+\b", row.get("title") or "")
    label = markdown_cell(row.get("identifier") or issue.get("identifier") or
                          (parsed.group() if parsed else None) or row.get("task_id"))
    label = label.replace("[", "\\[").replace("]", "\\]")
    if identifier and re.fullmatch(r"[A-Za-z0-9-]+", identifier):
        return f"[{label}](https://multica.ai/altera/issues/{identifier})"
    return label


def render_report(report):
    tasks, executions = report["tasks"], report["executions"]
    lines = [f"# Суточный аудит — {report['date']}", "",
             f"Окно: [{report['window']['start']}, {report['window']['end']}) — 10:00→10:00 Europe/Moscow.", "",
             f"Срез: {display(report['collected_at'])}. Ревизия: {report.get('revision', 1)}.", "",
             f"- Подтверждено доступными receipt: {tasks['verified_accepted']} задач; legacy-результаты без receipt ещё не оценены.",
             f"- Наблюдено {executions['count']} уникальных попыток, включая {executions['autopilot']} autopilot.",
             f"- Done без нового verified receipt в инвентаре: {tasks['done_without_verified_receipt']}; это пробел подтверждения, а не доказанный дефект результата.", "",
             "## Результат по доступным receipt", "",
             "Фактическое принятие неизвестно: источник receipt недоступен или неполон." if not receipt_availability(report)
             else "Числа описывают только результаты, подтверждённые доступными controller receipt.", "",
             "| Метрика | Значение |", "| --- | ---: |",
             f"| Подтверждено принятых задач | {tasks['verified_accepted']} |",
             f"| Продуктовый результат, подтверждённый новым controller | {tasks['useful_accepted']} |",
             f"| Обслуживание / исправление собственной работы / не классифицировано | {tasks['maintenance_accepted']} / {tasks['self_rework_accepted']} / {tasks['unclassified_accepted']} |",
             f"| Новых задач: родители / стадии | {tasks['created_parents']} / {tasks['created_stages']} |",
             f"| Done без подтверждённого receipt во всём инвентаре | {tasks['done_without_verified_receipt']} |",
             "", "## Работа и затраты", "",
             f"Уникальных попыток: {executions['count']}; autopilot: {executions['autopilot']}; подтверждённых повторов: {executions['retries']}; полнота классификации неизвестна.", "",
             f"No-op: {executions['noops']} при известном исходе у {executions['noop_known_runs']} попыток. Завершились после окна: {executions['late_completed']}.", "",
             "| Телеметрия | Наблюдённая сумма | Полные записи попыток |", "| --- | ---: | ---: |"]
    for field in TOKEN_FIELDS:
        metric = report["tokens"][field]
        lines.append(f"| {field} | {display(metric['observed'])} | {metric['known_runs']} / {metric['total_runs']} |")
    lines += ["", "| Роль | Модель | input | output | cache read | cache write |", "| --- | --- | ---: | ---: | ---: | ---: |"]
    for row in report["tokens_by_role_model"]:
        lines.append("| " + " | ".join([markdown_cell(row["role"]), markdown_cell(row["model"])] +
                                      [f"{display(row['tokens'][field]['observed'])} ({row['tokens'][field]['known_runs']}/{row['tokens'][field]['total_runs']})"
                                       for field in TOKEN_FIELDS]) + " |")
    lines += ["", "| Длительность, секунды | median | p90 | Измерений |", "| --- | ---: | ---: | ---: |"]
    for key in ("queue_seconds", "execution_seconds", "lead_seconds"):
        metric = report["timings"][key]
        lines.append(f"| {key} | {display(metric['median'])} | {display(metric['p90'])} | {metric['count']} |")
    quality = report["quality"]
    lines += ["", "## Качество и доставка", "",
              f"Независимый review подтверждён: {review_ratio(report)}.", "",
              f"Наблюдённые регрессии: {display(quality['regressions_observed'])}; receipt с измерением: {quality['regressions_known_receipts']}.", "",
              "| Тесты | Наблюдённое число | Receipt с измерением |", "| --- | ---: | ---: |"]
    for field in ("passed", "failed", "skipped", "todo"):
        metric = quality["tests"][field]
        lines.append(f"| {field} | {display(metric['observed'])} | {metric['known_receipts']} / {metric['total_receipts']} |")
    lines += ["", f"Покрытие тестами: {markdown_cell(quality['tests']['coverage'])}.", "",
              "Доставка и ресурсы приведены как измеренные поля; отсутствие данных явно сохранено.", "",
              "```json", json.dumps({"delivery": report["delivery"], "disk": report["disk"]}, ensure_ascii=False, indent=2, sort_keys=True), "```", "",
              "## Evidence по задачам", "",
              "| Задача | Название | Статус источника | Новый receipt | AC | PR |", "| --- | --- | --- | --- | --- | --- |"]
    for row in report["task_evidence"]:
        lines.append("| " + " | ".join([evidence_task_link(row, report)] +
                                      [markdown_cell(row.get(field)) for field in
                                       ("title", "status", "verified", "acceptance", "pr")]) + " |")
    coverage = report["source_coverage"]
    statuses = {key: value.get("status", "unknown") if isinstance(value, dict) else value for key, value in coverage.items()}
    gaps = [key for key, status in statuses.items() if status != "complete"]
    lines += ["", "## Полнота и следующие действия", "",
              f"Источников: {len(statuses)}; полных: {sum(status == 'complete' for status in statuses.values())}; с ограничениями: {len(gaps)}.", ""]
    for key in sorted(gaps)[:10]:
        value = coverage[key]
        reason = value.get("reason", value.get("status")) if isinstance(value, dict) else value
        lines.append(f"- {markdown_cell(key)}: {markdown_cell(reason)}.")
    actions = []
    if gaps:
        actions.append("Повторить чтение неполных источников и исправить затронутые сутки.")
    if tasks["done_without_verified_receipt"]:
        actions.append("Проверить legacy Done по PR/AC/evidence и импортировать подтверждение через controller.")
    if any(not metric["complete"] for metric in report["tokens"].values()):
        actions.append("Дособрать usage незавершённых или неполных native tasks; текущие суммы частичные.")
    if quality["tests"]["coverage"] is None:
        actions.append("Добавить измерение тестового покрытия к следующему проверенному результату.")
    if any(value is None for value in report["delivery"].values()):
        actions.append("Получить свежие deployment и SQL/Redis health evidence.")
    lines += ["", *[f"- {action}" for action in actions[:5]], "", "## Ограничения", ""]
    lines += [f"- {item}" for item in report["caveats"]]
    lines += ["", f"[Машинный отчёт и полные безопасные metadata]({report['date']}.json)", ""]
    return "\n".join(lines)


def render_progress(reports):
    latest = max(reports, key=lambda row: row["date"])
    lines = ["# Прогресс Altera", "", f"Последний отчёт: [{latest['date']}](docs/reports/autonomy/{latest['date']}.md).", "",
             "Данные обновляет детерминированный аудит. Таблица показывает только подтверждённое доступными receipt; legacy-результаты без receipt ещё не оценены.", "",
             "Фактическое принятие неизвестно для суток с недоступным или неполным источником receipt; наблюдённый ноль не означает отсутствие полезного результата.", "",
             "| Период | Суток с данными | Подтверждено receipt | Продукт по receipt | Обслуживание по receipt | Самоисправления по receipt | Попытки |",
             "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for days in (7, 30):
        period = aggregate_period(reports, latest["date"], days)
        tasks = period["tasks"]
        lines.append(f"| {days} суток | {period['covered_days']} / {days} | {tasks['verified_accepted']} | {tasks['useful_accepted']} | {tasks['maintenance_accepted']} | {tasks['self_rework_accepted']} | {period['executions']} |")
    lines += ["", "| Период | input | output | cache read | cache write |", "| --- | ---: | ---: | ---: | ---: |"]
    for days in (7, 30):
        period = aggregate_period(reports, latest["date"], days)
        lines.append("| " + " | ".join([f"{days} суток"] +
                                      [f"{display(period['tokens'][field]['observed'])} ({period['tokens'][field]['known_runs']}/{period['tokens'][field]['total_runs']})"
                                       for field in TOKEN_FIELDS]) + " |")
    lines += ["", "Скобки показывают попытки с полной телеметрией / известные попытки. Cache приведён отдельно; это не денежный счёт.", "",
              "| Период | Execution median / p90, сек | Lead median / p90, сек |", "| --- | ---: | ---: |"]
    for days in (7, 30):
        period = aggregate_period(reports, latest["date"], days)
        lines.append("| " + " | ".join([f"{days} суток"] +
                                      [f"{display(period['timings'][key]['median'])} / {display(period['timings'][key]['p90'])} (n={period['timings'][key]['count']})"
                                       for key in ("execution_seconds", "lead_seconds")]) + " |")
    lines += ["", f"В последнем срезе Done без verified receipt во всём инвентаре: {latest['tasks']['done_without_verified_receipt']}; независимый review: {review_ratio(latest)}.", "",
              "Пропущенные сутки не считаются нулевыми. Полнота источников, неизвестное покрытие тестами, доставка и cleanup — в суточном аудите. Периодные суммы могут включать частичные срезы.", "",
              "[Машинные агрегаты 7/30 суток](docs/reports/autonomy/periods.json)", "",
              "## Суточные отчёты", ""]
    lines += [f"- [{row['date']}](docs/reports/autonomy/{row['date']}.md) · ревизия {row.get('revision', 1)}"
              for row in sorted(reports, key=lambda item: item["date"], reverse=True)]
    return "\n".join(lines) + "\n"


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def content_digest(report):
    """Ключ закрытой когорты; текущий инвентарь не является событием этих суток."""
    start, end = day_window(report["date"])
    accepted = [row for row in report.get("task_evidence", [])
                if row.get("verified") is True and in_window(row.get("accepted_at"), start, end)]
    task_ids = report.get("period_task_ids")
    if task_ids is None:  # Совместимость с уже опубликованными отчётами schema_version=1.
        task_ids = [row["task_id"] for row in report.get("task_evidence", [])
                    if not row.get("accepted_at") or row in accepted]
    issue_ids = {row.get("issue_id") or row.get("task_id") for row in report.get("task_evidence", [])
                 if row.get("task_id") in task_ids}

    def stable(value):
        if isinstance(value, dict):
            return {key: stable(item) for key, item in value.items()
                    if key not in {"updated_at", "updatedAt", "observed_at", "collected_at"}}
        if isinstance(value, list):
            return sorted((stable(item) for item in value), key=encoded)
        return value

    def fields(row, names):
        return {key: row[key] for key in names if key in row}

    def pr_evidence(row):
        # REST head/base.repo отражает весь репозиторий сейчас, а не evidence PR.
        result = fields(row, ("id", "number", "state", "draft", "created_at", "createdAt", "closed_at",
                              "merged_at", "mergedAt", "merge_commit_sha", "headRefOid", "baseRefOid",
                              "headRefName", "baseRefName", "reviewDecision", "merged"))
        for branch in ("head", "base"):
            if isinstance(row.get(branch), dict):
                result[branch] = fields(row[branch], ("sha", "ref"))
        if isinstance(row.get("reviews"), list):
            result["reviews"] = []
            for review in row["reviews"]:
                evidence = fields(review, ("id", "state", "commit_id", "submitted_at", "submittedAt", "actor_id"))
                if isinstance(review.get("user"), dict):
                    evidence["actor_id"] = review["user"].get("id")
                result["reviews"].append(evidence)
        return result

    def ci_evidence(row):
        return fields(row, ("id", "databaseId", "workflow_id", "name", "path", "event", "status", "conclusion",
                            "head_sha", "headSha", "head_branch", "headBranch", "created_at", "createdAt",
                            "run_started_at", "startedAt", "completed_at", "completedAt", "run_attempt", "run_number"))

    receipt_prs = {str(row["pr"].get("number")) for row in accepted if isinstance(row.get("pr"), dict)}
    prs = [row for row in report.get("pull_requests", [])
           if any(in_window(row.get(field), start, end) for field in ("created_at", "createdAt", "merged_at", "mergedAt"))
           or str(row.get("number")) in receipt_prs]
    pr_numbers = {str(row.get("number")) for row in prs}
    pr_shas = {row.get("headRefOid") or (row.get("head") or {}).get("sha") for row in prs}
    pr_shas.discard(None)
    ci = [row for row in report.get("ci_runs", [])
          if any(in_window(row.get(field), start, end) for field in ("created_at", "createdAt"))
          or (row.get("head_sha") or row.get("headSha")) in pr_shas]
    coverage = {}
    for key, value in report.get("source_coverage", {}).items():
        if ":" in key:
            prefix, identifier = key.split(":", 1)
            if not ((prefix == "issue_runs" and identifier in issue_ids)
                    or (prefix == "pr_reviews" and identifier in pr_numbers)):
                continue
        coverage[key] = {field: value.get(field) for field in ("status", "reason")} if isinstance(value, dict) else value
    semantic = {key: report[key] for key in ("schema_version", "date", "window", "tokens", "tokens_by_role_model", "timings", "quality")}
    semantic.update({
        "tasks": {key: value for key, value in report["tasks"].items()
                  if key not in {"inventory", "claimed_done_inventory", "done_without_verified_receipt"}},
        "executions": {key: value for key, value in report["executions"].items()
                       if key not in {"unknown_created_at", "missing_ids"}},
        "period_task_ids": sorted(set(task_ids)),
        "accepted_evidence": [{key: value for key, value in row.items()
                               if key not in {"title", "status", "identifier", "issue_id"}} for row in accepted],
        "pull_requests": [pr_evidence(row) for row in prs],
        "ci_runs": [ci_evidence(row) for row in ci], "source_coverage": coverage,
    })
    semantic = stable(semantic)
    return hashlib.sha256(encoded(semantic).encode()).hexdigest()


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(content)
    temporary.replace(path)


def publish(snapshot, report_date, root):
    root = Path(root).resolve()

    def contained(path):
        if not path.resolve().is_relative_to(root):
            raise ValueError("Report output must stay inside root")
        return path

    def write(path, content):
        atomic_write(contained(path), content)

    report = build_report(snapshot, report_date)
    digest = content_digest(report)
    directory = root / "docs/reports/autonomy"
    output = contained(directory / f"{report_date}.json")
    contained(root / "PROGRESS.md")
    contained(directory / "periods.json")
    contained(directory / f"{report_date}.md")
    previous = json.loads(output.read_text()) if output.exists() else None
    if previous and content_digest(previous) == digest:
        report = previous
    else:
        if previous:
            history = directory / ".history" / report_date / f"{previous['content_sha256']}.json"
            write(history, output.read_text())
        report["content_sha256"] = digest
        report["revision"] = previous.get("revision", 1) + 1 if previous else 1
        write(output, encoded(report))
    write(directory / f"{report_date}.md", render_report(report))
    reports = [json.loads(contained(path).read_text()) for path in sorted(directory.glob("????-??-??.json"))]
    latest_date = max(row["date"] for row in reports)
    write(directory / "periods.json", encoded({str(days): aggregate_period(reports, latest_date, days)
                                                     for days in (7, 30)}))
    write(root / "PROGRESS.md", render_progress(reports))
    return report


def sanitize(value):
    """Убираем сырой вывод, свободные тела и потенциальные секреты из публикации."""
    if isinstance(value, dict):
        return {key: sanitize(item) for key, item in value.items()
                if not re.search(r"secret|password|authorization|credential|api.?key|access.?token|refresh.?token|database.?url|connection.?string", key, re.I)
                and key not in {"description", "body", "content", "result", "error", "logs", "raw_logs", "stdout", "stderr", "output", "prompt", "trigger_payload"}}
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, str) and (re.search(r"[a-z][a-z0-9+.-]*://[^\s/]+:[^\s/]+@", value, re.I)
                                   or re.search(r"(?:api[_-]?key|token|secret|password)=", value, re.I)):
        return "[redacted]"
    return value


def safe_issue(issue):
    fields = {"id", "identifier", "number", "workspace_id", "project_id", "title", "status", "status_category",
              "status_name", "priority", "parent_issue_id", "stage", "created_at", "updated_at", "revision",
              "assignee_id", "assignee_type", "creator_id", "creator_type", "due_date", "start_date",
              "last_activity_at", "position", "labels"}
    result = sanitize({key: value for key, value in issue.items() if key in fields})
    metadata = issue.get("metadata")
    if isinstance(metadata, dict):
        safe_keys = {"task_id", "accepted_source_sha", "execution_state", "merge_commit", "stage", "work_class"}
        result["metadata"] = {
            key: value if isinstance(value, dict) and value.get("omitted") is True and set(value) == {"omitted", "type"}
            else sanitize(value) if key in safe_keys and isinstance(value, str)
            and re.fullmatch(r"[A-Za-z0-9_.:/#@-]{1,256}", value)
            else {"omitted": True, "type": type(value).__name__}
            for key, value in sanitize(metadata).items()
        }
    if issue.get("properties"):
        result["properties"] = {key: {"omitted": True, "type": type(value).__name__}
                                for key, value in issue["properties"].items()}
    return result


def json_command(args, attempts=3, pause=0.25):
    for attempt in range(attempts):
        try:
            completed = subprocess.run(args, capture_output=True, text=True, check=False, timeout=60)
            if completed.returncode == 0:
                return json.loads(completed.stdout)
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
        if attempt + 1 < attempts and pause:
            clock.sleep(pause * (attempt + 1))
    raise RuntimeError(f"Read-only source command failed after {attempts} attempts")


def no_action_result(result):
    if not isinstance(result, dict):
        return None
    if isinstance(result.get("no_action"), bool):
        return result["no_action"]
    output = result.get("output")
    if not isinstance(output, str):
        return None
    if output.strip() == "NO_ACTION":
        return True
    try:
        structured = json.loads(output)
        return structured["no_action"] if isinstance(structured, dict) and isinstance(structured.get("no_action"), bool) else None
    except ValueError:
        return None


def load_controller_receipts(directory):
    directory = Path(directory)
    if not directory.is_dir():
        raise ValueError("controller verified receipts directory does not exist")
    receipts = [json.loads(path.read_text()) for path in sorted(directory.glob("*.json"))]
    return [sanitize(row) for row in receipts if isinstance(row, dict) and row.get("verified") is True]


def attach_controller_receipts(snapshot, directory):
    directory = Path(directory)
    coverage = snapshot.setdefault("coverage", {})
    if not directory.is_dir():
        snapshot["receipts"] = []
        coverage["receipts"] = {"status": "partial", "reason": "controller_verified_directory_missing"}
        return snapshot
    try:
        snapshot["receipts"] = load_controller_receipts(directory)
        coverage["receipts"] = {"status": "complete", "records": len(snapshot["receipts"])}
    except (OSError, ValueError):
        snapshot["receipts"] = []
        coverage["receipts"] = {"status": "partial", "reason": "controller_verified_receipts_unavailable"}
    return snapshot


def collect_live(multica, server_url, workspace, project, repository, *,
                 run_json=json_command, max_pages=100, collected_at=None, maintenance_autopilot_ids=()):
    """Собираем project issue history и связанный autopilot usage; все команды read-only."""
    if max_pages < 1:
        raise ValueError("max_pages must be positive")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("repository must be owner/name")
    base = [multica, "--server-url", server_url, "--workspace-id", workspace]
    coverage = {}

    def get(args, source):
        try:
            value = run_json(args)
            if not isinstance(value, (dict, list)):
                raise ValueError("Expected JSON object or array")
            return value
        except (RuntimeError, OSError, ValueError, subprocess.SubprocessError):
            coverage[source] = {"status": "partial", "reason": "source_command_failed"}
            return None

    def rows(value, key):
        if isinstance(value, list):
            return value
        if isinstance(value, dict) and isinstance(value.get(key), list):
            return value[key]
        return []

    def multica_list(args, key, source):
        value = get(base + args + ["--output", "json"], source)
        valid = isinstance(value, list) or isinstance(value, dict) and isinstance(value.get(key), list)
        coverage.setdefault(source, {"status": "complete" if valid else "partial"})
        return rows(value, key)

    def pages(args, key, source):
        collected, offset = [], 0
        for _ in range(max_pages):
            value = get(base + args + ["--limit", "100", "--offset", str(offset), "--output", "json"], source)
            if value is None:
                break
            if not isinstance(value, list) and not (isinstance(value, dict) and isinstance(value.get(key), list)):
                coverage[source] = {"status": "partial", "reason": "unexpected_payload"}
                break
            page = rows(value, key)
            collected.extend(page)
            offset += len(page)
            if isinstance(value, dict):
                more = value.get("has_more")
                if more is None and numeric(value.get("total")):
                    more = offset < value["total"]
                if more is None:
                    coverage[source] = {"status": "partial", "reason": "missing_pagination_metadata"}
                    break
            else:
                more = len(page) >= 100
            if not more:
                coverage[source] = {"status": "complete", "records": len(collected)}
                return collected
            if not page:
                coverage[source] = {"status": "partial", "reason": "empty_page_with_more"}
                break
        coverage.setdefault(source, {"status": "partial", "reason": "page_cap", "records": len(collected)})
        return collected

    issues = pages(["issue", "list", "--project", project, "--sort", "created_at", "--direction", "asc"],
                   "issues", "issues")
    executions = []
    for issue in issues:
        identifier = issue.get("id")
        if not identifier:
            continue
        executions.extend(multica_list(["issue", "runs", identifier], "runs", f"issue_runs:{identifier}"))
    autopilots = [row for row in multica_list(["autopilot", "list"], "autopilots", "autopilots")
                  if row.get("project_id") == project or row.get("id") in maintenance_autopilot_ids]
    ap_runs = []
    for autopilot in autopilots:
        ap_runs.extend(pages(["autopilot", "runs", autopilot["id"]], "runs", f"autopilot_runs:{autopilot['id']}"))
    ap_links = {row["task_id"]: row for row in ap_runs if row.get("task_id")}
    issue_ids = {row["id"] for row in issues if row.get("id")}
    agents = multica_list(["agent", "list", "--include-archived"], "agents", "agents")
    agent_tasks = []
    for agent in agents:
        identifier = agent.get("id")
        if not identifier:
            continue
        for task in multica_list(["agent", "tasks", identifier], "tasks", f"agent_tasks:{identifier}"):
            if task.get("issue_id") in issue_ids or task.get("id") in ap_links:
                item = dict(task)
                item["role"] = item.get("role") or agent.get("role") or agent.get("name") or "unknown"
                if item.get("id") in ap_links:
                    item["autopilot_id"] = ap_links[item["id"]].get("autopilot_id")
                    item["kind"] = "autopilot"
                agent_tasks.append(item)
    found_ids = {row.get("id") for row in executions + agent_tasks}
    missing_ap = sorted(set(ap_links) - found_ids)
    unlinked_ap_events = [row for row in ap_runs if not row.get("task_id")]
    skipped_ap_events = sum(str(row.get("status", "")).lower() == "skipped" for row in unlinked_ap_events)
    missing_ap_task_ids = len(unlinked_ap_events) - skipped_ap_events
    for identifier in missing_ap:
        source = ap_links[identifier]
        agent_tasks.append({"id": identifier, "autopilot_id": source.get("autopilot_id"),
                            "kind": "autopilot", "created_at": source.get("created_at"),
                            "completed_at": source.get("completed_at"), "status": source.get("status"),
                            "usage": None})
    coverage["executions"] = {
        "status": "complete" if not missing_ap and not missing_ap_task_ids and all(
            item["status"] == "complete" for item in coverage.values()) else "partial",
        "missing_autopilot_task_ids": missing_ap, "autopilot_events_without_task_id": missing_ap_task_ids,
        "skipped_autopilot_events_without_task_id": skipped_ap_events,
        "basis": "issue runs full history + archived agents tasks + paginated autopilot task links",
    }

    def gh_pages(endpoint, key, source):
        collected = []
        for page in range(1, max_pages + 1):
            value = get(["gh", "api", f"repos/{repository}/{endpoint}&per_page=100&page={page}"], source)
            if value is None:
                return collected
            if not isinstance(value, list) and not (isinstance(value, dict) and isinstance(value.get(key), list)):
                coverage[source] = {"status": "partial", "reason": "unexpected_payload"}
                return collected
            batch = rows(value, key)
            collected.extend(batch)
            if len(batch) < 100:
                coverage[source] = {"status": "complete", "records": len(collected)}
                return collected
        coverage[source] = {"status": "partial", "reason": "page_cap", "records": len(collected)}
        return collected

    prs = gh_pages("pulls?state=all&sort=created&direction=asc", "pull_requests", "pull_requests")
    ci_runs = gh_pages("actions/runs?exclude_pull_requests=false", "workflow_runs", "ci_runs")
    for pr in prs:
        if pr.get("number"):
            pr["reviews"] = gh_pages(f"pulls/{pr['number']}/reviews?", "reviews", f"pr_reviews:{pr['number']}")
    safe_executions = []
    safe_agent_tasks = []
    agent_roles = {row.get("id"): row.get("role") or row.get("name") for row in agents}
    fields = ("id", "issue_id", "agent_id", "created_at", "started_at", "completed_at", "updated_at",
              "status", "attempt", "kind", "autopilot_id", "usage", "role", "no_action")
    for source, target in ((executions, safe_executions), (agent_tasks, safe_agent_tasks)):
        for row in source:
            safe = {key: row[key] for key in fields if key in row}
            if not safe.get("role") and agent_roles.get(row.get("agent_id")):
                safe["role"] = agent_roles[row["agent_id"]]
            no_action = no_action_result(row.get("result"))
            if no_action is not None:
                safe["no_action"] = no_action
            attribution = row.get("attribution") or {}
            if isinstance(attribution, dict) and attribution.get("role"):
                safe["role"] = attribution["role"]
            target.append(safe)
    return {"schema_version": 1, "collected_at": collected_at or iso(datetime.now(timezone.utc)),
            "scope": {"server_url": server_url, "workspace_id": workspace,
                      "project_id": project, "repository": repository},
            "coverage": coverage, "issues": [safe_issue(row) for row in issues], "executions": safe_executions,
            "agent_tasks": safe_agent_tasks, "autopilot_runs": sanitize(ap_runs),
            "pull_requests": sanitize(prs), "ci_runs": sanitize(ci_runs), "receipts": []}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    collect = commands.add_parser("collect", help="Read-only сбор Multica и GitHub в безопасный JSON")
    collect.add_argument("--multica", default="multica")
    collect.add_argument("--server-url", required=True)
    collect.add_argument("--workspace-id", required=True)
    collect.add_argument("--project-id", required=True)
    collect.add_argument("--repo", required=True)
    collect.add_argument("--max-pages", type=int, default=100)
    collect.add_argument("--maintenance-autopilot-id", action="append", default=[])
    collect.add_argument("--output", type=Path, required=True)
    collect.add_argument("--receipts-dir", type=Path, help="Доверенный controller state_dir/verified; не каталог task-authored receipt")
    render = commands.add_parser("render", help="Создать сутки, 7/30 агрегаты и PROGRESS из JSON")
    render.add_argument("--snapshot", type=Path, required=True)
    render.add_argument("--date", required=True, help="Дата окончания суток в Europe/Moscow")
    render.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    if args.command == "collect":
        snapshot = collect_live(args.multica, args.server_url, args.workspace_id, args.project_id,
                                args.repo, max_pages=args.max_pages,
                                maintenance_autopilot_ids=args.maintenance_autopilot_id)
        if args.receipts_dir:
            attach_controller_receipts(snapshot, args.receipts_dir)
        atomic_write(args.output, encoded(sanitize(snapshot)))
        print(f"Snapshot: {args.output}")
        return 0
    snapshot = json.loads(args.snapshot.read_text())
    report = publish(snapshot, args.date, args.root)
    print(f"Report: {report['date']}, revision {report['revision']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
