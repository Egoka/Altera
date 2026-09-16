# Актуальная проверка T-006

- **Task / issue**: T-006 / ALTE-58 (`01a0ab45-ca56-797d-984b-7f8a4164df3e`)
- **Источник**: `docs/backlog/tasks/T-006-cache-wrapper-noop.md`, revision
  `bb67f06498463bc3375e7ddff8bea4ad35facad3`
- **Baseline и проверенная product revision**: `c4eeae01949bdec0468e0bd3532a64ac48792505`
- **Историческая реализация**: `41630d7576b449784f1133b07fa77bb35b9279ed`, слита в `app` через PR #38
- **Implementer**: `b0f3bc32-dd95-471e-b40e-517aaf83edf0`
- **Implementer run**: `01a0abd9-0902-73d4-a434-496ecade0c71`

## Результат критериев

1. Без `REDIS_URL` собранный сервер запустился и ответил на GraphQL-запрос
   `{"query":"{__typename}"}` ответом `{"data":{"__typename":"Query"}}`. Для обязательных
   секретов процесса использованы локальные непроизводственные тестовые значения; подключения к БД
   запрос не выполнял.
2. Условный поиск по `server/src` не нашёл вызовов `.keys(` или `.scan(`.
3. `tests/cache.test.ts` подтвердил разные ключи для двух поисковых запросов: 1 passed,
   11 skipped по фильтру имени теста.
4. `cache.test.ts`, `cache-resolvers.test.ts` и `prisma-context.test.ts`: 23 passed.
5. Полный набор: server — 119 passed, 13 skipped; web — 131 passed. Skipped-сценарии не
   относятся к целевым тестам T-006.

## Как проверено

На product revision выполнены:

```text
pnpm --filter server exec vitest run tests/cache.test.ts tests/cache-resolvers.test.ts tests/prisma-context.test.ts
pnpm --filter server exec vitest run tests/cache.test.ts -t 'изолирует два разных поисковых запроса' --reporter=verbose
grep server/src на вызовы .keys( / .scan( с условным exit 0 только при отсутствии совпадений
pnpm --filter server run build:ci
локальный запуск server/dist/server.js без REDIS_URL и HTTP GraphQL probe
pnpm format && pnpm lint && pnpm test && pnpm --filter server run build:ci
```

Все перечисленные команды завершились с exit code 0. `build:ci` не применяет миграции.

Первый probe после переключения ветки обнаружил старый скомпилированный
`server/dist/graphql/sectionTag/schema.graphql`, отсутствующий в `server/src`. После удаления только
генерируемого `server/dist` и чистой пересборки тот же probe прошёл. Исходное дерево продукта не
менялось.

## Ограничения

- Preflight подтвердил GitHub, origin, worktree, Node `24.12.0`, pnpm `10.18.3` и baseline.
  Проверка `git:clean_start` не прошла из-за auto-managed изменений runtime в `AGENTS.md` и
  `CLAUDE.md`; эти файлы не входят в commit.
- Интеграция с настоящим Redis в этом запуске не повторялась. Контракт Redis покрыт unit-тестами;
  исторический CI реализации доступен в PR #38.
- Для точного PR head ещё требуются CI и независимое review в текущей native issue.
