# T-006: кеш-обёртка Redis/noop и инвалидация по тегам

- **Дата**: 2026-09-15
- **Ветка**: `docs/adr-0047-plus`
- **Задача**: T-006 / ALTE-14
- **Authorization**: допуск оркестратора в ALTE-14; стадия архитектуры назначена комментарием
  `01a0a22a-aead-7ded-8bff-9fb34651abf2`
- **Базовый коммит**: `a98c8e2` (`a98c8e26d8071a9f5c8ddc360700b127beca6c5d`)
- **Исходное дерево**: dirty вне scope T-006: `AGENTS.md`
  (`338afd602e71b1531ad9ddfc13df6c8c0865a96eb0a4979023ae82feed239c10`), `CLAUDE.md`
  (`f4da90b15bab3053215e509ef98241d72381ae18d4741c22fbd3020d7da4570a`), `t004-desc.md`
  (`febe44fb8b3bc2995141e11d7cb04c6a63b4544f2d2777da0d2fa8931a3d4ccb`); эти файлы не менять и не
  включать в коммит T-006
- **Отчёт**: `docs/reports/2026-09-15-t006-cache-wrapper-report.md` (заполняется разработчиком по завершении)
- **Статус**: утверждён

> **Для исполнителя**: выполнять задачи ниже через TDD, отмечая чекбоксы. Реализация должна сохранять GraphQL SDL,
> Prisma schema и существующий внешний API.

## Цель

Сервер стартует и обслуживает GraphQL без `REDIS_URL` через noop-реализацию кеша. При наличии переменной используется
Redis-реализация с инвалидацией по тегам без `KEYS`; кеш-ключ однозначно учитывает полный объект аргументов резолвера,
включая `search`; ответы с черновиками, архивом, персональными или административными данными не кешируются.

## Источники и сохраняемый контракт

- `docs/backlog/tasks/T-006-cache-wrapper-noop.md`: scope, AC и запрет новых резолверов/изменения схемы данных.
- `docs/decisions/ADR-0019-redis-optional-cache.md`: интерфейс `get/set/del/delByTags`, Redis/noop, теги вместо `KEYS`,
  все аргументы в ключе, отсутствие общего кеша для черновиков и ответов, зависящих от прав.
- `docs/spec/50-access/visibility.md` §2.1–2.3, §2.11: публичны только опубликованные данные; персональные и
  административные ответы не кешируются; существование неопубликованного материала не раскрывается.
- `docs/vision/00-reality-check.md` §3.6: текущие прямые обращения к Redis, пропущенные аргументы ключа и неполная
  инвалидация — фактические дефекты исходной реализации.

Сохраняются GraphQL SDL, Prisma schema, правила доступа и форма GraphQL-ответов. Новых переменных окружения и
зависимостей не требуется. Принятые в ADR-0019 TTL задаются централизованной политикой: публичный список — 300 секунд,
страница материала — 3600 секунд, популярное — 600 секунд; максимальный TTL индекса тегов — 3600 секунд. Значение
300 мс для таймаута операции в ADR остаётся помеченным как неуточнённое допущение и в T-006 не закрепляется.

## Фактическая отправная точка

- `server/src/redis.ts:3-12` бросает исключение без `REDIS_URL` при импорте и экспортирует конкретный `Redis`.
- `server/src/prisma.ts:14-18` раскрывает `redis: Redis` в `GraphQLContext`, поэтому резолверы зависят от ioredis.
- `server/src/graphql/{article,contentType,sectionTag,user}/resolver.ts` вызывают `get/setex/keys/del` напрямую.
- `server/src/utils/admin.ts:135-152` содержит отдельные кеш-хелперы для административных ответов. Резолверы передают
  им `{ pagination, sort, filters }`, но не `search`.
- `Query.me`, `Query.myArticlesStats` и административные `Query.articles/users/sectionTags/contentTypes` сейчас
  кешируются, хотя результат зависит от пользователя или прав.
- `Query.article` читает статью без фильтра статуса; кешировать разрешено только результат со статусом `published`.

## Архитектурное решение

### 1. Контракт и выбор режима

Создать модуль `server/src/cache/` и не экспортировать из него сырой клиент ioredis:

```ts
export type CacheMode = "redis" | "noop"

export interface CacheSetOptions {
  ttlSeconds: number
  tags: readonly string[]
}

export interface Cache {
  readonly mode: CacheMode
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, options: CacheSetOptions): Promise<void>
  del(key: string): Promise<void>
  delByTags(tags: readonly string[]): Promise<void>
  close(): Promise<void>
}

export function createCache(options: { redisUrl?: string }): Cache
```

`createCache` вызывается один раз в `server/src/server.ts` при старте. Пустая или отсутствующая строка выбирает
`NoopCache`; непустая — `RedisCache`. `NoopCache.get` всегда возвращает `null`, остальные операции завершаются без
эффекта. `GraphQLContext` получает `cache: Cache`; поле `redis` удаляется. URL не логируется.

Redis-клиент должен иметь обработчик `error`, не накапливать команды до подключения (`enableOfflineQueue: false`) и
не превращать ошибку кеша в ошибку GraphQL: чтение при ошибке равно cache miss, запись/удаление — best effort с
очищенным предупреждением. Числовой таймаут соединения/операции в этой задаче не вводится, поскольку ADR-0019 оставил
300 мс неуточнённым допущением.

### 2. Канонический ключ

Создать чистую функцию:

```ts
export function buildCacheKey(namespace: string, args: Readonly<Record<string, unknown>>): string
```

Форма ключа: `cache:v1:data:<namespace>:<sha256(canonicalArgs)>`. `canonicalArgs` строится рекурсивно: ключи объектов
сортируются; порядок массивов сохраняется; `null`, пропущенное поле и явное `undefined` различаются; строки не
нормализуются и не обрезаются. GraphQL-резолвер передаёт полный `args`, а для аргументов с default сначала создаёт
полный объект эффективных значений, например:

```ts
const effectiveArgs = {
  ...args,
  limit: args.limit ?? 20,
  excludeFeatured: args.excludeFeatured ?? false
}
const key = buildCacheKey("query.latestArticles", effectiveArgs)
```

Нельзя собирать ключ вручную из выбранных полей. Если кеширование когда-либо появится у поиска, `search` попадёт в
ключ автоматически вместе с `pagination`, `sort` и `filters`. Тест AC-3 сравнивает ключи двух полных объектов,
различающихся только `search.query`.

### 3. Индекс тегов без `KEYS`

Redis хранит:

```text
cache:v1:data:<namespace>:<digest>       -> JSON, EX ttlSeconds
cache:v1:tag:<sha256(tag)>              -> SET полных data-key
cache:v1:key-tags:<sha256(data-key)>    -> SET tag-key, EX ttlSeconds
```

`RedisCache.set` одной транзакцией записывает значение, добавляет data-key во все tag Set, создаёт обратный индекс и
обновляет TTL каждого tag Set до `maxCacheTtlSeconds` (3600 секунд из максимума политики ADR-0019). Поэтому tag Set
не истекает раньше самого нового связанного значения и не живёт бессрочно после пассивного истечения данных.

`delByTags` выполняется одним Lua-скриптом: получает члены указанных tag Set, по обратному индексу находит остальные
теги каждого data-key, удаляет data-key и его обратный индекс, делает `SREM` во всех связанных tag Set, затем удаляет
исходные tag Set. Скрипт атомарен относительно `set`, дедуплицирует ключи и не вызывает `KEYS`, `SCAN` или поиск по
префиксу. `del(key)` использует тот же обратный индекс для очистки связей.

Доменные теги — явные стабильные строки:

```text
home
article:<slug>
author:<slug>
content-type:<slug>
section-tag:<slug>
locale:<locale>
```

Тег `locale` добавляется только там, где локаль реально присутствует в аргументах/данных; T-006 не добавляет локаль в
GraphQL API. Мутация опубликованной статьи инвалидирует `home`, статью, автора, тип контента и все старые/новые теги
статьи. Для этого резолвер читает минимальный снимок связей до изменения и объединяет его с результатом после
изменения. Изменения/архивирование типов контента и тегов инвалидируют их собственные теги и затронутые публичные
списки. Создание или правка только черновика не создаёт кеш-запись.

### 4. Явная политика резолверов

Кеширование выражается положительным allowlist, а не правилом «кешировать всё, кроме нескольких исключений».
Резолвер вызывает `readThroughPublicCache({ key, tags, ttlSeconds, cacheWhen }, fetcher)` только для публичного ответа;
`cacheWhen` проверяет статус результата перед записью.

Кешировать после проверки `published`/`active`:

- `Query.article` — только если `article.status === "published"`;
- `Query.articleDetail`, `recommendedArticles`, `relatedArticles`, `articleStats`, `featuredArticles`,
  `latestArticles`, `popularArticles` — запрос к БД уже обязан ограничивать статьи `published`;
- `Query.contentType` — только если `status === "active"`; `articlesByContentType` — только опубликованные статьи;
- `Query.tag`, `articlesByTag` — публичная таксономия и только опубликованные статьи;
- `Query.articlesByAuthor` и `authorStats` — только агрегаты и статьи со статусом `published`.

Не кешировать и удалить существующую кеш-обвязку:

- все мутации;
- `Query.articles`, `Query.users`, `Query.sectionTags`, `Query.contentTypes` — административные ответы;
- `Query.me`, `Query.myArticlesStats` — персональные ответы;
- `Query.user` и `Query.author` — текущий GraphQL `User` содержит `email` и `role`; публичный DTO вне scope T-006;
- `Query.contentTypeStats` и `Query.tagStats` — текущие ответы включают `User` (`topAuthors`/`popularAuthors`);
- любой результат со статьёй в статусе `draft`, `review` или `archived`, а также архивный `ContentType`;
- preview/token/session-dependent ответы, если они появятся в существующих резолверах до исполнения плана.

Таким образом исключение видно в коде отсутствием вызова `readThroughPublicCache`, а защита от случайной записи
неопубликованного результата дублируется `cacheWhen`. Проверка роли не делает административный ответ пригодным для
общего кеша.

## Карта файлов

- Создать `server/src/cache/types.ts` — контракт `Cache`, режим и параметры записи.
- Создать `server/src/cache/key.ts` — каноническая сериализация, SHA-256 и доменные tag helpers.
- Создать `server/src/cache/noop.ts` — `NoopCache`.
- Создать `server/src/cache/redis.ts` — `RedisCache`, транзакционная запись, Lua-инвалидация и деградация ошибок.
- Создать `server/src/cache/index.ts` — `createCache`, TTL policy и публичные экспорты.
- Создать `server/src/cache/read-through.ts` — единый read-through с `cacheWhen`.
- Изменить `server/src/server.ts` и `server/src/prisma.ts` — один startup selection и `cache: Cache` в context.
- Изменить `server/src/graphql/article/resolver.ts`, `contentType/resolver.ts`, `sectionTag/resolver.ts`,
  `user/resolver.ts` — allowlist публичного кеша и tag invalidation; удалить прямые вызовы ioredis.
- Изменить `server/src/utils/admin.ts` — удалить `ADMIN_CACHE_PREFIX`, `ADMIN_CACHE_TTL`, `getCacheKey`,
  `getCachedOrFetch`; оставить административную валидацию и построение запросов.
- Создать `server/tests/cache.test.ts` — контракт noop/Redis, ключи и индексы тегов.
- Создать `server/tests/cache-resolvers.test.ts` — cacheable/uncacheable resolver policy и инвалидация мутациями.
- Изменить `server/tests/admin.test.ts` — убрать тесты удалённого admin cache helper; проверку поискового аргумента
  перенести на общий `buildCacheKey`.

Миграций Prisma и изменений GraphQL SDL нет.

## План исполнения

### Задача 1. Зафиксировать контракт ключей и noop-режима

- [ ] Добавить падающие тесты `buildCacheKey`: одинаковые объекты с разным порядком полей дают один ключ; изменение
      любого вложенного аргумента меняет ключ; `{ search: { query: "иван" } }` и `{ search: { query: "пётр" } }` дают
      разные ключи; массивы с разным порядком не совпадают.
- [ ] Добавить падающий тест `createCache({})`: `mode === "noop"`, `get` возвращает `null`, `set/del/delByTags/close`
      не бросают исключение.
- [ ] Реализовать `types.ts`, `key.ts`, `noop.ts`, `index.ts` минимально для прохождения тестов.
- [ ] Выполнить `pnpm --filter server test -- cache.test.ts`; ожидается exit 0 и успешные тесты ключа/noop.
- [ ] Коммит: `feat(cache): add canonical keys and noop mode`.

### Задача 2. Реализовать Redis-индекс тегов

- [ ] В `cache.test.ts` добавить Redis-контракт на тестовом fake-клиенте: `set` записывает data-key, tag Set и
      reverse Set; `del` чистит связи; `delByTags` удаляет объединение ключей двух тегов; команды `KEYS`/`SCAN` не
      вызываются; ошибка Redis превращает `get` в miss и не ломает записи/удаления.
- [ ] Реализовать `RedisCache` и атомарный Lua-скрипт инвалидации. Не включать URL или payload в предупреждения.
- [ ] Выполнить `pnpm --filter server test -- cache.test.ts`; ожидается exit 0.
- [ ] Коммит: `feat(cache): add redis tag invalidation`.

### Задача 3. Переключить GraphQL context на Cache

- [ ] Добавить интеграционный тест фабрики context: без `REDIS_URL` context получает `cache.mode === "noop"`; импорт
      серверных модулей не бросает `REDIS_URL is not defined`.
- [ ] В `server.ts` создать cache до Yoga, передать его в `createContext`; в `prisma.ts` заменить `redis: Redis` на
      `cache: Cache` и удалить импорт `server/src/redis.ts`.
- [ ] Удалить устаревший `server/src/redis.ts` после отсутствия usages.
- [ ] Выполнить `pnpm --filter server test -- cache.test.ts`; ожидается exit 0.
- [ ] Коммит: `refactor(server): inject cache abstraction`.

### Задача 4. Перевести публичные чтения и закрыть запрещённое кеширование

- [ ] Добавить resolver-тесты: опубликованный результат читается повторно из кеша; `draft/review/archived` не
      вызывает `cache.set`; `me`, `myArticlesStats` и четыре admin-list резолвера не вызывают кеш; `user/author` и два
      stats-резолвера с `User` тоже обходят кеш.
- [ ] Реализовать `readThroughPublicCache` и заменить разрешённые прямые `ctx.redis` вызовы на него. В каждый ключ
      передавать полный effective args; для статьи/типа контента задать `cacheWhen`.
- [ ] Удалить административные cache helpers/imports и оставить admin-list резолверы прямыми Prisma-запросами.
- [ ] Выполнить `pnpm --filter server test -- cache-resolvers.test.ts admin.test.ts`; ожидается exit 0.
- [ ] Коммит: `refactor(graphql): cache public resolver results only`.

### Задача 5. Перевести мутации на доменные теги

- [ ] Добавить тесты на update/publish/archive/bulk operations: проверить точный набор тегов старого и нового
      состояния; изменение статьи очищает `home`, `article`, `author`, `content-type`, `section-tag`; мутации типа и тега
      очищают связанные публичные данные.
- [ ] Перед изменением читать только нужные идентификаторы/слаги связей, после изменения объединять теги и вызывать
      один `ctx.cache.delByTags([...tags])`.
- [ ] Удалить все prefix-constants и ветки с `ctx.redis.keys`/`ctx.redis.del`.
- [ ] Выполнить `pnpm --filter server test -- cache-resolvers.test.ts`; ожидается exit 0.
- [ ] Коммит: `refactor(graphql): invalidate cache by domain tags`.

### Задача 6. Проверить критерии T-006 и оформить evidence

- [ ] Выполнить `pnpm format`, `pnpm lint`, `pnpm test`, `pnpm --filter server run build:ci`; сохранить exit code,
      число тестов и значимый вывод в отчёте. `build:ci` не применяет миграции.
- [ ] Выполнить `grep -RIn --exclude-dir=node_modules --exclude-dir=generated -E '\.(keys|scan)\(' server/src`; для
      кеша ожидается отсутствие совпадений. Совпадение вне кеша оценивается отдельно, не скрывается.
- [ ] Запустить server в окружении без `REDIS_URL` с безопасными тестовыми значениями остальных обязательных env,
      дождаться readiness и выполнить GraphQL `curl`; ожидается успешный HTTP-ответ. Не печатать значения секретов.
- [ ] Повторить тест двух поисковых запросов на общей функции ключа и сохранить имена теста/результат как AC-3.
- [ ] Создать `docs/reports/2026-09-15-t006-cache-wrapper-report.md` с evidence по каждому AC, полным SHA,
      dirty fingerprint, cwd, командой, exit code, `trace_ref` и ограничениями проверки.
- [ ] Коммит: `docs(cache): report t006 verification`.

## Критерии готовности

- **AC-1 / `t006-no-redis-smoke`**: процесс server без `REDIS_URL` стартует, GraphQL-запрос через `curl` получает
  успешный ответ; unit-тест подтверждает `noop` selection.
- **AC-2 / `t006-no-keyspace-scan`**: в `server/src` нет вызовов Redis `KEYS` или `SCAN`; инвалидация подтверждена
  тестом tag Set/reverse index/Lua.
- **AC-3 / `t006-search-key-isolation`**: два объекта resolver args, различающиеся только поисковым запросом, дают
  разные ключи.
- **AC-4 / `t006-visibility-cache-policy`**: тесты подтверждают отсутствие записей для `draft/review/archived`,
  персональных и административных ответов; публичные записи имеют только разрешённые статусы.
- **AC-5 / `t006-regression-suite`**: format, lint, полный unit-набор и `server build:ci` завершаются успешно на одной
  проверяемой ревизии.

## Что сознательно не входит

- изменения Prisma schema, миграции и новые GraphQL-поля/резолверы;
- выделение публичного `User` DTO и исправление SDL с `email`/`role` — поэтому перечисленные User-bearing ответы пока
  не кешируются;
- rate limiting из ADR-0024;
- выбор окончательного operation timeout вместо неуточнённых 300 мс ADR-0019;
- Redis Cluster/репликация и инфраструктурная настройка внешнего Redis;
- кеширование preview, кабинета и административных страниц.

## Риски и меры

- **Гонка записи и инвалидации**: `set` использует Redis transaction, `delByTags` — один атомарный Lua-скрипт.
- **Коллизия/нестабильность ключей**: SHA-256 от канонической сериализации; ключи объектов сортируются, массивы нет;
  тесты покрывают search и вложенные args.
- **Утечка прав/ПДн через общий кеш**: положительный allowlist, `cacheWhen` по статусу и явный запрет всех User-bearing,
  персональных и admin resolver-ов.
- **Старые члены tag Set после TTL data-key**: tag Set продлевается на максимальный разрешённый TTL при каждой записи;
  обратный индекс и `delByTags` удаляют связи при явной инвалидации.
- **Недоступный Redis при заданном URL**: операции деградируют в miss/no-op и не бросают GraphQL-ошибку; лог очищен.
- **Чужие изменения в текущем worktree**: разработчик продолжает только в выделенном worktree T-006; перечисленные в
  шапке файлы не очищает, не reset/stash и не включает в коммит.

## Стадии и handoff

- **Архитектура**: вход — T-006, ADR-0019, visibility и reality-check; evidence — этот план на baseline `a98c8e2`.
- **Разработка**: следующий владелец — разработчик; вход — замороженный план; выход — отдельная ветка `server/t006-*`,
  коммиты реализации/тестов и парный отчёт.
- **Тестирование**: независимый тестировщик выполняет AC-1–AC-5 на SHA реализации и сохраняет фактический вывод.
- **Ревью**: независимый ревьюер сверяет diff, план, источники и evidence; вердикт `принято` либо `вернуть`.
- **Документация и релиз**: после приёмки хранитель обновляет metadata задачи; backend/shared inputs требуют отдельной
  проверки CI, merge SHA, Render deploy и HTTP/DB/Redis evidence по runtime-контракту.

Окончание архитектурного run означает готовность плана к передаче, но не завершение T-006 и не приёмку реализации.
