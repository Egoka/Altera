# Render и защита app: фактический срез 2026-09-15

После добавления владельцем `LOG_HASH_SECRET` deploy
[dep-dakpd1h594qs73935g5g](https://dashboard.render.com/web/srv-d1uk6b6mcj7s73ek25h0/deploys/dep-dakpd1h594qs73935g5g)
успешно запущен в 22:05:36 МСК. SHA: `e9cba143a98508db5a432788c4edcf66429b223c`.
Ошибка отсутствующего секрета устранена. В стартовых логах есть отклонённые
GraphQL-запросы без CSRF-заголовка; они не остановили процесс.

Live не подтверждает готовность БД. Read-only запрос через Neon MCP к
`purple-salad-06550104` / development `br-ancient-mode-adgmr3w1` / `neondb`
вернул четыре завершённые миграции 2025 года. На указанном app SHA отсутствуют
в журнале БД пять необходимых миграций:

- `20260915090000_role_add_moderator_analyst_owner`
- `20260915090100_user_account_archive_state`
- `20260915090200_sessions_hashed_auth_tokens`
- `20260915170000_user_profile_handle_locale`
- `20260915180000_taxonomy_section_format_tag`

Build (`prisma generate && tsc ...`) и start (`node dist/server.js`) миграции не применяют.
В этом срезе данные не изменялись. Development остаётся выбранным окружением;
production не переключается автоматически. До проверки и применения миграций
серверные задачи не получают подтверждённый deploy/health по новой политике.
Новый `/health` с PostgreSQL, Redis и проверкой миграций находится в PR #56;
на этом deployed SHA его ещё нет.

GitHub API подтвердил для `app`: required context `test`, `strict: true`,
`enforce_admins.enabled: true`. Проверки совместимости с актуальной базой требуются
при обычном merge, в том числе для администратора. Число обязательных GitHub approvals
не изменялось; независимый native verdict проверяет контроллер.
Прямой Multica Done и возможность администратора изменить защиту остаются внешней
границей: статус защиты — `managed_path_only`, не полный запрет обхода.

## После слияния PR #56

В `app` вошёл `5edce4c91e6fe0a435c6a34e8c8dc07795ea0f68`.
[Автоматический deploy](https://dashboard.render.com/web/srv-d1uk6b6mcj7s73ek25h0/deploys/dep-dakpk9fqj5pc73cg28sg) — Live.
Прямой запрос `/health` вернул HTTP 503, тот же revision и
`postgres: true`, `redis: true`, `migrations: false`.
Это подтверждает доступность обеих зависимостей и отдельный блокер схемы.
Изменение данных ожидает согласования владельцем конкретных последствий миграций.

Семь agent instructions, три autopilot descriptions, squad instructions и два
подключённых skills заменены актуальным коротким контрактом; изменения подтверждены readback.
Очередь/recovery пока на паузе до приёмки переключения; ежедневный аудит активен.
Автоматическое удаление не включено: полный запрет конкурирующего dispatch не подтверждён.
Первичное слияние самого контроллера выполнено в прямой сессии владельца после CI и независимого review;
оно не выдаётся за подтверждённый полный native цикл нового контроллера.
