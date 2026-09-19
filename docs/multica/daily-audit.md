# Суточный аудит автономной работы

Отчёт отвечает на три вопроса: какой полезный результат принят, насколько ему можно доверять и во что обошлось его
получение. Источник входных данных — Multica, GitHub и проверенные controller receipts. Корневой
[PROGRESS.md](../../PROGRESS.md) показывает последние сутки и агрегаты за 7/30 суток; подробности сохраняются в
[`docs/reports/autonomy/`](../reports/autonomy/README.md).

## Порядок ежедневного сбора

1. После 10:00 Europe/Moscow собрать срез всех issue проекта без фильтра по статусу: родители, стадии, открытые и
   закрытые задачи, безопасные metadata. Сохранить ошибки чтения и границы доступности источников.
2. Собрать всю историю issue runs, историю autopilot и agent tasks, включая архивных агентов. Связать autopilot event
   с native `task_id`; дедуплицировать по native execution `id`. Event autopilot и его agent task — одна попытка.
3. Собрать PR, reviews и CI runs GitHub. Подключить только `state_dir/verified/*.json`, записанные controller после
   проверки фактов. Task-authored receipt или сам статус Done не доказывают принятие результата.
4. Создать отчёт за дату окончания окна. Дать читаемый вывод о полезном результате, качестве, доставке и расходах;
   сохранить машинные значения с неизвестными полями. Проверить полноту, а затем использовать аудит при выборе
   следующих задач и приоритета исправлений.
5. При поздних данных повторно собрать затронутые сутки. Старые версии остаются в `.history`; исправление прошлых суток
   пересчитывает 7/30 агрегаты, не меняя дату последнего отчёта на более раннюю.

Дневной аудит сам не назначает работу, не меняет issue и не отправляет сообщения. Сбор и рендеринг выполняются
детерминированным Python stdlib кодом `scripts/autonomy/reporting.py`.

## Публикация и слияние

Решение владельца от 2026-09-19: отчёты сразу сливаются в `app`, а не ждут на отдельной ветке.
`scripts/autonomy/daily_publish.py` публикует ветку `codex/autonomy-report-<date>` и один PR, ждёт итоговый
`test` GitHub Actions по точному head SHA и сливает PR обычным merge-коммитом
(`gh pr merge --merge --match-head-commit`). Отставание от `app` merge не мешает: с 2026-09-19 защита `app` не
требует актуальной ветки. Если за время CI в `app` попал другой отчёт и PR конфликтует в `PROGRESS.md` или
`periods.json` (либо защита снова требует актуальности), publisher вливает `app` в ветку, пересчитывает оба
индекса из суточных JSON и ждёт CI нового head. После подтверждённого merge он удаляет свои локальные
worktree и ветку; ветку на `origin` снимает GitHub.

Красный CI, конфликт или таймаут оставляют PR открытым, а запуск завершается ошибкой; Ledger допускает повтор
тех же суток, и повтор сливает существующий PR. Параметры конфигурации: `report_auto_merge` (по умолчанию
`true`), `report_merge_timeout_seconds` (1800), `report_merge_poll_seconds` (20) и `report_merge_attempts` (3).

## Команды

Параметры сервера, workspace, проекта и GitHub repository обязательны. Collector не использует неявный активный
workspace. Projectless служебные autopilot включаются только явным `--maintenance-autopilot-id`;
публикация передаёт allowlist из `maintenance_autopilot_ids` конфигурации. Agent tasks чужих project issue
исключаются; служебные запуски не считаются принятым продуктовым результатом. Путь `--receipts-dir` — доверенное хранилище controller, доступное только controller; произвольный каталог
с `verified: true` не является подтверждением. Сам отчёт не проверяет подпись и не выполняет повторно acceptance gates.

```bash
python3 scripts/autonomy/reporting.py collect \
  --multica /Applications/Multica.app/Contents/Resources/app.asar.unpacked/resources/bin/multica \
  --server-url https://api.multica.ai \
  --workspace-id WORKSPACE_UUID \
  --project-id PROJECT_UUID \
  --repo OWNER/REPOSITORY \
  --receipts-dir /private/tmp/controller-state/verified \
  --output /private/tmp/altera-audit-snapshot.json

python3 scripts/autonomy/reporting.py render \
  --snapshot /private/tmp/altera-audit-snapshot.json \
  --date 2026-09-16 \
  --root .

python3 -m unittest discover -s scripts/autonomy -p test_reporting.py
```

CLI использует только read-only `multica issue list/runs`, `agent list/tasks`, `autopilot list/runs` и `gh api` GET.
Таймаут отдельного чтения — 60 секунд; при ошибке read-only команда повторяется один раз, всего не более двух попыток. `--max-pages` ограничивает число страниц каждого endpoint, по умолчанию 100;
достижение лимита даёт `partial`, а не полноту. Issue list постраничный по 100; issue runs и agent tasks используют
документированный полный history endpoint. Autopilot usage, не найденный у агента, остаётся известной попыткой с
неизвестными токенами. Связи autopilot без native task ID отражаются в coverage и не получают выдуманных execution ID.

Неуспех отдельного источника не уничтожает уже прочитанные данные. Collector сохраняет JSON с `coverage` и причинами
`source_command_failed`, `page_cap` или `unexpected_payload`; исходные stderr не публикуются. Успешный exit code collector
означает наличие среза, а не полноту или здоровье источников. Для scheduler решение о повторном сборе принимается по
`coverage`. CLI рендера работает офлайн; он доверяет явно переданному snapshot и не повышает его достоверность.

## Окна и сопоставимость

Для даты `2026-09-16` берётся полуоткрытый интервал `[2026-09-15 10:00, 2026-09-16 10:00)` Europe/Moscow.
Начало входит, конец не входит. Timestamp без timezone считается неизвестным.

| Объект                      | Привязка к суткам              | Ограничение                                                    |
| --------------------------- | ------------------------------ | -------------------------------------------------------------- |
| Попытка исполнения          | `created_at` native task       | Все наблюдённые токены попытки; завершение может выйти за окно |
| Новая задача                | `created_at` issue             | Родители и дочерние стадии показаны отдельно                   |
| Принятый результат          | `accepted_at` verified receipt | Задача могла быть создана задолго до окна                      |
| Done без verified receipt   | Весь инвентарь на момент среза | Это текущая неподтверждённость, не суточный поток false Done   |
| Deployment, SQL/Redis, диск | Timestamp измерения            | Не переносятся в окно без оговорки                             |

7/30 суток — суммы непересекающихся суточных когорт по каноническим JSON. Пропущенные даты перечисляются в
`periods.json`, а не заменяются нулями. Периодные median/p90 пересчитываются по исходным измерениям, а не усредняются
из дневных median. P90 — ближайший ранг `ceil(0.9 * n)`. Запуски без `created_at` явно подсчитываются вне когорты.

## Что измеряется

| Область         | Метрики и доказательства                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| Полезная работа | Принятые controller задачи; `product`, `maintenance`, `self_rework`, неизвестный класс раздельно         |
| Acceptance      | AC, source, baseline/tested SHA, PR, CI, review и finalization по каждой задаче                          |
| Качество кода   | Независимый проверенный review, наблюдённые регрессии и доля receipt с измерением                        |
| Тесты           | Passed/failed/skipped/todo с числом receipt, где поле измерено; фактическое покрытие или `null`          |
| Доставка        | Проверенный deployment, SQL/Redis health либо неизвестность; Done без подтверждения отдельно             |
| Скорость        | Queue, execution и lead seconds: median/p90 и число наблюдений                                           |
| Перезапуски     | Уникальные попытки, `attempt > 1`, явные no-op и полнота определения no-op                               |
| Расходы         | Input/output/cache-read/cache-write отдельно; native execution dedupe, роль/модель, число полных записей |
| Диск            | Timestamp, logical bytes, фактический reclaimed bytes и cleanup evidence; неизвестное не равно нулю      |

LOC, число комментариев, размер отчётов и единый «quality score» не используются как качество или throughput.
Сумма passed по receipt не означает количество уникальных тестов: один suite мог запускаться по нескольким задачам.
CI metadata и отзывы сами по себе не считаются независимым review текущего SHA. `review.independent` и `review.verified`
должны быть получены от controller. Для канонического receipt с внешним `verified: true` также принимается
`review.verdict=approved`, отдельный `review.actor_id`, отличный от `implementer_id`, и совпадение `review.tested_sha`
с проверенным SHA receipt; дополнительный внутренний `review.verified` не требуется. Регрессии без проверенного
измерения остаются `null`.

`no_action` распознаётся только как boolean, JSON boolean в `result.output` либо точный маркер `NO_ACTION`.
Упоминание no-op в свободном тексте не считается исходом. Роль берётся из `role` / `attribution.role`; при отсутствии используется доступное имя агента как метка группы.
Если оба поля отсутствуют, группа называется `unknown`. Модель берётся из отдельных записей usage.

`observed` — сумма доступных значений, даже если у другой модели или попытки поле неизвестно. `known_runs` считает
попытку полной лишь когда поле задано у каждой её модели. `total_runs` — все известные попытки когорты. `complete`
в токенах означает полноту телеметрии известных попыток; глобальная полнота дополнительно требует полного `coverage`.
Cache не складывается с input в условный billing total, цена не выдумывается.

## Машинный контракт

Snapshot версии 1 содержит `collected_at`, `scope`, `coverage`, `issues`, `executions`, `agent_tasks`, `receipts`,
`pull_requests`, `ci_runs`; дополнительные измерения — `delivery`, `disk`. Минимальный пример нормализованного receipt:

```json
{
  "schema_version": 1,
  "task_id": "T-123",
  "verified": true,
  "accepted_at": "2026-09-15T12:00:00Z",
  "work_class": "product",
  "source": { "issue_id": "native-issue-uuid" },
  "baseline_sha": "baseline-commit",
  "tested_sha": "tested-commit",
  "acceptance": { "passed": 3, "total": 3 },
  "tests": { "passed": 12, "failed": 0, "skipped": 2, "todo": 0, "coverage": null },
  "review": { "independent": true, "verified": true },
  "regressions": null,
  "pr": null,
  "ci": null,
  "deployment": null,
  "finalization": { "path": "report.md", "sha256": "artifact-digest" }
}
```

Это пример полей отчётности, а не валидный receipt для прохождения controller: `null` в обязательных gates не допускает
принятия. Controller определяет собственный строгий контракт. Необязательные тестовые и аналитические поля без
измерения остаются неизвестными. `source.issue_id` или `issue.metadata.task_id` связывают canonical task ID с native issue.

Сбор использует allowlist полей issue и удаляет свободные description/body/content, raw logs, stdio, result/error,
connection strings и поля с именами секретов. Для всех issue сохраняются безопасные идентификаторы metadata
(`task_id`, SHA, execution state, stage, work class). Остальные значения metadata/properties заменяются маркером
`omitted` с типом исходного значения; структура остаётся видна без публикации свободного текста. Токены читаются только из native usage, никогда не извлекаются из свободного текста.
Передаваемый вручную snapshot должен быть заранее очищен; фильтрация по именам полей не является универсальным DLP.

## Историческая база

Первичный [аудит 2026-09-15](../audits/2026-09-15-multica/metrics.json) использует нестандартное окно среза и содержит
248 попыток, включая 23 autopilot. Он служит историческим примером источников и ограничений, но не вставляется в
сутки 10:00→10:00 или 7/30 агрегаты. Временные исходные API payloads и сырые логи в репозиторий не копируются.
