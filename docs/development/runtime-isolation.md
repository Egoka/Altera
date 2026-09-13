# Изоляция проверяющих Codex и Claude

Task 5 добавляет отдельный trusted launcher [runtime.py](../../scripts/agent-runtime/runtime.py).
Он запускает AI CLI, shell и локальные MCP внутри Docker. Внешние профили, агенты и ресурс
`in_place` этим кодом не меняются. Наличие launcher не означает, что существующий native run
уже использует его. Проверки привязаны к source SHA, dirty fingerprint, policy и immutable image ID.

## Проверенная и непроверенная части

На 2026-09-13 выполнены реальные Docker проверки: 18 разрешённых мутаций в writable control
(ожидаемый exit 41), 18 OS-denials в RO варианте (exit 0), запись evidence, точные stdin/stdout
и отдельный stderr, exit 42 и пересылка SIGTERM с exit 143. Это проверки synthetic executable.
Реальный Linux Codex app-server отдельно завершил canary с `gpt-5.6-terra`, medium и default
service tier: trace project map/outline, отказ shell-записи `Read-only file system`, новый evidence.
В trace сохранён также один отклонённый вызов outline с неверным аргументом и его исправление.
Реальный trace MCP 3.25.0 отдельно индексировал fixture и выполнил оба stdio-вызова.

Первоначальный Linux Claude login gap закрыт отдельной авторизацией владельца:
[fresh-container auth proof](../reports/evidence/2026-09-13-autonomy/claude-persistent-auth/auth-status-proof.json)
подтверждает `loggedIn: true`, `authMethod: claude.ai`, а
[standalone model proof](../reports/evidence/2026-09-13-autonomy/claude-persistent-auth/model-auth-proof.json)
— успешный `claude-opus-4-6`, medium и marker при отключённых tools. macOS Keychain не
экспортировался. Это не native приёмка: context/MCP, фактическое отключение hooks, refresh
и managed stream-json canary остаются непроверенными. D0 также не устанавливает эти факты.
D1 metadata diagnostic установил reviewer roster: Context7 HTTP `/mcp` без headers/env и
trace с argv `["serve"]` без env. Это descriptor evidence; native production mapping пока не реализован.
Готовность всей Task 5, M4/M7 и автопилотов этим документом не объявляется.

## Источник и mounts

Trusted coordinator вызывает `snapshot(source, target, dirty_paths)` из launcher. Это независимый
`git clone --no-local --no-hardlinks`, checkout полного HEAD, binary dirty diff и только явно
перечисленные новые неигнорируемые файлы. Их список обязан совпадать с фактическим untracked
набором: пропустить новый исходник нельзя. Hooks и пользовательский/global Git config не
загружаются. Для каждого untracked input fingerprint содержит SHA-256 bytes/link text,
kind (`file`/`symlink`) и нормализованный Git mode (`100644`/`100755`/`120000`). Для regular
file учитывается owner execute bit; остальные permission bits не входят в Git mode. Замена
file на symlink с тем же digest и изменение executable bit отклоняются и в source, и в snapshot.
Source fingerprint проверяется до и после копирования и сравнивается со snapshot. Старые
manifest с untracked digest без kind/mode нужно пересоздать: они не проходят сравнение.
Ignored `.env` не копируется; пути к ним нельзя добавить как новые inputs. Это не аудит
секретов в ранее закоммиченном содержимом и Git history. Внешние/абсолютные symlinks отклоняются.

Snapshot содержит собственный `.git`, без shared objects/alternates и remote origin. Он
монтируется RO по исходному абсолютному cwd. Original checkout и original/common Git directory
не монтируются. RO policy — отдельный каталог. Три непересекающихся RW mounts принадлежат
только текущему run: `/runtime/evidence`, `/runtime/cache`, `/runtime/tmp`. Новые тесты
тестировщика можно писать в evidence staging; принятые исходные тесты остаются RO.
Native completion не переносит эти файлы в продукт автоматически. Evidence directory должна
быть пустой перед запуском; повторное использование принятого evidence отклоняется.

Контейнер использует read-only rootfs, nonroot UID/GID текущего пользователя, `cap-drop=ALL`,
`no-new-privileges`, ограничение процессов/памяти/CPU. Source/policy/run roots должны быть
каноническими и не пересекаться. Docker socket, host HOME, host shell/RPC bridge и cooperative
state не доступны. `MULTICA_TOKEN` и прочие host environment values не наследуются моделью.
Интеграционные IDs связывает trusted coordinator; модель получает задание через stdin.

## Manifest и protocol

[manifest.example.json](../../scripts/agent-runtime/manifest.example.json) — намеренно
неисполняемый шаблон. Coordinator заполняет полный source state, policy hash, конкретный image ID
и абсолютные пути; `managed_mapping_verified: false` остаётся до реального доказательства mapping.
`path_map` содержит только проверенные входные MCP paths → существующие RO policy files.
Неизвестные argv, inline MCP JSON, settings override и managed HOME отвергаются. Содержимое
credentials не читается launcher и не входит в manifest/hash/log.

```bash
/usr/bin/python3 -I scripts/agent-runtime/runtime.py /absolute/controller/manifest.json app-server
/usr/bin/python3 -I scripts/agent-runtime/runtime.py /absolute/controller/manifest.json -p --input-format stream-json --output-format stream-json --model claude-opus-4-6 --mcp-config /actual/managed/mcp.json
```

Для Codex поддерживается app-server и узкие overrides исходной модели/medium; launcher
явно задаёт их даже при отсутствии native flags. Разрешена одна необязательная native пара
`--listen stdio://`, которая передаётся без изменений; equals-форма, другой transport, duplicates и неизвестные
argv отвергаются. Для Claude
сохраняются известные stream-json flags, модель, effort и disallowedTools; неизвестные флаги
не пропускаются вслепую. `[mcp_servers.trace]` в RO `codex-config.toml` запускает Linux
`/usr/local/bin/trace-mcp serve --preset review`. Его проверенный index находится в отдельном
`HOME/.trace/index` внутри cache. Для Claude JSON разрешены только имена `trace` и `context7`:
trace — stdio с `/usr/local/bin/trace-mcp` и точными argv `["serve"]` либо ранее поддержанными
`["serve", "--preset", "review"]`; Context7 — ровно `{"type":"http","url":"https://mcp.context7.com/mcp"}`.
Policy bytes не переписываются. Unknown names/fields, headers/env даже пустые, duplicate JSON keys,
malformed JSON и варианты URL отклоняются. Пустой `mcpServers` сохранён для существующих fixtures,
но не доказывает наличие полного roster. Native adapter и tester Playwright требуют отдельной приёмки.

`protocol-guard.mjs` работает внутри границы и проверяет каждый JSONL input: вложенный `cwd`
может указывать только на declared source или его подкаталог без `..`. Валидные bytes
передаются без переформатирования; malformed/oversized input заканчивается exit 78. Stdout
CLI и stderr остаются раздельными, сигналы передаются дочернему процессу. Изменение модели,
reasoning или default service tier через RPC также отвергается. В pinned schema
`serviceTierForTurn` принимает только omitted/null (наследует закреплённый tier) либо `"default"`
(standard speed); `fast`, `flex` и неизвестные значения запрещены. `serviceTier: "default"`
разрешён только в прямом `params` Codex RPC `thread/start`, `thread/resume`, `turn/start`.
В другом RPC, вложенном объекте/config или массиве это исключение не действует; остальные
ненулевые tiers не исправляются и отвергаются. `service_tier` по-прежнему допускает только
null/omitted. Thread `config` ограничен `model`, `model_reasoning_effort`,
`service_tier` с исходными значениями; произвольные nested/dotted profiles и provider overrides
не принимаются. `config/value/write`, `config/batchWrite` и `externalAgentConfig/import`
отвергаются целиком: checker не меняет defaults через keyPath/value, batch или файлы импорта.
Отключение prompt
ограничений внутри CLI не отменяет Docker mounts. Diagnostic flag `fixture: true` выбирает
явный coordinator-owned `/runtime/policy/fixture.mjs` вместо CLI; сам по себе он не означает
ни запуск модели, ни fake-успех. Тип конкретного опыта и фактический executable фиксирует отчёт.
Совместимость argv/RPC не доказывает native приёмку: обнаружение per-task CODEX_HOME,
проверка и materialization managed TOML, перенос фактического AGENTS.md context и native canary
остаются отдельными blockers. Guard поставляется в hashed RO policy; перед будущей canary
нужен её новый capture/hash, без пересборки неизменённого image.

## Сеть и авторизация

`network: none` не даёт сети. `provider-proxy` создаёт новую сеть с `--internal` и
`com.docker.network.bridge.gateway_mode_ipv4=isolated`: у bridge нет адреса host.
Обычный internal bridge сохраняет доступ к host services; различие описано в
[официальной документации Docker](https://docs.docker.com/engine/network/port-publishing/#gateway-modes).
Модель подключена только к isolated сети. Отдельный proxy имеет исходящий bridge, но не
получает checkout, credentials, cache или Docker socket. Он поддерживает только HTTPS CONNECT
на точные provider domains: OpenAI/ChatGPT, Anthropic/Claude и `mcp.context7.com`; HTTP endpoints и прочие домены
отклоняются. Все DNS answers должны быть публичными IPv4, connect использует уже проверенный IP.
У proxy нет опубликованных host ports. Его image/policy hash, network и container inspect сохраняются
в trusted run root. Сеть и proxy удаляются после процесса; daemon не перезапускается.

Реальная TLS проверка получила HTTP 421 от OpenAI `/` и 404 от Anthropic `/`, без credentials
и model call. Пять запрещённых CONNECT получили 403; direct public и host endpoints были
недоступны. Эти ответы подтверждают транспорт, не авторизацию модели. Proxy не расшифровывает
TLS и не является HTTP authorization firewall для разрешённых сервисов.

[reviewer MCP canary](../../scripts/agent-runtime/test_mcp_canary.py) запускается с
`--canary /absolute/new/evidence-directory`: он создаёт synthetic Git snapshot и RO policy,
использует закреплённый image и этот proxy, без auth mount и model CLI. Context7 получает только
public React query через initialize → tools/list → resolve-library-id; trace запускается с `["serve"]`
и проверяется через index, get_project_map и get_outline. HTTP redirects запрещены клиентом;
opaque MCP session header остаётся только в памяти. Bounded protocol evidence, шесть forbidden
CONNECT statuses и before/after source/snapshot/policy hashes сохраняются отдельно. Этот опыт
проверяет MCP transport/tools; он не подтверждает native model/context/hooks/refresh или collector.

`auth_file` разрешает ровно один существующий regular file, RO в выделенный runtime home:
Codex `auth.json` или Claude `.credentials.json`. Весь HOME не монтируется. UID совпадает с
владельцем host-процесса, поэтому permissions credential file не расширяются. Codex ChatGPT
login действительно работает с таким mount. Обновление credentials выполняется trusted
подготовкой вне checker; RO файл нельзя сделать RW ради refresh.

Для первого Linux Claude login coordinator создаёт отдельный manifest с
`operation: claude-login`, `family: claude`, `network: provider-proxy`, без auth_file и без
дополнительных argv. Launcher запускает только `claude auth login`; владелец проходит штатную
авторизацию своей подписки в интерактивном терминале. Не перенаправлять auth flow в общий log.
Новый `.credentials.json` остаётся в dedicated cache и затем используется как один RO файл
нового checker run. Покупка API, подмена модели и экспорт Keychain не являются fallback.

## Claude hooks и внешняя приёмка

RO policy содержит strict JSON `claude-settings.json` ровно `{"disableAllHooks": true}`.
Launcher добавляет один конечный `--settings` и один `--strict-mcp-config`; конфликтующий
settings input отвергается. Это one-run отключение hooks вне managed policy по
[официальному контракту Claude](https://code.claude.com/docs/en/hooks#disable-or-remove-hooks).
Project `.claude/settings.json` и CLAUDE.md сохраняются в source snapshot. Managed policy
hooks этот knob не отключает: при их наличии данный вариант требует отдельной проверки.
Фактический hook/context behavior пока требует авторизованного Claude canary; argv fixture
не заменяет его. Wrapper не утверждает, что repo Stop hook успешно отработал.

Trusted coordinator заранее резервирует parent/run/stage в original checkout:

```bash
python3 scripts/agent-loop/gate.py start docs/plans/SLUG.gate.json --stage STAGE --actor ACTOR --run RUN
```

После native completion collector сохраняет actual exit/stdout/stderr, проверяет schema,
actor/run, SHA и dirty fingerprint, хэши source/policy и новые артефакты. Он переносит только
разрешённые evidence paths; контейнер не выбирает путь в trusted state. Затем coordinator
выполняет `record .../CHECK.json --event EVENT`, создаёт парный report и неизменяемые stage
archives. Перед final finish коммитит только собственные gate artifacts и вызывает
`bind-artifacts docs/plans/SLUG.gate.json --event BIND_EVENT --actor ACTOR --run RUN`, после чего
`finish docs/reports/SLUG-report.gate.json`. Полный контракт — в
[agent-loop-gate.md](agent-loop-gate.md). Исходный проверенный SHA не переписывается;
`task_acceptance` остаётся `not_checked` до независимой содержательной приёмки.
Missing/stale evidence и сбой collector/record/finish оставляют стадию непринятой. Два
последовательных реальных неуспеха одного check останавливают его; другой run не обнуляет счёт.

## Проверки и D0

Сборка image: `docker build -t altera-agent-runtime:task5 scripts/agent-runtime`; затем записать
`docker image inspect --format '{{.Id}}' altera-agent-runtime:task5` и использовать только этот ID.
Dockerfile фиксирует Node 24.12.0, Codex 0.154.0-alpha.6.2, Claude 2.1.263 и trace 3.25.0.
Обновление любой версии требует новой приёмки; переносимый runtime не выводится из host login.
`protocol-guard.mjs` монтируется RO из policy и не входит в Docker build context. Его изменение
требует нового trusted policy hash и runtime-source/canary evidence; прежний immutable image ID
сохраняется, если содержимое image не меняется. Старое evidence не подтверждает новую policy.

Unit: `python3 -I scripts/agent-runtime/test_runtime.py`, `node --test scripts/agent-runtime/test_proxy.mjs scripts/agent-runtime/test_protocol_guard.mjs`.
Docker: `python3 -I scripts/agent-runtime/test_docker.py IMAGE_ID NEW_EVIDENCE_DIR`; каждый
запуск получает новый evidence directory. Egress: `test_egress.py TEMPLATE_MANIFEST NEW_DIR`.
`cli-preflight.mjs`, `trace-canary.mjs` и `codex-canary.mjs` — явные отдельные диагностические
программы; последняя действительно вызывает модель и требует существующей авторизации.

D0 — отдельный [metadata-probe.c](../../scripts/agent-runtime/metadata-probe.c), без stdin,
file-open/network/spawn APIs. `build_metadata_probe.py OUTPUT` встраивает source SHA; binary SHA
фиксируется снаружи, чтобы D0 не читал собственный файл. `--help/--version` честно называют probe;
остальные inputs дают очищенный bounded stderr manifest и exit 78. Env values, prompt/JSON/
неизвестные flags не печатаются. Это не Claude stream-json completion и не runtime acceptance.
Тест: `python3 -I scripts/agent-runtime/test_metadata_probe.py BINARY`. Native registration,
quiescence, временная binding, drain/recovery выполняются только внешним coordinator по design.

D2 — отдельный [codex-path-probe.c](../../scripts/agent-runtime/codex-path-probe.c): только один
`getenv("CODEX_HOME")` и bounded `getcwd`, без чтения config/auth, stdin, child или network.
Он выдаёт lexical candidate только для закреплённого `ROOT/alte-N-SUFFIX/codex-home` и boolean
совпадения cwd; source/build SHA входят в одну stderr-строку ≤1800 bytes, diagnostic exit78.
`--help/--version` статичны и честно называют probe. UID — только build provenance;
`canonical_identity` и `task_acceptance` всегда `not_checked`. Существование, symlinks, owner/mode
и актуальность native path проверяет отдельный trusted coordinator; D2 этих свойств не доказывает.
