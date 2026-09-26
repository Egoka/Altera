#!/usr/bin/env python3
"""Сверка статусов бэклога с Multica, слитыми PR и receipt; пересборка производных таблиц.

Источник истины для таблиц — строка `- **Статус**:` в `docs/backlog/tasks/T-*.md`
(`docs/backlog/README.md` §2–4). Скрипт только читает Multica и GitHub, ничего в них не меняет.

    python3 scripts/backlog/sync_status.py              # сверка, отчёт в stdout
    python3 scripts/backlog/sync_status.py --apply      # правка шапок и таблиц
    python3 scripts/backlog/sync_status.py --check      # exit 1, если файлы расходятся с фактом

Порядок повторного прогона — `docs/backlog/README.md` §4.
"""

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKLOG = ROOT / "docs" / "backlog"
TASKS = BACKLOG / "tasks"
RECEIPTS = ROOT / "docs" / "reports" / "tasks"
DEFAULT_MULTICA = "/Applications/Multica.app/Contents/Resources/app.asar.unpacked/resources/bin/multica"
DEFAULT_PROJECT = "1ff3917d-4c10-4303-a671-406c1fda9613"
DEFAULT_REPO = "Egoka/Altera"

DONE, IN_PROGRESS = "завершена", "в работе"
OPEN_ISSUE = {"in_review", "in_progress", "todo", "blocked", "backlog"}

# Задачи, у которых после принятой выдачи открыта повторная с ещё не принятым критерием:
# пока повторная выдача открыта, задача остаётся «в работе». Когда её закроют, правило
# перестаёт действовать само.
PREFER_OPEN_REISSUE = {
    "T-005": "ALTE-17 приняла линт и сборку; удаление демо-страниц (критерий 2) влито PR #116 в ALTE-67",
}

STATUS_RE = re.compile(r"^- \*\*Статус\*\*: (.*)$", re.M)
# `завершена` без пояснений или с пояснением, которое пишет сам скрипт, пересчитывается заново.
GENERATED_DONE = re.compile(r"^завершена(?: \((?:PR #\d+, merge [0-9a-f]{8}; )?приёмка .*\))?$")
TASK_ID_RE = re.compile(r"T-\d{3}")


def field(text, name):
    match = re.search(rf"^- \*\*{re.escape(name)}\*\*: (.*)$", text, re.M)
    return match.group(1).strip() if match else ""


def section(text, number):
    match = re.search(rf"^## {number}\..*?\n(.*?)(?=^## \d|\Z)", text, re.M | re.S)
    return match.group(1).strip() if match else ""


def load_tasks():
    tasks = {}
    for path in sorted(TASKS.glob("T-*.md")):
        text = path.read_text()
        task_id = path.name[:5]
        title = re.match(r"# T-\d{3}: (.*)", text).group(1).strip()
        deps_line = re.search(r"^- Зависит от: (.*)$", section(text, 4), re.M)
        status = field(text, "Статус")
        deps = set(TASK_ID_RE.findall(deps_line.group(1) if deps_line else ""))
        if status.startswith("зависит:"):
            deps |= set(TASK_ID_RE.findall(status))
        proof = section(text, 6).split("\n\n")[0].replace("\n", " ")
        proof = re.sub(r"\s*Отчёт по ритуалу проекта.*$", "", proof).strip()
        tasks[task_id] = {
            "id": task_id,
            "path": path,
            "file": path.name,
            "title": title,
            "epic": field(text, "Эпик").split()[0],
            "status": status,
            "parallel": field(text, "Параллельность"),
            "role": field(text, "Роль-исполнитель"),
            "participants": field(text, "Участники стадий"),
            "skills": field(text, "Навыки"),
            "deps": sorted(deps),
            "deps_text": ", ".join(TASK_ID_RE.findall(deps_line.group(1))) if deps_line else "—",
            "proof": proof,
        }
    return tasks


def open_questions():
    """Открытые Q-блокеры и задачи, которые они блокируют (`owner-blockers.md`)."""
    text = (BACKLOG / "owner-blockers.md").read_text()
    blocked = {}
    for block in re.split(r"^## ", text, flags=re.M)[1:]:
        qid = block.split(".")[0].strip()
        if field("\n" + block, "Статус") != "открыт":
            continue
        for task_id in TASK_ID_RE.findall(field("\n" + block, "Блокирует")):
            if qid not in blocked.setdefault(task_id, []):
                blocked[task_id].append(qid)
    return blocked


def run_json(args, attempts=3):
    """Чтение из CLI; сетевые сбои `gh`/`multica` бывают разовыми, поэтому до трёх попыток."""
    for attempt in range(attempts):
        done = subprocess.run(args, capture_output=True, text=True)
        if done.returncode == 0:
            return json.loads(done.stdout)
        if attempt == attempts - 1:
            sys.exit(f"{Path(args[0]).name} {args[1]} {args[2]}: exit {done.returncode}\n{done.stderr.strip()}")
        time.sleep(2 * (attempt + 1))


def fetch_issues(multica, project):
    issues, offset = [], 0
    while True:
        page = run_json([multica, "issue", "list", "--project", project, "--limit", "100",
                         "--offset", str(offset), "--output", "json"])
        rows = page if isinstance(page, list) else page.get("issues", [])
        issues.extend(rows)
        offset += len(rows)
        more = page.get("has_more") if isinstance(page, dict) else None
        if not rows or more is False or (more is None and len(rows) < 100):
            return issues


def fetch_prs(repo):
    return run_json(["gh", "pr", "list", "--repo", repo, "--state", "merged", "--base", "app",
                     "--limit", "1000", "--json", "number,title,headRefName,mergedAt,mergeCommit"])


def issues_by_task(issues):
    result = {}
    for issue in issues:
        if issue.get("status") == "cancelled":
            continue
        ids = set(TASK_ID_RE.findall(issue.get("title", "")[:12]))
        meta = (issue.get("metadata") or {}).get("task_id")
        if meta:
            ids = {meta}
        for task_id in ids:
            result.setdefault(task_id, []).append(issue)
    for rows in result.values():
        rows.sort(key=lambda row: row.get("number", 0))
    return result


def pr_for_task(task_id, prs):
    """PR задачи: номер из receipt, иначе самый ранний слитый PR с номером задачи в ветке/заголовке."""
    by_number = {pr["number"]: pr for pr in prs}
    receipt = RECEIPTS / f"{task_id}.json"
    if receipt.exists():
        number = (json.loads(receipt.read_text()).get("pr") or {}).get("number")
        if number in by_number:
            return by_number[number], True
    digits = task_id[2:]
    pattern = re.compile(rf"(?<![\d])t-?{digits}(?!\d)", re.I)
    for key in ("headRefName", "title"):
        hits = sorted((pr for pr in prs if pattern.search(pr[key])), key=lambda pr: pr["number"])
        if hits:
            return hits[0], receipt.exists()
    return None, receipt.exists()


def decide(task, rows, prs, questions):
    """Статус задачи по факту; для невзятых задач зависимости пересчитываются позже."""
    # Стадийные подзадачи (например, «T-011 стадия 4») не считаются приёмкой всей задачи.
    main = [row for row in rows if "стадия" not in row.get("title", "")] or rows
    done = [row for row in main if row["status"] == "done"]
    open_rows = [row for row in rows if row["status"] in OPEN_ISSUE]
    in_review = [row for row in open_rows if row["status"] == "in_review"]
    blocked = [row for row in open_rows if row["status"] == "blocked"]
    pr, has_receipt = pr_for_task(task["id"], prs)
    evidence = {
        "issues": [f"{row['identifier']}:{row['status']}" for row in rows],
        "pr": pr["number"] if pr else None,
        "merge": pr["mergeCommit"]["oid"][:8] if pr else None,
        "receipt": has_receipt,
    }
    notes = []
    merged = f"PR #{pr['number']}, merge {pr['mergeCommit']['oid'][:8]}" if pr else None
    over_q = "".join(f"; реализована при открытом {q}" for q in questions.get(task["id"], []))

    reopened = task["id"] in PREFER_OPEN_REISSUE and in_review
    # `завершена`, записанная хранителем документации, не понижается; расхождение — в отчёт.
    accepted_in_file = task["status"].startswith(DONE)
    if (done or accepted_in_file and rows) and not reopened:
        if not done:
            notes.append(f"в файле завершена, в Multica {open_rows[-1]['identifier']} ещё {open_rows[-1]['status']}")
        elif open_rows:
            notes.append("после приёмки открыта повторная выдача "
                         + ", ".join(f"{r['identifier']} ({r['status']})" for r in open_rows))
        if not merged:
            notes.append("слитый PR не найден")
        if accepted_in_file and not GENERATED_DONE.match(task["status"]):
            # Ручная пометка хранителя (например, перенос критерия) сохраняется как есть.
            return task["status"], "done" if done else open_rows[-1]["status"], evidence, notes
        if done:
            accepted = f"приёмка {done[-1]['identifier']}"
        else:
            accepted = f"приёмка записана в файле, {open_rows[-1]['identifier']} в Multica — {open_rows[-1]['status']}"
        status = f"{DONE} ({merged + '; ' if merged else ''}{accepted}{over_q})"
        return status, "done" if done else open_rows[-1]["status"], evidence, notes
    if in_review:
        review = in_review[-1]["identifier"]
        head = f"влита {merged}" if merged else "слитый PR не найден"
        if reopened:
            notes.append(PREFER_OPEN_REISSUE[task["id"]])
        if not merged:
            notes.append("in_review без слитого PR")
        return f"{IN_PROGRESS} ({head}; ждёт приёмки {review}{over_q})", "in_review", evidence, notes
    if blocked:
        notes.append("blocked в Multica: " + ", ".join(r["identifier"] for r in blocked))
        return None, "blocked", evidence, notes
    if open_rows:
        return f"{IN_PROGRESS} ({open_rows[-1]['identifier']})", open_rows[-1]["status"], evidence, notes
    return None, "untaken", evidence, notes


def reconcile(tasks, issues, prs):
    questions = open_questions()
    grouped = issues_by_task(issues)
    result = {}
    for task_id, task in tasks.items():
        status, state, evidence, notes = decide(task, grouped.get(task_id, []), prs, questions)
        result[task_id] = {"old": task["status"], "new": status, "multica": state,
                           "evidence": evidence, "notes": notes}
    finished = {tid for tid, row in result.items()
                if (row["new"] or row["old"]).startswith(DONE)}
    for task_id, row in result.items():
        if row["new"] is not None:
            continue
        old = row["old"]
        if old.startswith("зависит:"):
            left = [dep for dep in tasks[task_id]["deps"] if dep not in finished]
            row["new"] = f"зависит: {', '.join(left)}" if left else "кандидат"
        elif old.startswith(DONE) and row["multica"] == "untaken":
            row["new"] = old
            row["notes"].append("завершена в файле, в Multica задачи нет")
        else:
            row["new"] = old
    return result


# --- производные таблицы -------------------------------------------------------------------

def cell(value):
    return (value or "—").replace("|", "\\|")


def replace_table(text, heading, rows_md, header_md):
    """Заменяет первую таблицу после строки `heading`."""
    start = text.index(heading)
    table = re.compile(r"(\n\|[^\n]*\|[ \t]*)+\n?")
    match = table.search(text, start)
    new = "\n" + header_md + "\n" + "\n".join(rows_md) + "\n"
    return text[:match.start()] + new + text[match.end():]


def counts(tasks):
    buckets = {"завершена": 0, "в работе": 0, "готова": 0, "кандидат": 0, "зависит": 0,
               "решение владельца": 0, "отложена": 0}
    for task in tasks.values():
        for key in buckets:
            if task["status"].startswith(key):
                buckets[key] += 1
                break
    return buckets


def render(tasks, date):
    epic_order = lambda t: (int(t["epic"][2:]), t["id"])  # noqa: E731
    files = {}

    path = BACKLOG / "matrix.md"
    text = path.read_text()
    # У части принятых задач §6 уже переписан в журнал доказательств («Принято …», «- **sha**»);
    # для них колонка «Проверка» берётся из прежней матрицы.
    previous = {line.split(" | ")[0][2:]: line.split(" | ")[6]
                for line in text.splitlines() if line.startswith("| T-")}
    for t in tasks.values():
        if re.match(r"(Принято|- \*\*)", t["proof"]) and t["id"] in previous:
            t["proof"] = previous[t["id"]].replace("\\|", "|")
    head = text[:text.index("\n| ID |")]
    head = re.sub(r"^- \*\*Сверка статусов\*\*.*\n?", "", head, flags=re.M).rstrip("\n")
    head += (f"\n- **Сверка статусов**: {date}, `scripts/backlog/sync_status.py` — Multica, слитые PR и "
             "receipt; `в работе (влита …; ждёт приёмки …)` означает код в `app` без независимой приёмки.\n")
    header = ("| ID | Эпик | Задача | Роль-исполнитель | Участники стадий | Навыки | Проверка и доказательство "
              "| Зависимости | Параллельность | Статус |\n|---|---|---|---|---|---|---|---|---|---|")
    rows = [f"| {t['id']} | {t['epic']} | {cell(t['title'])} | {cell(t['role'])} | {cell(t['participants'])} "
            f"| {cell(t['skills'])} | {cell(t['proof'])} | {cell(t['deps_text'])} | {cell(t['parallel'])} "
            f"| {cell(t['status'])} |" for t in sorted(tasks.values(), key=epic_order)]
    files[path] = head + "\n" + header + "\n" + "\n".join(rows) + "\n"

    path = BACKLOG / "README.md"
    text = path.read_text()
    rows = [f"| [{t['id']}](tasks/{t['file']}) | {cell(t['title'])} | {t['epic']} | {cell(t['status'])} |"
            for t in sorted(tasks.values(), key=lambda t: t["id"])]
    text = replace_table(text, "## 7. Задачи", rows, "| ID | Задача | Эпик | Статус |\n| --- | --- | --- | --- |")
    c = counts(tasks)
    total = (f"Итого задач: {len(tasks)} — завершённых {c['завершена']}, в работе {c['в работе']}, "
             f"готовых {c['готова']}, кандидатов {c['кандидат']}, зависимых {c['зависит']}, "
             f"ждут решения владельца {c['решение владельца']}, отложенных {c['отложена']} "
             f"(сверка {date}).")
    text = re.sub(r"^Итого задач: .*$", total, text, flags=re.M)
    files[path] = text

    for path in sorted((BACKLOG / "epics").glob("E-*.md")):
        epic = path.name[:4]
        members = sorted((t for t in tasks.values() if t["epic"] == epic), key=lambda t: t["id"])
        if not members:
            continue
        rows = [f"| [{t['id']}](../tasks/{t['file']}) | {cell(t['title'])} | {cell(t['status'])} "
                f"| {cell(t['deps_text'])} |" for t in members]
        files[path] = replace_table(path.read_text(), "## Задачи", rows,
                                    "| ID | Название | Статус | Зависит от |\n|---|---|---|---|")

    path = BACKLOG / "ready-candidates.md"
    text = path.read_text()
    for heading, prefix in (("## Готовые задачи", "готова"), ("## Кандидаты", "кандидат")):
        rows = [f"| [{t['id']}](tasks/{t['file']}) | {cell(t['title'])} | {cell(t['role'])} | {cell(t['parallel'])} |"
                for t in sorted(tasks.values(), key=lambda t: t["id"]) if t["status"].startswith(prefix)]
        rows = rows or ["| — | нет задач с этим статусом | — | — |"]
        text = replace_table(text, heading, rows,
                             "| ID | Задача | Роль-исполнитель | Параллельность |\n|---|---|---|---|")
    text = re.sub(r"помечено `решение владельца: Q-NN` \(\d+ задач[а-я]*\)",
                  f"помечено `решение владельца: Q-NN` ({c['решение владельца']} задач)", text)
    files[path] = text
    return files


# --- отчёт ---------------------------------------------------------------------------------

def report_md(result, tasks, date):
    lines = [f"# Сверка статусов бэклога — {date}", "",
             "| Задача | Статус в файле до сверки | Статус по факту | Multica | PR | receipt | Замечания |",
             "|---|---|---|---|---|---|---|"]
    for task_id in sorted(result):
        row = result[task_id]
        if row["old"] == row["new"] and not row["notes"]:
            continue
        ev = row["evidence"]
        lines.append(f"| {task_id} | {cell(row['old'])} | {cell(row['new'])} | {cell(', '.join(ev['issues']))} "
                     f"| {'#' + str(ev['pr']) if ev['pr'] else '—'} | {'да' if ev['receipt'] else 'нет'} "
                     f"| {cell('; '.join(row['notes']))} |")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="записать статусы и таблицы")
    parser.add_argument("--check", action="store_true", help="exit 1 при расхождении")
    parser.add_argument("--issues-json", help="готовый вывод `multica issue list` вместо живого запроса")
    parser.add_argument("--prs-json", help="готовый вывод `gh pr list` вместо живого запроса")
    parser.add_argument("--multica", default=os.environ.get("MULTICA_BIN", DEFAULT_MULTICA))
    parser.add_argument("--project", default=DEFAULT_PROJECT)
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--date", default=dt.date.today().isoformat())
    parser.add_argument("--report-json", help="куда сохранить сверку в JSON")
    parser.add_argument("--report-md", help="куда сохранить таблицу сверки в Markdown")
    args = parser.parse_args()

    issues = json.loads(Path(args.issues_json).read_text()) if args.issues_json else fetch_issues(args.multica, args.project)
    prs = json.loads(Path(args.prs_json).read_text()) if args.prs_json else fetch_prs(args.repo)
    tasks = load_tasks()
    result = reconcile(tasks, issues, prs)

    stale_headers = [tid for tid, row in result.items() if row["new"] != row["old"]]
    for task_id in stale_headers:
        tasks[task_id]["status"] = result[task_id]["new"]
    files = render(tasks, args.date)
    stale_tables = [path for path, text in files.items() if path.read_text() != text]

    if args.report_json:
        Path(args.report_json).write_text(json.dumps(
            {"date": args.date, "tasks": result}, ensure_ascii=False, indent=2, default=str) + "\n")
    md = report_md(result, tasks, args.date)
    if args.report_md:
        Path(args.report_md).write_text(md)
    elif not args.check:
        sys.stdout.write(md)

    if args.apply:
        for task_id in stale_headers:
            path = tasks[task_id]["path"]
            text = path.read_text()
            new = STATUS_RE.sub(lambda _: f"- **Статус**: {result[task_id]['new']}", text, count=1)
            path.write_text(new)
        for path, text in files.items():
            path.write_text(text)
    # Таблицы README/эпиков содержат дату сверки; при --check сравниваем без неё.
    if args.check:
        undated = [p for p in stale_tables
                   if re.sub(r"\d{4}-\d{2}-\d{2}", "", p.read_text()) != re.sub(r"\d{4}-\d{2}-\d{2}", "", files[p])]
        print(f"шапок к правке: {len(stale_headers)}; таблиц к пересборке: {len(undated)}")
        for task_id in stale_headers:
            print(f"  {task_id}: {result[task_id]['old']} → {result[task_id]['new']}")
        for path in undated:
            print(f"  {path.relative_to(ROOT)}")
        return 1 if stale_headers or undated else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
