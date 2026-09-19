# Проверка инфраструктуры при выпуске

Разрешено владельцем 2026-09-14: учитывать Render и Neon в работе Multica, проверять
реальную выкладку. Уточнение: текущий Render Server использует **development**.
Канонические IDs, источники и диагностика: [Render/Neon runbook](../development/render-neon.md).
Эта инструкция дополняет [post-merge-continuation](post-merge-continuation.md),
[pr-auto-merge](pr-auto-merge.md) и обязательные проверки; она не подключает API сама.
Конфигурация runtime и реально обнаруженные инструменты — [infrastructure-access](infrastructure-access.md).

## Общий контракт

GitHub CI success, merge в app, build success, Render deploy live, здоровье API и task acceptance —
отдельные результаты. Один не подменяет следующий.
Для backend/shared build inputs нельзя закрыть обязательный release только по зелёному PR.
Для docs-only/web-only, не влияющих на backend, release deploy может быть `not_applicable`
с проверенным diff; старый несвязанный incident не делает такую задачу автоматически неуспешной.
Frontend deployment сейчас не настроен/не подтверждён: web CI не выдавать за опубликованный сайт.

Перед изменением окружения сверить ID сервиса и Neon branch. Server
`srv-d1uk6b6mcj7s73ek25h0` → `purple-salad-06550104` /
`br-ancient-mode-adgmr3w1` / `neondb`. Не заменять development на production по названию
Render environment. Pooled/direct строки должны принадлежать одной ветке/роли/базе.
Секреты не попадают в issue, prompt, trace, Git и вывод команд.

## Release engineer

1. До merge проверить применимость deploy по diff и shared inputs, доступность инструментов
   и разрешённой среды. Если обязательного доступа нет, отметить `blocked_access` и сохранить
   пригодную к merge работу, не объявлять обязательный релиз успешным.
2. После разрешённого merge зафиксировать `merge_commit` — полный SHA из GitHub.
   PR checks должны относиться к проверенному head SHA и актуальному run attempt; CI PR не
   обязан иметь SHA merge commit. Сохранить обе ревизии и связь PR → merge. Пустые checks,
   skipped/neutral обязательного job, cancelled и старый зелёный run не разрешают merge.
3. Прочитать deploy list выбранного Render service, найти deploy с тем же commit. Хранить ID/URL,
   status, timestamps, источник запуска и последний наблюдаемый live SHA.
4. Нормальное ожидание pending не является повторным deploy и не увеличивает счёт неуспехов проверки.
   Poll с интервалом 30–60 секунд, deadline 15 минут. При timeout сохранить pending/unknown и handoff;
   следующий run продолжает наблюдение того же deploy, не делает новый trigger.
   Deadline относится ко всему наблюдению данного merge, включая задержку появления deploy;
   сохраняется между run, не начинается заново при каждой проверке. До deadline отсутствие
   записи — `awaiting_publication`; после — `not_triggered/unknown` с проверкой branch,
   autoDeployTrigger и доступа. Полноту ограниченного поиска/pagination фиксировать явно.
   В scheduled recovery — один снимок за run и тихий no-op при неизменности, без нового poll-loop.
5. `build_failed`, `update_failed`, отмена, отсутствие запуска и ошибка доступа не равны live.
   Сначала прочитать status и очищенный лог. Если приходит более новый commit, записать superseded:
   проверить актуальный deploy, ancestry и неизменность принятого scope; молча подменять SHA нельзя.
   Сначала искать точный `merge_commit`. Более новый unrelated/failed deploy не подтверждает его.
   Если точный deploy заменён потомком, записать исходный и новый SHA/deploy ID, ancestry и
   основание повторной приёмки; результат исходного остаётся `superseded` до этой приёмки.
   Отменённый deploy терминален: найти replacement того же SHA либо передать конкретный blocker.
   `build_failed`, `update_failed`, `pre_deploy_failed`, `canceled/cancelled`, `deactivated` и
   неизвестный новый статус не нормализовать в Live. Сохранять raw status из MCP.
6. После live проверить безопасный GraphQL smoke, ошибки старта, соответствие ветки БД.
   Отдельно зафиксировать DB/Redis checks: `__typename` их не доказывает. Использовать разрешённую
   DB-aware readiness/диагностику; если её нет — `not_run` с конкретным остатком, не полный PASS.
   Build подтверждается логом текущего SHA; старт — свежим instance и его логом после build.
   Health ограничен по времени и проверен между двумя чтениями актуального deploy. HTTP не
   возвращает commit identity: отметить эту границу. Отсутствие DB/Redis probe нельзя заменить
   нулём ошибок в логе либо `Key Value available`.
7. Публиковать итог по прежнему parent с `--parent`, если run запущен комментарием;
   передать проверяемый результат лидеру/документации, не просить ручной Done при успешной приёмке.

## Лидер, оркестратор и recovery

- Назначать release engineer реальную проверку деплоя, хранить подтверждённый handoff/run ID.
- Один инфраструктурный incident на `(service_id, deploy_id, failure_signature)`; несколько
  затронутых задач ссылаются на него. Не плодить одинаковые задачи/комментарии каждый час.
- Новая попытка deploy разрешена после установленного исправления причины, отсутствия активного
  дубликата и проверки scope. Не более одной такой автоматической повторной попытки для того же
  failure incident; дальше сохранить blocker с наблюдаемым условием восстановления. Более строгий
  существующий счёт двух неуспехов одного check_id сохраняется между run и не сбрасывается новым ID.
- Не откатывать БД и не запускать destructive миграции. Code rollback не откатывает schema;
  выбирать его только после проверки совместимости и существующих release полномочий.
- Узкое исключение к прежнему запрету нового dispatch до финализации parent: после принятого
  source output и merge, когда осталось только внешнее ожидание deploy/access, лидер может
  записать `parked_release`. До этого обязательны commit всех артефактов, сохранённый handoff
  с исходным parent/branch/SHA, incident/deploy ID, остатком и условием возобновления; readback
  этой записи, отсутствие активных writer/run и процессов, а также освобождение общего slot
  штатным механизмом. При недоказанном освобождении slot новый dispatch запрещён.
  Исходный parent остаётся release-pending/blocked, не Done; его worktree сохраняется.
  Только после этого можно запустить одну независимую готовую задачу в отдельном worktree.
  Зависимости от parked задачи не считаются выполненными. Пополнение до 3 Todo остаётся независимым.
  Это исключение имеет приоритет над запретом dispatch в backlog-autofill, pr-auto-merge и
  прежних сокращённых prompts; остальные требования сохраняются.
- Recovery parked parent сначала читает актуальные run/slot. Read-only наблюдение разрешено;
  для записи, миграций, env update, нового deploy или finalization он обязан заново получить
  тот же общий slot. Если новая задача уже работает, recovery writer ждёт; нельзя запускать
  два writer или прерывать/сбрасывать чужую работу. Если штатный runtime не позволяет доказать
  park/reacquire, применяется прежний последовательный порядок, а ограничение фиксируется явно.
- При полностью успешных обязательных release/acceptance/finalization агент сам ставит Done и
  немедленно передаёт следующую задачу. Не ждать решения владельца без реального вопроса о scope.
- Не переоткрывать старые Done автоматически из-за добавления этого правила; текущий сбой
  фиксируется отдельным связанным infrastructure incident с доказательствами.

## Остальные роли

- Разработчик: фиксирует изменения schema/env/shared build inputs, требования миграций и совместимость;
  для локальной проверки использует build:ci, если применение миграций не было разрешено.
- Тестировщик: различает local/PR smoke, deployed HTTP, SQL и Redis; указывает точный environment/SHA.
- Reviewer: не принимает unrelated live SHA, masked failure/skip, неподтверждённый branch switch или
  «успешный CI = успешный deploy». Проверяет соответствие evidence критериям задачи.
- Архитектор: учитывает текущий development и будущие региональные frontend, не объявляет
  production/Q-01 и T-103/T-104 закрытыми из-за этого аудита.
- Docs keeper: фиксирует факты в runbook/отчёте и задаче, сохраняет состояние release pending до evidence.
- Дизайнер, редактор, SEO: не изменяют инфраструктурные секреты; опубликованную среду и будущие домены
  не выдают за уже существующие. Контент/правила регионов следуют согласованной спецификации.

## Минимальный результат проверки

```yaml
service_id: srv-d1uk6b6mcj7s73ek25h0
neon_project_id: purple-salad-06550104
neon_branch_id: br-ancient-mode-adgmr3w1
merge_commit: full_sha
pr_head_sha: full_sha
ci_run_id: actual_run_and_attempt
ci_status: passed_or_failed_or_not_run
merge_status: merged_or_pending
deploy_required: true_or_false_with_reason
deploy_id: actual_id_or_null
deploy_commit: full_sha_or_null
deploy_raw_status: actual_render_value_or_null
deploy_status: pending_or_live_or_failed_or_cancelled_or_superseded_or_not_triggered_or_blocked_access_or_not_applicable
build_status: passed_or_failed_or_unknown_or_not_applicable
startup_status: passed_or_failed_or_unknown_or_not_applicable
observation_started_at: timestamp_with_timezone
observation_deadline: persistent_timestamp_with_timezone
http_smoke: passed_or_failed_or_not_run
db_check: passed_or_failed_or_not_run
redis_check: passed_or_failed_or_not_run
checked_at: timestamp_with_timezone
release_status: accepted_or_pending_or_blocked_or_not_applicable
task_acceptance: accepted_or_pending_or_rejected
evidence: sanitized_links
next_action: bounded_action_or_none
```

Пример — схема полей, не готовое evidence. `accepted` выводится из критериев конкретной задачи,
а не из заполненности полей. Отсутствующие обязательные DB/Redis проверки нельзя скрыть под accepted.

## Контрольные ситуации

| Наблюдение                                | Обязательный результат                                                |
| ----------------------------------------- | --------------------------------------------------------------------- |
| CI старого head зелёный, PR обновлён      | Повторный CI нового head; review — если изменился патч ветки          |
| Последний Live относится к старому SHA    | Текущая ревизия не подтверждена; искать точный SHA                    |
| Build success, deploy ещё обновляется     | Build passed, deploy pending, health not_run                          |
| Deploy ещё не появился после merge        | Awaiting publication до сохранённого deadline; затем handoff          |
| Deploy отменён, появился replacement      | Сохранить оба ID, наблюдать replacement, не запускать ещё один        |
| Пришёл более новый merge                  | Superseded + проверка ancestry/scope; не наследовать PASS             |
| Истёк deadline либо повторно тот же error | Продолжить существующий recovery/parked_release, не сбрасывать бюджет |
| MCP 401/403 или tool отсутствует          | Blocked access с runtime/tool и действием для восстановления          |
| HTTP 200 с GraphQL errors или HTML        | Health failed                                                         |
| HTTP исправен, DB/Redis не проверены      | HTTP passed, DB/Redis not_run; acceptance по обязательным критериям   |
| Метрики пусты, KV available               | No_data/available отдельно; это не CPU=0 и не Redis PING              |
