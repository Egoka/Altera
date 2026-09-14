# Доступ Multica к инфраструктуре

Конфигурация для native runtime на Mac владельца; не инструкция запуска очереди из прямого чата.
Порядок выпуска и recovery остаётся в [infrastructure-checks](infrastructure-checks.md).
IDs среды и исторические инциденты — в [runbook](../development/render-neon.md).

## Откуда берётся доступ

Профиль агента, workspace MCP assignments и локальная авторизация клиента — разные слои.
`agent get.mcp_config = null` не означает отсутствие MCP: отдельно читать `agent mcp list`.
На этом Mac агентам назначен `context7`; daemon формирует managed MCP config, а Codex получает
отдельный `codex-home`. Поэтому desktop tools и обычный `codex mcp list` не доказывают доступ Multica.

- Codex: [render-codex.mcp.json](render-codex.mcp.json), имя `render`, OAuth client ID `codex`.
  Штатная первоначальная авторизация: `codex mcp add render --url https://mcp.render.com/mcp --oauth-client-id codex`.
  Вариант без client ID Render отклонял; не повторять dynamic registration.
- Claude: [render-claude.mcp.json](render-claude.mcp.json), имя `plugin:render:render`, client ID `claude`.
  Это идентичность уже авторизованного официального Render plugin. Простое переименование в `render`
  создало отдельное `needs-auth` подключение в реальной проверке. Токены между именами не копировать.
- JSON содержит только публичные параметры подключения. Авторизацию хранит native клиент вне Git.
  Проверять её на фактическом host/OS user; другой host или утраченный OAuth требует своего входа.
- Релиз-инженер и тестировщик (Codex) получают `enabled_tools` из JSON: 10 чтений.
  Оркестратор и reviewer (Claude) получают alias config и дополнительный `--disallowedTools`
  из [render-claude-denied-tools.json](render-claude-denied-tools.json): в проверенном inventory
  остаются 11 чтений. `AskUserQuestion` сохранён из ограничения native daemon.
  Прежние custom_args остаются началом массива; новые ограничения добавляются в конец.
- Это фильтр инструментов клиента, не сужение прав Render account. Claude использует denylist
  текущего inventory: после изменения состава MCP до работы сверить инструменты и закрыть новые
  недиагностические tools. Codex allowlist не открывает новые tools автоматически.
  Deploy/restart, env update, создание сервисов, изменение тарифа, миграции и записи в данные
  не служат проверкой подключения. Остальные роли используют handoff релиз-инженеру;
  подключение всем десяти профилям не применялось.

Перед live edit: fresh `agent get`, `agent mcp list`, `agent tasks`; менять только idle без
активного/queued run. Сохранить прежние поля в памяти, объединить `mcpServers`, оставить
workspace assignments, custom_args, model, права, custom_env и concurrency. При redacted config
не заменять его догадкой. Передавать через `--mcp-config-stdin`, не командную строку.
Readback сравнивает изменённые поля, хэши прежних инструкций и неизменность остальных параметров.
Перед probe проверить имена authentication-related env overrides без вывода значений; отдельный
HOME/CODEX_HOME/CLAUDE_CONFIG_DIR требует своего теста, а не вывода об общей авторизации.
В Git сохраняются только публичный config, хэши и итоги; полные backups профилей/секретов запрещены.

Для проверки runtime нужны: реальные `tools/list` и минимум `list_workspaces` + чтение известного
deploy/service под итоговым config. У Codex проверять новый отдельный `CODEX_HOME`, у Claude —
managed `--mcp-config`/`--strict-mcp-config`, а не только установленный plugin.
`Connected`, инструкция или LLM-ответ без успешного tool result недостаточны.
Диагностический процесс может отключить Stop hook только в собственной временной settings-копии,
чтобы не создавать паспорт и не подхватывать чужую задачу. Рабочий plugin/gate не меняется.
Проба native бинарника с параметрами профиля и server-issued Multica run — разные уровни evidence;
в отчёте указывать, какой действительно проверен.

На проверенном daemon Codex запускается абсолютным путём
`/Applications/ChatGPT.app/Contents/Resources/codex`, Claude —
`/Users/egorbondarenko/.nvm/versions/node/v24.12.0/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`.
В custom_env этих четырёх профилей обнаружен только `PATH`: `gh` и `neon` разрешаются,
`codex` по PATH не найден. Поэтому проверка голой команды `codex` не воспроизводит запуск daemon.
При смене версии/host перечитать путь native binary и проверить его, не править PATH всех профилей.

Датированный результат настройки — [отчёт и очищенные снимки](snapshots/2026-09-15-infrastructure-access/README.md).
Поздняя проверка 2026-09-14 23:11 UTC показала у Codex `oAuth` и 10 tools, но фактический
`list_workspaces` вернул `unauthorized`; Claude в ту же минуту выполнил два чтения успешно.
Inventory не подтверждает валидность токена. Восстановление требует штатного OAuth native клиента
и повторного реального чтения; токены из Claude или другого CODEX_HOME не переносить.

## Проверенные Render инструменты

Имена и параметры ниже получены из MCP 2026-09-15; перед применением перечитать schema runtime.
Для всех чтений после списка workspace явно передавать `workspaceId=tea-d0q29c7diees738n0250`.
Владелец разрешил этот workspace; deprecated `select_workspace` для автоматического выбора не нужен.

| Цель                    | Инструмент и вход                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Доступ и среда          | `list_workspaces`, `list_services`, `get_service(serviceId)`                                                                                       |
| История и точный deploy | `list_deploys(serviceId, limit=5..20, cursor)`, `get_deploy(serviceId, deployId)`                                                                  |
| Build/start/runtime     | `list_log_label_values(resource=[serviceId], label="type")`, `list_logs(resource=[serviceId], startTime, endTime, limit, type, instance)`          |
| CPU/память/HTTP         | `get_metrics(resourceId, metricTypes, startTime, endTime, resolution=300)`                                                                         |
| Key Value               | `list_key_value`, `get_key_value(keyValueId)`, `get_metrics(resourceId=keyValueId, metricTypes=["cpu_usage","memory_usage","active_connections"])` |

Метрики поддерживают `cpu_usage`, `cpu_limit`, `cpu_target`, `memory_usage`, `memory_limit`,
`memory_target`, `instance_count`, `http_request_count`, `http_latency`, `bandwidth_usage`,
`active_connections`. Применимость зависит от ресурса/тарифа. Пустой массив — `no_data`, а не ноль
и не доказательство отказа. HTTP latency требует соответствующих прав/тарифа; тариф ради проверки
не менять. Для HTTP count можно выбрать `aggregateHttpRequestCountsBy="statusCode"`.

У `list_logs` нет `deployId`: ограничить окно timestamps deploy и затем instance; подтвердить
checkout SHA строкой лога. В реальном deploy build-сообщения были помечены `type=app`, поэтому
пустой `type=build` не доказывает отсутствие сборки. Читать ограниченные страницы с `hasMore`,
сохранять границы окна и признак неполного чтения. Перед включением в evidence очищать секреты,
connection URI и пользовательские данные. Отсутствие ошибок в выборке не доказывает весь период.

У проверенного Render MCP нет инструмента HTTP fetch, Redis PING или SQL для Neon.
`query_render_postgres` относится только к Render Postgres. Key Value `available` и connection
count не заменяют PING из Server. Не открывать внешний Redis-доступ ради локальной пробы.

## Neon и HTTP

Native `neon` CLI авторизован на этом Mac. Доступные безопасные чтения:

```bash
neon branches get br-ancient-mode-adgmr3w1 --project-id purple-salad-06550104 --output json --no-analytics
neon api /projects/purple-salad-06550104/endpoints/ep-dry-boat-ad0thetj --output json --no-analytics
```

Проверять точную пару project/branch/endpoint, host, state и timestamp. State `idle`/suspended
сам по себе не ошибка подключения. Эти metadata не подтверждают SQL authentication из Server.
`__typename` тоже не проверяет DB/Redis. Для проверки подключения нужен разрешённый bounded
`SELECT 1`/`PING` из целевого runtime; при отсутствии пути писать `not_run` с конкретным остатком.
Не вызывать connection-string, env pull, миграции, seed, branch switch или start endpoint ради диагностики.
Development остаётся рабочей БД; production/default не подставлять автоматически.

У Claude обнаружены Neon MCP `get_branch`, `get_postgres_endpoint`, `list_branches`,
`list_postgres_endpoints`. Это инвентаризация инструментов, не подтверждение SQL-доступа или
наличия Neon MCP в каждом managed профиле. CLI остаётся явно проверенным способом чтения metadata.

HTTP probe: POST `https://altera-m4po.onrender.com/`, JSON
`{"query":"query InfrastructureProbe { __typename }"}`, Content-Type `application/json`.
Конечный суммарный бюджет 90 секунд, максимум две попытки с учётом cold start; проверять 2xx,
JSON, `data.__typename=Query`, отсутствие `errors`. TLS error, HTML, timeout и 5xx записываются
отдельно. Перед и после probe перечитать deploy: изменение live SHA делает привязку health
неопределённой. API пока не возвращает commit identity, поэтому HTTP+Render chronology —
косвенная корреляция, не доказательство SHA в самом HTTP-ответе.

## Диагноз и handoff

`blocked_access` фиксирует runtime/agent, tool, service/branch, безопасный error code,
последний успешный этап и одно необходимое действие: например OAuth для конкретного native
клиента/имени сервера. Не просить владельца вручную поставить Done. При восстановлении доступа
повторить ограниченное чтение, продолжить прежний incident и счётчик recovery.
Успешный локальный probe не размораживает старую задачу и не доказывает её task acceptance.

Официальные источники: [Render MCP](https://render.com/docs/mcp-server),
[Codex MCP](https://developers.openai.com/codex/mcp/),
[Multica agent configuration](https://multica.ai/docs/agents-create).
