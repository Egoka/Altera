# Исполнимый gate контрактов Agent Loop

`python3 scripts/agent-loop/gate.py --help` — локальный CLI на Python 3.9+ и Git.
Он проверяет машинные sidecar-файлы к [каноническому контракту](artifact-contracts.md),
сохраняет ownership, историю evidence и счёт неуспехов между процессами. Это проверка
структуры и согласованности, **не security boundary и не независимая приёмка**.

## Поддержанная граница

- Claude Stop вызывает этот CLI через `.claude/hooks/ritual-check.sh`. Повторный Stop проверяет
  тот же контракт, не пропускает его и не освобождает slot. Неуспех возвращает exit `2`.
- Codex этот Claude hook не запускает. Для него вызывающая сторона должна явно исполнить CLI.
  Завершение ответа, native outcome, окончание стадии и принятие задачи остаются разными фактами.
- Штатный Multica использует Claude `bypassPermissions` и Codex `danger-full-access`. Его
  private ACL ограничивает вызов агента, но не запись файлов. Разрешения `.claude/settings.json`
  сокращены до обычных проверок и чтения Git; при bypass они не доказывают ограничения.
- Агент с записью в checkout или Git metadata может изменить gate, паспорт, evidence или state,
  запустить команды в обход него, солгать о результате, выбрать неверный baseline. CLI не
  наблюдает исполнение тестов и не доказывает смысл AC, происхождение разрешения, независимость
  личности проверяющего, отсутствие секретов или реальное ограничение процессов.
- Реальная OS/runtime canary и независимый reviewer нужны отдельно. Здесь нет scheduler,
  runtime wrapper, автоматического запуска команд, автопилота, таймаута lease или force-unlock.

## Ревизия, scope и пути

Все пути артефактов нормализованы, относительны корню checkout, без `..`, абсолютных путей и
symlink-компонентов. Паспорт — `docs/plans/SLUG.gate.json`, исходный план —
`docs/plans/SLUG.md`, отчёт — `docs/reports/SLUG-report.md` и его машинный sidecar
`docs/reports/SLUG-report.gate.json`. Evidence, вывод и очищенный trace находятся только в
`docs/reports/evidence/SLUG/`. CLI требует существующие непустые output/trace, сохраняет их
SHA-256 и повторно проверяет их. Это не проверка истинности их текста.

`baseline_commit` — полный SHA существующего предка HEAD. Коммитированный продуктовый diff
`baseline..HEAD`, staged/working diff и новые неигнорируемые файлы в `server/`, `web/`,
`packages/` обязаны целиком укладываться в scope. Удаления и переименования учитываются как
пути изменений. Игнорируемые файлы не считаются продуктовым diff: секреты `.env` не читаются.

`snapshot --scope PATH ...` возвращает полный HEAD и `dirty_fingerprint`: `clean` либо
`sha256:…` от staged/working diff и имён, режимов и SHA-256 новых файлов. Fingerprint относится
**к объявленному scope**, а не ко всем посторонним dirty-файлам checkout. В scope нужно включать
все проверяемые исходники/конфигурации; внепродуктовую полноту scope проверяет reviewer.
`docs/plans` и `docs/reports` исключаются из scope для устранения самоссылки: они проверяются
отдельно по привязке и хэшам. Baseline tree `clean` описывает выбранный commit; для исходного
dirty дерева указывается fingerprint, который `start` проверит при HEAD = baseline. Историческое
dirty дерево после смены HEAD восстановить этим CLI нельзя: такой первый `start` отклоняется.

Снимок снимается дважды; перед записью состояния повторно проверяется ревизия и evidence.
Изменение HEAD или scoped dirty fingerprint делает старое evidence непригодным, в том числе
при переходе на следующую стадию. Это обнаружение обычных гонок, а не транзакционная блокировка
Git или защита от враждебной записи между последней проверкой и действием. Внешняя сторона
должна обеспечить одного writer и удерживать дерево неподвижным во время проверки.

## Короткий docs-only/no-op run

Без активного паспорта Stop отказывает, даже при clean tree: без baseline он не может узнать,
менялся ли продукт в уже сделанных коммитах. Для работы только с документацией явно укажи
исходный SHA, выбранный до начала run:

```bash
python3 scripts/agent-loop/gate.py docs-only --baseline FULL_BASELINE_SHA
python3 scripts/agent-loop/gate.py stop
```

Это разрешает окончание docs-only run, только если продуктового diff нет. Это не фиктивная
продуктовая стадия и не acceptance. После смены HEAD attestation нужно повторить с исходным
baseline. `docs-only` не заменяет активную цепочку и отказывает при занятом slot.

## Паспорт и старт

Пример `docs/plans/demo.gate.json` (замени SHA реальным, критерий — критерием своей задачи;
это шаблон, не evidence):

```json
{
  "task": "T-demo",
  "multica_issue": "not_applicable",
  "goal": "Проверяемый результат поручения",
  "contract_sources": ["docs/development/artifact-contracts.md"],
  "baseline_commit": "FULL_BASELINE_SHA",
  "baseline_tree": "clean",
  "scope": ["server", "web", "packages"],
  "preserved_contract": "Не менять публичный API",
  "dependencies": [],
  "authorization": "Ссылка на прямое поручение владельца и его scope",
  "acceptance": { "AC-1": "Наблюдаемый результат проверки" },
  "unknowns": [],
  "plan": "docs/plans/demo.md",
  "report": "docs/reports/demo-report.gate.json",
  "stages": [
    { "name": "test", "checks": [{ "check_id": "unit", "criterion": "AC-1" }] },
    { "name": "review", "checks": [{ "check_id": "review", "criterion": "AC-1" }] }
  ]
}
```

```bash
python3 scripts/agent-loop/gate.py start docs/plans/demo.gate.json --stage test --actor tester --run local-1
python3 scripts/agent-loop/gate.py snapshot --scope server web packages
```

Actor/run/stage/check/event IDs используют ASCII буквы, цифры, `_`, `.`, `:`, `-` (до 128 знаков).
Паспорт и исходный человеческий план фиксируются хэшем при первом старте задачи. Их подмена
отклоняется. Все перечисленные стадии обязательны в указанном порядке; стадии, не нужные
задаче, не включаются. Завершённая стадия не переоткрывается автоматически. Если ревизия после
неё поменялась, handoff блокируется; восстановление требует решения контроллера с сохранением
истории, этот CLI не предоставляет команду сброса состояния или счёта.

## Evidence и парный отчёт

Запусти реальную проверку, сохрани значимый вывод и очищенный trace. Например, для проверки
самого gate (для такой задачи добавь `scripts/agent-loop` в scope):

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/agent-loop -p 'test_*.py' -v
```

Перенеси фактический exit, количество сценариев, время, команду и вывод в
`docs/reports/evidence/demo/unit-1.json`. `cwd` — канонический абсолютный путь (`pwd -P`),
HEAD/fingerprint — актуальный результат `snapshot` с тем же scope:

```json
{
  "task": "T-demo",
  "stage": "test",
  "run": "local-1",
  "actor": "tester",
  "criterion": "AC-1",
  "check_id": "unit",
  "baseline_commit": "FULL_BASELINE_SHA",
  "revision_commit": "FULL_CURRENT_SHA",
  "dirty_fingerprint": "clean",
  "cwd": "/absolute/canonical/checkout",
  "environment": "Фактические версии Python/Git/runner",
  "command": "Точная выполненная команда",
  "started_at": "2026-09-13T12:00:00+03:00",
  "exit_code": 0,
  "executed": 20,
  "result": "passed",
  "output": "docs/reports/evidence/demo/unit-1.txt",
  "trace_ref": "docs/reports/evidence/demo/unit-1-trace.txt",
  "limits": "Какие критерии эта команда не доказывает"
}
```

Число в примере не подставляется вместо реального результата. Минимальный CLI поддерживает
исполненные проверки с положительным `executed`. Невыполненные/неприменимые критерии отражаются
в человеческом отчёте, не продвигают стадию и не подменяются успешным fixture.

```bash
python3 scripts/agent-loop/gate.py record docs/reports/evidence/demo/unit-1.json --event unit-event-1
python3 scripts/agent-loop/gate.py status
```

Создай человеческий `docs/reports/demo-report.md` и машинный sidecar:

```json
{
  "task": "T-demo",
  "stage": "test",
  "actor": "tester",
  "run": "local-1",
  "baseline_commit": "FULL_BASELINE_SHA",
  "revision_commit": "FULL_CURRENT_SHA",
  "dirty_fingerprint": "clean",
  "plan": "docs/plans/demo.gate.json",
  "evidence": ["unit-event-1"],
  "native_outcome": "success",
  "stage_outcome": "completed",
  "task_acceptance": "not_checked"
}
```

`evidence` — точный текущий список event IDs из `status.slot.evidence`. Все обязательные checks
должны иметь текущий `passed`, exit `0`. Native outcome передаётся как отдельный факт; gate
не выводит из него stage/task acceptance. `finish` подтверждает лишь контракт, освобождает
slot, сохраняет хэши обоих отчётов и разрешает следующую объявленную стадию той же ревизии:

```bash
python3 scripts/agent-loop/gate.py finish docs/reports/demo-report.gate.json
python3 scripts/agent-loop/gate.py stop
python3 scripts/agent-loop/gate.py start docs/plans/demo.gate.json --stage review --actor reviewer --run local-2
```

Независимый reviewer сверяет источники, реальный diff и все AC. Значение `task_acceptance` CLI
принимает только `not_checked`: его успешный exit не подменяет вердикт reviewer. Для новой
стадии отчёт актуализируется, а исходные evidence/trace и история событий сохраняются.

## Неуспех, ownership и атомарность

State — `<git-common-dir>/agent-loop/state.json`, общий для всех worktree одного репозитория.
Операции сериализуются атомарным `mkdir lock`, запись JSON — temporary file + fsync + atomic
rename + fsync каталога. В lock записывается PID. CLI не ожидает освобождения занятого lock,
не считает неизвестного владельца умершим и не делает force-unlock после сбоя. Повреждённый
state отклоняется. На реальном checkout нужны права записи в shared Git metadata; sandbox
может потребовать отдельное разрешение. Read-only tester/reviewer передаёт evidence координатору
с разрешением записать state, не получает ради этого запись в `.git`. `snapshot` state не пишет;
даже `status`/`stop` берут lock для согласованного чтения.

Единственный slot закреплён за task/stage/actor/run/checkout. Lease не истекает автоматически.
Второй владелец, повтор run ID или повтор event ID получают отказ без изменения state. Чтобы
завершить неуспешный run без завершения стадии:

```bash
python3 scripts/agent-loop/gate.py release --actor tester --run local-1
```

`release` сохраняет историю и счёт, не принимает стадию. Новый run той же стадии использует
новый ID; `check_id` неизменен. `failed` и `blocked` увеличивают счёт этого task/stage/check,
обычный `passed` обнуляет только свой счёт. После второго неуспеха результат `record` содержит
`stopped: true`: запись evidence успешна, но ещё одна проверка и новый start стадии запрещены.
При таком ответе вызывающая сторона обязана остановиться; gate сам процессы не прерывает.

Ожидаемое воспроизведение TDD RED записывается как `result: passed`, `purpose: tdd_red`, с
реальным ненулевым `exit_code` и равным ему `expected_exit_code`. Оно не увеличивает **и не
сбрасывает** счёт реальных неуспехов, не удовлетворяет итоговый check стадии. Обычный `passed`
с ненулевым exit отклоняется. Смена run или lease не стирает остановку после двух неуспехов.
Отклонённые malformed/stale входы не считаются исполненными checks и не меняют счёт.

## Проверки реализации

Fixture suite запускает настоящий CLI в временных Git-репозиториях и отдельных процессах:
committed/dirty scope, повтор Stop, docs-only/no-op, stale revision/output, подмена путей,
неверный actor/run/stage/check, парные планы/отчёты, дубликаты, два неуспеха между run,
ожидаемый RED, независимость счётчиков, конкурентный slot, shared worktree state и corrupt lock.
Она не доказывает запуск Multica/модели, безопасность против намеренной записи, смысл AC или
продуктовые браузерные сценарии. Команда набора отдельно от `pnpm test`; подключение в CI —
следующий этап инфраструктуры.
