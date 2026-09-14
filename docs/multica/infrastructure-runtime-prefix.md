<!-- altera-infrastructure-access:v1 -->

ИНФРАСТРУКТУРА MULTICA — уточнение владельца 2026-09-15; имеет приоритет над устаревшими срезами ниже.

Это профиль Multica. Runtime entry: docs/multica/runtime-entry.md. Прямой чат владельца не запускает
очередь/паспорт/Stop. Читай docs/multica/infrastructure-access.md и infrastructure-checks.md в свежем
checkout задачи. Не полагайся на desktop OAuth: сначала проверь tools и реальное чтение из своего runtime.
У профилей есть отдельные workspace MCP assignments; agent get.mcp_config=null не означает отсутствие MCP.
У четырёх ролей выпуска Render подключён публичным MCP config для native клиента; токены остаются у клиента.
Codex: enabled_tools из docs/multica/render-codex.mcp.json; Claude: alias plugin:render:render и
запреты из render-claude-denied-tools.json. При изменении inventory сначала сверить новые tools;
недиагностические инструменты не использовать. Остальные роли передают запрос релиз-инженеру.

Render workspace tea-d0q29c7diees738n0250 разрешён владельцем; передавай workspaceId явно.
Server srv-d1uk6b6mcj7s73ek25h0, app; Key Value red-dak61sjl550s73a1tao0.
Чтения: list_workspaces, get_service, list_deploys, get_deploy, list_log_label_values, list_logs,
get_metrics, get_key_value. Перечитай schemas; у list_logs нет deployId — нужны окно deploy, SHA и instance.
Build-сообщения могут быть type=app. CPU/память/HTTP/active_connections могут вернуть no_data; это не ноль.
Render MCP не делает HTTP fetch, Redis PING и SQL к Neon. Neon CLI: branches get с project-id и
api /projects/purple-salad-06550104/endpoints/ep-dry-boat-ad0thetj. Только metadata, без credentials.
Server остаётся на development br-ancient-mode-adgmr3w1. Production/default не подставлять.

Порядок: CI текущего PR head и независимый review → разрешённый merge в app → точный merge SHA
в Render deploy → build/start logs → Live → bounded HTTP/GraphQL → отдельные DB/Redis и acceptance.
Build, Live, health, release acceptance и task acceptance различаются. Старый зелёный deploy не доказательство.
Отмена/replacement/newer SHA требуют новых ID, ancestry и scope review; не наследуй PASS молча.
Отсутствие deploy до deadline — awaiting_publication; после — unknown/not_triggered с handoff.
Для release наблюдения poll 30–60s, общий deadline 15 минут сохраняется между run; для scheduled recovery
один снимок и тихий no-op при неизменности. Повторный trigger ради диагностики запрещён.

POST https://altera-m4po.onrender.com/ с `query InfrastructureProbe { __typename }`: максимум две попытки,
суммарно 90s, 2xx + JSON Query без errors; сверить deploy до/после. Это не SQL/Redis readiness и не SHA
в HTTP-ответе. Key Value available не PING. DB/Redis без probe = not_run, не полный PASS.
Срез 2026-09-15: прежний Redis ENOTFOUND заменён новым Key Value; конкретную исправность перепроверять.
server/build сейчас не выполняет migrate deploy; каждый раз читать scripts проверяемого SHA.

При сбое сохрани runtime/tool/service/deploy/SHA, raw status, очищенный error, окно логов, deadline,
failure_signature и один actionable next step. Не печатай токены, env values и connection strings.
Используй существующий incident/recovery/check_id и parked_release, без новой системы и сброса счётчика.
Park только после accepted source+merge, артефактов/handoff/readback, отсутствия writer/run/process и
доказанного освобождения slot; parent blocked, не Done. Recovery writer снова получает тот же slot.
Без доказательства park/reacquire работа последовательна. При успешной полной приёмке агент сам ставит
Done и продолжает существующий порядок dispatch; ручной Done владельца не требуется.

Прежние инструкции, полномочия, custom_args, модели, env, расписания, gate и лимиты профиля сохраняются.

<!-- /altera-infrastructure-access:v1 -->
