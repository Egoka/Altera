# Отчёт T-006 / ALTE-103: повторная проверка кеш-обёртки Redis/noop на текущем `app`

- **Задача**: T-006 / ALTE-103 (`01a0c0ba-22cf-7724-bb90-3805d34c2535`)
- **Источник**: `docs/backlog/tasks/T-006-cache-wrapper-noop.md`
- **План**: `docs/plans/2026-09-21-t006-cache-verification.md`
- **Baseline**: `924c682b56a161aa6a724462fe8d6191d9b19a80` (`origin/app`)
- **Проверенная ревизия**: `aad42a65dde3de35a114e497041a73eaadc50be8`
- **Ветка / worktree**: `feat/t006-cache-noop` / `.worktrees/t006-cache-verify`
- **Среда**: macOS, Node `24.12.0`, pnpm `10.18.3` — совпадает с закреплёнными версиями
- **Исходное дерево**: clean

## Главное

T-006 уже выполнена и принята ранее под issue **ALTE-58**: реализация влита в `app` через PR #38
(коммиты `0cac749`, `67faa50`, `723e40f`, `6e1083e`, `41630d7`), доказательный документ — через
PR #83; независимое ревью дало `approved`. Существующие receipt-файлы
`docs/reports/tasks/T-006.json` и `docs/reports/tasks/T-006.md`, отчёт реализации —
`docs/reports/2026-09-15-t006-cache-wrapper-report.md`, проверка —
`docs/reports/evidence/2026-09-16-t006-current-verification.md`. Эти документы сохранены без
изменений.

ALTE-103 — повторная выдача той же задачи. Вероятная причина названа в разделе «Остаток»:
в шапке `docs/backlog/tasks/T-006-cache-wrapper-noop.md` статус до сих пор «кандидат», поэтому
в `docs/backlog/matrix.md` задача выглядит незавершённой.

Заход не переписывает продуктовое поведение кеша. Он делает две вещи: проверяет три критерия на
текущем `app`, который ушёл на пять коммитов вперёд от проверенной в сентябре ревизии
(`c8781cd`, `70fd464`, `ea1d616`, `33a222d`, `c87317a`) и получил второй ioredis-клиент из T-024
(`server/src/rate-limits/redis-store.ts`), и закрепляет критерий AC-2 тестом исходников вместо
ручного grep.

## Результат критериев

| ID | Критерий | Статус |
|----|----------|--------|
| AC-1 | Старт `server` без `REDIS_URL` успешен, запросы отвечают | passed |
| AC-2 | В коде нет вызова `KEYS` | passed |
| AC-3 | Два разных поисковых запроса не получают один кеш-ключ | passed |
| AC-4 | Черновики и архив не кешируются, ключи содержат все аргументы | passed |

## Как проверено

### AC-1 / старт без `REDIS_URL`

- `command`: `env -u REDIS_URL PORT=4217 NODE_ENV=test DATABASE_URL=<локальный несуществующий> REQUEST_ID_FORWARD_SECRET=<тестовое> LOG_HASH_SECRET=<тестовое> JWT_ACCESS_SECRET=<тестовое> JWT_REFRESH_SECRET=<тестовое> FRONTEND_URL=<локальный> node dist/server.js` + HTTP-пробы
- `revision_commit`: `924c682b56a161aa6a724462fe8d6191d9b19a80`
- `exit_code`: 0 для GraphQL-пробы
- `output`: `{"data":{"__typename":"Query"}}`; `GET /health` → `{"status":"unavailable","revision":null,"checks":{"postgres":false,"redis":"disabled","migrations":false}}`
- `result`: passed
- `limits`: `redis: "disabled"` подтверждает режим noop по ADR-0019. `postgres: false` и HTTP 503
  вызваны отсутствием локальной базы (использован заведомо недоступный `DATABASE_URL`), а не
  кешем: Docker в среде захода не работает. Тот же запуск через `pnpm --dir server run smoke`
  прошёл шаг GraphQL («сервер поднялся и ответил на GraphQL-запрос») и упал позже на health-шаге
  по той же причине — отсутствие PostgreSQL.

### AC-2 / отсутствие обхода keyspace

- `command`: `if grep -RInE '(redis\.call\(\s*["'](KEYS|SCAN|HSCAN|SSCAN|ZSCAN)["'])|\.(scanStream|keysBuffer)\(|\bclient\.(keys|scan)\(' server/src; then echo FOUND; else echo "No Redis keyspace-scan commands in server/src"; fi`
- `revision_commit`: `924c682b56a161aa6a724462fe8d6191d9b19a80`
- `exit_code`: 0
- `output`: `No Redis keyspace-scan commands in server/src`
- `result`: passed
- Единственные совпадения по подстроке `keys(` в `server/src` — `Object.keys` в
  `rate-limits/policy.ts`, `admin/audit.ts`, `audit/registry.ts` и `Map.keys` в
  `jobs/job-worker.ts`; к Redis они отношения не имеют. Lua-скрипты кеша используют `SMEMBERS`,
  `SREM` и `DEL`, скрипт лимитов — `INCR`, `PTTL`, `PEXPIRE`.

### AC-3 / изоляция поисковых запросов

- `command`: `pnpm --filter server exec vitest run tests/cache.test.ts -t 'изолирует два разных поисковых запроса'`
- `revision_commit`: `924c682b56a161aa6a724462fe8d6191d9b19a80`
- `exit_code`: 0
- `output`: 1 passed, 11 skipped по фильтру имени
- `result`: passed

### AC-4 / чтение кешируемых резолверов

Просмотрены все места вызова `buildCacheKey`, `readThroughPublicCache` и `ctx.cache`:

- ключ содержит полный набор аргументов запроса: `query.sectionCatalog`, `query.tagCatalog`
  (включая `q`), `query.popularTags`, `query.authorCatalog`, `query.sitemapEntries`,
  `query.articlesBySection`, `query.articlesByTag`, `query.articlesByAuthor`,
  `query.authorStats`, `query.article`, `query.articleDetail`, `query.recommendedArticles`,
  `query.relatedArticles`, `query.articleStats`, `query.feed`;
- `query.feed` намеренно не кладёт `limit` в ключ для областей, кроме `latest`: остальные ветки
  его не читают, и в коде это объяснено комментарием;
- черновики и архив в общий кеш не попадают: `query.article` пишет только `status === "published"`,
  `query.section` — только `active`, `query.tag` — только `active`, остальные выборки ограничены
  `publicArticleWhere`;
- админские выборки с аргументом `search` (`articles`, `sections`, `tags`, `users`) кеш не
  используют вовсе, поэтому исторический дефект «ключ админского поиска не включает запрос»
  неприменим к текущему коду.

### Регрессионный набор

На ревизии `aad42a6`:

- `pnpm format` — exit 0;
- `pnpm lint` — exit 0;
- `pnpm test` — exit 0: server 591 passed + 25 skipped, web 411 passed;
- `pnpm --filter server run build:ci` — exit 0, миграции не применялись.

## Изменение кода захода

`server/tests/cache-source-contract.test.ts` — тест исходного контракта по образцу
`server/tests/error-contract.test.ts`: команды обхода keyspace не встречаются в Lua-скриптах,
keyspace-методы Redis-клиентов не вызываются, интерфейс `CacheRedisClient` не объявляет `keys`
или `scan`. `Object.keys`, `Reflect.keys` и `Map.keys` из проверки исключены.

RED зафиксирован до принятия: при временной подмене `SMEMBERS` на `redis.call("KEYS", "cache:*")`
и добавлении `this.client.keys("cache:*")` в `server/src/cache/redis.ts` два из трёх тестов
упали с `server/src/cache/redis.ts` в списке нарушений; после восстановления файла (`git diff`
пуст) все три прошли.

## Ограничения

- Настоящий Redis в заходе не поднимался: Docker в среде недоступен. Команды Redis покрыты
  детерминированным fake-клиентом в `tests/cache.test.ts`, историческая проверка кеша с живым
  Redis — в CI PR #38.
- PostgreSQL в заходе недоступен, поэтому health-часть smoke не проходит; GraphQL-шаг без
  `REDIS_URL` пройден.
- Приёмка задачи выполняется контроллером; этот отчёт её не заменяет.

## Остаток и следующий шаг

Шапка `docs/backlog/tasks/T-006-cache-wrapper-noop.md` содержит `**Статус**: кандидат`, хотя код
слит в `app` ещё в сентябре, а `docs/backlog/matrix.md` собирается из шапок задач. Из-за этого
задача повторно выдана как ALTE-103. Правка статуса задачи и пересборка матрицы — зона хранителя
документации, поэтому в этом заходе они не выполнены; вопрос передаётся владельцу и координатору.
То же расхождение стоит проверить для T-005, который в матрице тоже остался кандидатом при
наличии отчёта.
