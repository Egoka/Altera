# Отчёт T-006: кеш-обёртка Redis/noop

- **Задача**: T-006 / ALTE-14 (`01a0a174-09c1-757f-99ed-8dc3065ccb17`)
- **Стадия**: реализация
- **Authorization**: комментарий оркестратора `01a0a232-c5f1-7dfe-9496-a108e49e3ac0`
- **План**: `docs/plans/2026-09-15-t006-cache-wrapper.md`, исходный baseline `a98c8e2`
- **Base ref / baseline реализации**: `origin/app` / `563e909819348127f71a54bd2c0fbaae35d6f7d9`
- **Проверенная source revision**: `41630d7576b449784f1133b07fa77bb35b9279ed`
- **Ветка / cwd**: `server/t006-cache-wrapper` / `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t006-cache-wrapper`
- **Исходное и проверенное дерево**: clean; перед созданием этого отчёта `git status --porcelain=v1` пуст
- **Среда**: macOS, Node `v24.3.0`, pnpm `10.18.3`; репозиторий требует Node `24.12.0`
- **Trace ref**: Multica parent/comment `01a0a174-09c1-757f-99ed-8dc3065ccb17` / `01a0a232-c5f1-7dfe-9496-a108e49e3ac0`; полный экспорт локального tool trace недоступен

## Результат

Добавлен контракт `Cache` с `NoopCache` и `RedisCache`. При отсутствии или пустом `REDIS_URL` сервер создаёт noop и
обслуживает GraphQL. Redis-реализация хранит data-key, tag Set и обратный индекс, а `del`/`delByTags` очищают связи
Lua-скриптами без обхода keyspace. Ключ — SHA-256 канонического полного объекта аргументов; порядок ключей объектов
стабилен, порядок массивов сохраняется, отсутствующее поле, `null` и `undefined` различаются.

GraphQL context теперь содержит `cache`, прямой ioredis удалён. Общий кеш разрешён только публичным чтениям;
персональные, административные и User-bearing ответы обходят кеш. `Query.article` записывает только `published`,
`Query.contentType` — только `active`; остальные кешируемые выборки ограничивают статьи статусом `published` в Prisma.
Мутации инвалидируют доменные теги старого и нового состояния.

## TDD и коммиты

1. `0cac749` — тесты ключа/noop сначала завершились ошибкой импорта отсутствующего `../src/cache`; после минимальной
   реализации: 26 passed, 1 todo.
2. `67faa50` — Redis-контракт сначала завершился ошибкой импорта отсутствующего `../src/cache/redis`; после реализации:
   30 passed, 1 todo.
3. `723e40f` — context-тест без `REDIS_URL` сначала воспроизвёл `REDIS_URL is not defined`; после injection:
   31 passed, 1 todo.
4. `6e1083e` — resolver-policy тест сначала завершился ошибкой отсутствующего `read-through`; после allowlist и удаления
   admin/private caching: 33 passed, 1 todo.
5. `41630d7` — тест доменных тегов сначала упал с `buildArticleCacheTags is not a function`; после реализации и wiring:
   35 passed, 1 todo; `build:ci` exit 0.

## Как проверено

### AC-1 / `t006-no-redis-smoke`

- `command`: `env -u REDIS_URL JWT_ACCESS_SECRET=<test> JWT_REFRESH_SECRET=<test> PORT=4216 pnpm --dir server run smoke`
- `revision_commit`: `41630d7576b449784f1133b07fa77bb35b9279ed`
- `started_at`: 2026-09-15T02:30+03:00
- `exit_code`: 0
- `executed`: один процесс server и два HTTP GraphQL-запроса скрипта
- `output`: `{"data":{"__typename":"Query"}}`; «сервер поднялся и ответил на GraphQL-запрос»
- `result`: passed
- `limits`: smoke не выполняет DB-запрос и не доказывает связность PostgreSQL/Redis

### AC-2 / `t006-no-keyspace-scan`

- `command`: `if grep -RIn --exclude-dir=node_modules --exclude-dir=generated -E '\\.(keys|scan)\\(' server/src; then exit 1; else echo 'No Redis KEYS/SCAN calls found in server/src'; fi`
- `revision_commit`: `41630d7576b449784f1133b07fa77bb35b9279ed`
- `exit_code`: 0
- `executed`: весь `server/src`, кроме generated/node_modules
- `output`: `No Redis KEYS/SCAN calls found in server/src`
- `result`: passed
- `limits`: корректность Redis-команд дополнительно проверена fake-client unit-тестами; настоящий Redis не запускался

Первый буквальный grep из плана вернул exit 1 при отсутствии совпадений и остановил цепочку после уже успешных
format/lint/test/build:ci; это нормальная семантика grep, а не дефект продукта. Проверка повторена условной командой,
которая даёт exit 0 только при отсутствии совпадений.

### AC-3 / `t006-search-key-isolation`

- `command`: `pnpm --filter server exec vitest run tests/cache.test.ts -t 'изолирует два разных поисковых запроса'`
- `revision_commit`: `41630d7576b449784f1133b07fa77bb35b9279ed`
- `exit_code`: 0
- `executed`: 1 passed, 10 skipped
- `output`: разные ключи для полных resolver args, различающихся только `search.query` (`иван` / `пётр`)
- `result`: passed

### AC-4 / `t006-visibility-cache-policy`

- `command`: `pnpm --filter server test -- cache-resolvers.test.ts`
- `revision_commit`: `41630d7576b449784f1133b07fa77bb35b9279ed`
- `exit_code`: 0
- `executed`: общий запуск server — 35 passed, 1 todo
- `output`: `draft`, `review`, `archived` не записываются; published read-through переиспользует запись; `me` не
  обращается к общему кешу; старые/новые доменные теги объединяются и инвалидируются одним вызовом
- `result`: passed
- `limits`: независимое тестирование и review ещё не выполнены

### AC-5 / `t006-regression-suite`

На одной source revision выполнена последовательность `pnpm format && pnpm lint && pnpm test && pnpm --filter server run build:ci`:

- format: exit 0, все файлы соответствуют Prettier;
- lint: exit 0, ошибок нет;
- test: exit 0, server 35 passed + 1 todo, web 59 passed, всего 94 passed + 1 todo;
- server `build:ci`: exit 0; Prisma generate, TypeScript compile и GraphQL copy завершены; миграции не применялись.

## Отклонение от плана

Redis Lua предоставляет `redis.sha1hex`, но не SHA-256. Поэтому атомарный `delByTags` не может вычислить описанный в
плане `sha256(data-key)` после чтения неизвестных заранее data-key из tag Set. Обратный индекс использует уже
существующий 64-символьный SHA-256 digest канонических args из конца data-key:
`cache:v1:key-tags:<args-digest>`. Это сохраняет атомарную инвалидацию, отсутствие `KEYS`/`SCAN`, ограниченный TTL и
коллизионную стойкость ключа; внешний API и критерии T-006 не меняются.

## Ограничения и следующий шаг

- Настоящий Redis не использовался; Redis-командный контракт проверен детерминированным fake client, а интеграция с
  реальным сервисом остаётся задачей тестировщика/release-проверки.
- Node среды `24.3.0` не совпадает с закреплённым `24.12.0`, хотя все выполненные проверки завершились успешно.
- Реализация готова к независимому тестированию на финальном commit отчёта; приёмка и выпуск ещё не выполнены.
