# Task 8 + Task 9 — единый независимый scoped review

**Spec compliance: NEEDS FIX. Code quality: NEEDS FIX.**

Проверена замороженная вторая часть вместе с закрытием первоначальных R1–R8. Это один review,
а не новая проверка всей ветки или live acceptance. Окончание runtime/native pilot не подтверждено.

## Проверенные входы

Первая часть: `task-8-adapters-fix1.diff`, SHA256
`2c259bccd9d5b1e8b0a029d3ad14ac19947bd51f330a37b4a78a0a6b3a3948ff`, прочитана один раз.
Вторая часть: `task-9-frozen-modules.json`; все девять файлов независимо совпали с указанными
SHA256 до начала следующей writer wave. Основные pins:

- collector: `f14947c736001b7e6b6d8722e4469bc5aa1988ddbd3051a0d7dfb5044bff4670`;
- runtime: `3f104d127949a68f57040be35916be4a14dd999b71918a7c33d81611dc69183c`;
- adapter: `476adea1c1de99977332d26030c9382d00b4b11ae91ab0a781c0ee2fbb6bfa55`.

Прочитаны interface, minimal execution brief, root rulings, implementation/install reports и
raw logs. Хэши трёх GREEN logs подтверждены: collector `1da513a2…84da` (7), runtime
`784123bc…f527` (29), adapter `75b94b41…7d19` (11). Все три лога заканчиваются OK;
47 — суммарное число этих тестов. Предыдущий fix1 raw log подтверждает отдельные 47 tests.
Отсутствовавшие первоначальные 44-test raw logs не восстановлены и не объявлены доказанными.

Trace project map/outlines/symbols использованы первыми. При смещённых source slices Trace
прочитаны только точные spans уже найденных символов. Вне нового scope рассмотрены лишь
existing gate artifact-equivalence/final-finish требования, необходимые для N1. Reviewer не
запускал tests, Docker, browser, native, API, model, auth/config операции; не менял source,
index или HEAD. После уведомления о новой writer wave source повторно не читался.

## Findings

### N1 — Разрешить штатную gate artifact binding перед final finish (P1)

Место: `scripts/agent-loop/native_collector.py:163`, `:386`.

`current()` требует точного равенства сегодняшнего `gate.snapshot` исходному `slot.input`,
включая HEAD. `transition()` вызывает этот helper до любого перехода, включая bind-artifacts.
Но existing gate требует, чтобы final evidence/archives уже были committed перед finish
(`gate.py:863`–`:871`), и поддерживает такой commit через собственную проверяемую
artifact-equivalence relation. После evidence commit collector отказывает до того, как gate
сможет связать собственные артефакты. Даже binding через прямой gate CLI не помогает последующему
collector finish: equality с исходным HEAD остаётся.

Сохранить строгую admission/collect freshness, а для явно разрешённых поздних переходов
использовать существующую authority gate для artifact-only ancestry и equivalent snapshots.
Не разрешать произвольный изменённый source и не добавлять state machine.
Минимальная regression: настоящий temporary Git/gate flow record → canonical report/archive →
own-evidence commit → collector bind-artifacts → final finish. Source-changing commit должен
отклоняться. Нынешний positive collector test заканчивается release и не проверяет finish.

### N2 — Закрыть произвольный файловый вход process observations в CLI collect (P2)

Место: `scripts/agent-loop/native_collector.py:439`–`:449`, `:283`–`:300`.

CLI принимает произвольные пути `--adapter-observation` и `--runtime-observation`. `read()`
проверяет private regular-file metadata, но не принадлежность уже заявленному trusted claim
и не идентичность файлу, который сохранил runtime outcome sink. `collect()` затем проверяет
переданные значения. JSON с подходящими полями и mode 0600, созданный внутри model-RW cache,
не отличается для этого CLI от trusted process observation. Это не обнаруженный обход OS
самим контейнером: host CLI вызывает controller. Дефект в том, что его advertised admission
не обеспечивает заявленный запрет принимать model-authored process proof.

In-process `run_adapter` получает настоящий callback и этой проблемы не имеет. Оставить этот
путь; standalone collect либо закрыть, либо разрешить лишь exact claimed runtime observation
и exact adapter observation, с проверяемой сохранённой идентичностью/хэшем. Минимальная
regression: matching-fields JSON за пределами trusted observation root отклоняется до
process receipt/check/record. Не требуется общий artifact framework или новая fault matrix.

## Закрытие исходных R1–R8

| Finding | Оценка текущей реализации |
| --- | --- |
| R1 actual Claude config path | ADDRESSED: finite-arity extraction actual path → prepared MCP policy; real synthetic D1/verifier/command regression сохранена. |
| R2 provider network | ADDRESSED: preparation задаёт provider-proxy, model command сохраняет разрешённую proxy topology. Реальный запуск остаётся отдельной canary. |
| R3 complete policy generation/pin | ADDRESSED: копируются guard/settings/proxy files, materializer дополняет generation; prepared tree проверяется до provider verifier (`native_adapter.py:240`), drift regression GREEN. |
| R4 trusted metadata вне RW mounts | ADDRESSED для перечисленных paths: claim/observation/registry/runtime/store/passport/deployment/collector config; collector registry дополнительно отделён от source/snapshot/policy/run. Manifest-in-cache regression GREEN. |
| R5 bounded registry/observation reads | ADDRESSED: enumeration limit 1024, metadata-first bounded candidate reads, malformed entries refuse; observation использует pinned bounded `_private_json`, а не unbounded reopen. |
| R6 no bootstrap/shared lock | ADDRESSED в production code: existing store/generations обязательны до Store constructor; whole-run five-second admission lock и fd cleanup сохранены. Adapter lifecycle с настоящей published Store generation отдельным тестом не подтверждён. |
| R7 source/code/gate authority | ADDRESSED для исходных launch checks: dependency pins, fixed cwd/source, passport, prepared HEAD, collector current slot/lease/actor/input через existing gate snapshot. Поздняя integration блокируется N1. |
| R8 static probes/environment | ADDRESSED: bare и fixed-profile help/version не читают config/claim; adapter читает только allowlisted IDs/managed-home bindings. Оpaque task token читается отдельно collector для fixed CLI, не передаётся model/D2. |

Fresh D2 внедрён в collector production path: verifier запускает pinned probe с текущим
`CODEX_HOME`, ограниченным environment и проверяет binary до/после; prepared d2_record для
collector отклоняется. Существующий Codex mapper integration test использует synthetic record;
новый fresh-probe test mock-ит subprocess и mapper. Он доказывает wiring/environment, но не
фактический запуск production D2; такая live/metadata проверка остаётся root-owned.

Root дополнительно передал проекцию сохранённого D0 (`task-5-d0-drain-issue-runs.json`,
row `01a09c2f`): `-p`, output/input-format, verbose, permission-mode, disallowedTools,
strict-mcp-config, model, mcp-config, argc 16; оба managed-home env отсутствовали. Этот набор
укладывается в текущий finite parser. Raw attribution-bearing запись reviewer не открывал;
расширение parser по общим возможностям CLI не требуется и finding по нему не выставляется.

## Что подтверждено и чего evidence не доказывает

Production wiring прослеживается: stable adapter → pinned collector → exact unique claim и
current gate → provider verification/generation → runtime outcome sink → process receipt →
fixed check → gate record. Active readback использует known issue, точный native task ID и
issue/agent/workspace equality. MULTICA_TOKEN передаётся только фиксированному CLI с явными
server/workspace и изолированным HOME; implicit owner fallback отсутствует. Later reconciliation
с explicit controller runner отделён от task-token authority и не ждёт собственного terminal
внутри wrapper. Model prose не становится check result.

Observer различает raw negative wait и ordinary 137; inspect/remove/absence выполняются по
своему name/CID, live/unknown state не становится quiescence proven. Provider cleanup и
post-run source/policy validation записываются отдельно. Fixed check исполняет реальный Node
через production runtime.check на synthetic Docker boundary, сохраняет count/output и
отклоняет skipped-only/truncated output. Не заявляется actual Docker observation из unit tests.

Collector tests используют настоящий gate и Node, но вызывают collector operations раздельно
и подставляют process/check boundary results; complete stable profile→collector.run_adapter→
production runtime→finish не был выполнен. Это объясняет N1 и требует именно одной meaningful
vertical regression, а не повторения всех прежних suites. Расширенная publication/recovery
матрица и whole-branch audit не требуются данным scope.

Live no-model observer, task-token readback, обе native provider invocations, context/MCP и
независимое содержательное принятие pilot остаются отдельными gates. Этот review не выдаёт
runtime receipt, не принимает native task и не меняет failure counters.
