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
В прежнем verification-only профиле изменение HEAD или scoped dirty fingerprint делает
старое evidence непригодным. Типизированный lifecycle ниже различает выход реализации,
контракт и явно доказанную публикацию; произвольное source изменение остаётся недопустимым. Prerequisites сверяются при start, record, finish и Stop,
включая сохранённые ревизии и хэши evidence/output/trace всех предыдущих обязательных стадий.
Обновление текущего парного отчёта следующей стадией допустимо: прежние proof-артефакты
и события сохраняются отдельно. Это обнаружение обычных гонок, а не транзакционная блокировка
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
baseline. `docs-only` не заменяет активную цепочку и отказывает, пока её product parent
зарезервирован, даже между стадиями при свободном slot.

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
истории. Для явно типизированного профиля используются return/recover ниже; reset-команды нет.

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
run/stage slot, сохраняет хэши обоих отчётов и разрешает следующую объявленную стадию той же
ревизии. Product parent остаётся зарезервирован до finish всех объявленных стадий. Только
последний finish освобождает parent; поле `parent_retained` явно отражает это в ответе:

```bash
python3 scripts/agent-loop/gate.py finish docs/reports/demo-report.gate.json
python3 scripts/agent-loop/gate.py stop
python3 scripts/agent-loop/gate.py start docs/plans/demo.gate.json --stage review --actor reviewer --run local-2
```

Независимый reviewer сверяет источники, реальный diff и все AC. Значение `task_acceptance` CLI
обычного finish принимает только `not_checked`: его успешный exit не подменяет вердикт reviewer.
Явный return принимает переданный вердикт `return` с уже записанными дефектами. Для новой
стадии отчёт актуализируется, а исходные evidence/trace и история событий сохраняются.

## Неуспех, ownership и атомарность

State — `<git-common-dir>/agent-loop/state.json`, общий для всех worktree одного репозитория.
Формат state — version 3: отдельные `parent` и run/stage `slot`, lifecycle history и relations.
Прежние форматы version 1/2 отклоняются без перезаписи или сброса failures: утраченные
архивы нельзя синтезировать. Автоматической миграции или reset-команды нет.
Операции сериализуются атомарным `mkdir lock`, запись JSON — temporary file + fsync + atomic
rename + fsync каталога. В lock записывается PID. CLI не ожидает освобождения занятого lock,
не считает неизвестного владельца умершим и не делает force-unlock после сбоя. Повреждённый
state отклоняется. На реальном checkout нужны права записи в shared Git metadata; sandbox
может потребовать отдельное разрешение. Read-only tester/reviewer передаёт evidence координатору
с разрешением записать state, не получает ради этого запись в `.git`. `snapshot` state не пишет;
даже `status`/`stop` берут lock для согласованного чтения.

Единственный product parent закреплён за task/passport/checkout и сохраняется между стадиями.
Внутри него slot закреплён за stage/actor/run. Lease не истекает автоматически.
Другая задача не получает parent ни после finish промежуточной стадии, ни после release
неуспешного run. Повтор run ID или повтор event ID также получает отказ без изменения state. Чтобы
завершить неуспешный run без завершения стадии:

```bash
python3 scripts/agent-loop/gate.py release --actor tester --run local-1
```

`release` освобождает только run/stage slot, сохраняет parent, историю и счёт, не принимает
стадию. Явный `start` с тем же паспортом/parent/checkout возобновляет незавершённую стадию
либо начинает следующую объявленную стадию. Новый run использует новый ID; `check_id`
неизменен. Прекращение parent до finish всех стадий отдельной командой не поддержано; удаление
state ради продолжения не является разрешённым flow. `failed` и `blocked` увеличивают счёт этого task/stage/check,
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

## Типизированный жизненный цикл

Новый профиль задаётся явными `kind`: ведущие `contract`, один `implementation`, затем
`verification`; после source verification допустимы пары `publication` → `verification`.
Порядок фиксируется паспортом. Пример полного порядка: plan → develop → test → review →
docs → docs-check → release → docs-finalize → completion-check. Все стадии обязательны;
release остаётся обычной verification с объявленными проверками реальной среды/артефакта,
health/migrations/rollback, а не выведенным из локального SHA успехом. Если релиз не нужен,
не включай его и второй metadata-проход. Имена сами по себе не дают разрешений.

Contract проверяет уже подготовленный замороженный техплан. Implementation владеет source
записью в scope и сохраняет input/output. Verification закреплена за текущим выходом;
record/finish/Stop повторно сверяют все prerequisite hashes. Source mutation во время неё
отклоняется, даже если текущая проверка предоставила новый passed. Отсутствие kind сохраняет
прежний verification-only профиль; без implementation return недоступен.

Состояние lifecycle содержит iteration, append-only history, current_stages,
verification_target и relations. Счёт остаётся `tasks[T].checks[STAGE][CHECK].failures`.
Новая итерация или актор не создаёт новую проверку. До finish/return координатор готовит
точные копии канонической пары:

```text
docs/reports/evidence/SLUG/stages/STAGE/RUN-report.md
docs/reports/evidence/SLUG/stages/STAGE/RUN-report.gate.json
```

Каждый архив и все старые proof/output/trace повторно проверяются по SHA-256. Каноническая
пара может стать отчётом следующей стадии, история остаётся читаемой. Перед последним
finish все зарегистрированные proof, архивы и последняя пара должны быть закоммичены;
до этого другой parent не получает очередь. Stage archive не создаётся скрыто после finish.

### Первый возврат

В source verification объяви `return_to: develop`. Пока неуспешный reviewer/tester ещё владеет
slot, запиши реальный failed/blocked под прежним check_id, подготовь парный report и архив
со `stage_outcome: returned`, `task_acceptance: return`, отдельным native_outcome. Сохрани
ту же JSON-копию в собственном evidence-каталоге; она дополнительно содержит:

```json
{
  "iteration": 0,
  "return_to": "develop",
  "failed_events": ["recorded-defect-event"],
  "defects": [{ "criterion": "AC-1", "location": "server/file.ts", "detail": "Наблюдаемый дефект" }],
  "repair_direction": "Разрешённое исправление в scope",
  "preserved_contract": "Точное значение из паспорта",
  "failure_counts": { "review": 1 }
}
```

Это дополнительные поля к обычному отчёту, не самостоятельный полный sidecar.

```bash
python3 scripts/agent-loop/gate.py return docs/reports/evidence/SLUG/return-RUN.json --event RETURN_EVENT --actor REVIEWER --run REVIEW_RUN
```

Gate сверяет фактический записанный дефект этого actor/run/stage, объявленный target и
текущие counters. Он освобождает slot, сохраняет parent и историю, увеличивает iteration,
оставляет эффективными только contract stages. Новый develop затем публикует новый выход,
все downstream source checks выполняются заново. При любом остановленном check return
отказывает. Release сохраняет свой смысл окончания run без завершения стадии; return
после release не выполняется. Нет reset, смены scope/AC или скрытого scheduler.

### Commit собственных артефактов

После фактической проверки и подготовки её отчёта/архивов commit только собственные gate
артефакты, затем явно свяжи ревизии до finish:

```bash
python3 scripts/agent-loop/gate.py bind-artifacts docs/plans/SLUG.gate.json --event BIND_EVENT --actor ACTOR --run RUN
```

Gate берёт from из собственного anchor, доказывает ancestry, точный diff только canonical
plan/passport/report и `docs/reports/evidence/SLUG/`, равный scoped dirty fingerprint и
неизменность frozen contract/старых hashes. Source/config/tests, другие docs, перенос пути
через границу, symlink и изменённый dirty input отклоняются. История хранит полные from/to
SHA, paths, contract hash, actor/run и references к proof. Исходные SHA в evidence остаются
реальными: binding не заявляет исполнение команды на будущем commit.

Binding разрешён только owning actor/run активного slot либо последнему owning run того же
зарезервированного parent между стадиями. После final finish он недоступен. После return
binding сохраняет артефакты, но не возвращает superseded source verification. Commit ранее
dirty source после тестов не является artifact binding; источник надо зафиксировать в
implementation до verification.

### Metadata publication и независимая приёмка

До первого start задай `publication_paths`: уникальные точные Markdown-пути внутри scope,
например `docs/backlog/tasks/T-NNN.md`. Каталоги, wildcard, gate plan/report и source/config
не подходят. Наличие смешанного документа в списке не разрешает менять его правила.
Substantive source/contract изменения готовятся до source review. В publication разрешены
только frozen metadata paths и собственные gate artifacts; committed/staged/working/untracked
изменения вне write-set и защищённый source drift отклоняются. Metadata нужно commit до
записи evidence. Gate сохраняет publication relation отдельно от строгого artifact equivalence:
source input S, metadata output D, protected dirty fingerprint, diff hash, old/new Git blobs.

Следующая verification выполняется другим actor/run и передаёт в evidence дополнительное
`publication_review`: `relation` равную `status.tasks[T].pending_publication`,
`verdict: supported_metadata`, `preserved_contract: true`. Это независимая содержательная
приёмка фактов/статусов/ссылок по точному diff, не результат formatter. Отсутствующий или
иной verdict отклоняется. Истинность утверждений проверяет reviewer; CLI не понимает смысл
Markdown и не доказывает независимость личности по строке actor.

До release keeper пишет подтверждённое source accepted/release pending. Только после
успешного обязательного release он делает docs-finalize и completion-check под тем же
parent. Старое source evidence остаётся на S; source acceptance и docs acceptance хранятся
раздельно. Правки completed до последнего gate — предложение закрытия. Иная maintenance
задача не закрывает пропущенные обязательства исходной задачи.

### Recover после доказанного устранения причины

Обычные start/return/record блокируются при failures ≥ 2. Для recover неуспешное evidence
должно сохранять `cause: {name, condition, observation}`: именованную причину, наблюдаемое
условие продолжения и путь непустого наблюдения внутри evidence-каталога. Gate сохраняет
его bytes hash вместе со stop_event. После окончания прежнего процесса/slot контроллер
готовит `recovery-EVENT.json`:

```json
{
  "task": "T-NNN", "stage": "review", "check_id": "review",
  "stop_event": "CURRENT_STOP", "old_run": "STOPPED_RUN",
  "actor": "controller", "run": "NEW_RUN", "failures": 2,
  "baseline_commit": "FULL_BASELINE_SHA", "revision_commit": "ACTUAL_HEAD",
  "dirty_fingerprint": "clean", "cause": "Наблюдавшаяся причина",
  "condition": "Ранее объявленное условие",
  "remediation": "docs/reports/evidence/SLUG/new-conditions.txt",
  "confirmer": "independent-operator", "condition_removed": true,
  "old_run_stopped": true, "no_live_duplicate": true,
  "q_resolved": true, "conflict_free": true, "next_operation": "review"
}
```

```bash
python3 scripts/agent-loop/gate.py recover docs/reports/evidence/SLUG/recovery-EVENT.json --event EVENT --actor controller --run NEW_RUN
```

Gate требует текущий stop того же task/stage/check, прежний счёт, свежий source/prerequisites,
новые непустые conditions bytes, отдельного confirmer и все явные подтверждения условий.
Он атомарно приобретает именно остановленную стадию, сохраняя failures=2. Первый фактический
результат этого check потребляет recovery: pass сбрасывает только свой счёт, failed/blocked
увеличивает его до трёх и немедленно снова останавливает. RED/not_run/unknown не дают второй
попытки; прежние native outcomes сохраняются. Повтор event/run, stale proof, использованный
или опровергнутый remedy не возобновляются. Новая строка actor или косметический commit
с прежним remedy не являются новыми условиями. Семантическая проверка изменений условий и
отсутствия живого процесса — ответственность контроллера/runtime, а не обещание CLI.

Source repair вне предусмотренной реализации не оживляет старые test/review prerequisites.
Поэтому некоторые остановы требуют отдельно авторизованного remediation workflow; этот
профиль не обещает автоматически исправить любую причину. Текущий Task 3 typecheck остаётся
остановленным после двух неуспехов, его третий запуск этим lifecycle не разрешён.
