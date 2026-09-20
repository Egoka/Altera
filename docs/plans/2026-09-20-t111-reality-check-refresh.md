# Plan: T-111 — Обновление среза реальности после эпиков E-01–E-05

- **Дата**: 2026-09-20
- **Task**: T-111 / ALTE-92
- **Baseline SHA**: 4ea27a63d0fac9ccc9eb38cde522d9b17b58799b (origin/app)
- **Исполнитель**: хранитель документации

## Задача

Обновить `docs/vision/00-reality-check.md` новым срезом состояния кода,
датированным 2026-09-20 (коммит `4ea27a6`), и добавить раздел «Что сломано»
в `CLAUDE.md`. Каждое утверждение нового среза помечается `[ФАКТ: файл:строка]`.

## Источники фактов

Изучены на ревизии `4ea27a6`:

- `server/prisma/schema.prisma` — модели, enum, миграции
- `server/src/server.ts`, `server/src/prisma.ts` — контекст, транспорт
- `server/src/cache/` — тип кеша, Lua-скрипты
- `server/src/observability/logger.ts` — структурированный логгер
- `server/src/mail/` — модуль почты
- `server/src/errors/` — словарь ошибок
- `server/src/visibility/article.ts` — видимость черновиков/архива
- `server/src/exceptions/permissions.ts` — матрица прав
- `server/src/graphql/user/schema.graphql` — типы User/AccountUser
- `web/app/composables/useGraphQL.ts`, `web/server/api/graphql.post.ts` — BFF
- `web/nuxt.config.ts` — runtimeConfig
- `web/app/graphql/operations/` — операции
- `web/app/pages/` — страницы
- `web/app/middleware/` — middleware
- `.github/workflows/pull_request.yml` — CI
- `docker-compose.yml` — локальный dev
- `server/seed/seed.ts` — сид
- `find server -name "*.test.ts"` — 50 файлов тестов
- `find web -name "*.test.ts" -o -name "*.spec.ts"` — 48 файлов

## Изменения

1. Добавить новый раздел «Срез 2» в `docs/vision/00-reality-check.md`:
   - Дата: 2026-09-20, коммит `4ea27a6`
   - Формат: что изменилось относительно среза 1 (2026-09-05)
   - Каждое утверждение с `[ФАКТ: файл:строка]`

2. Добавить раздел `## Что сломано` в `CLAUDE.md` (до `BEGIN MULTICA-RUNTIME`).

## Критерий готовности

Каждое утверждение нового среза помечено `[ФАКТ: файл:строка]`.
Независимое ревью одобрило изменения.
