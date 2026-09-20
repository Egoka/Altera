# Отчёт: T-111 — Обновление среза реальности после эпиков E-01–E-05

- **Дата**: 2026-09-20
- **Task**: T-111 / ALTE-92
- **Baseline SHA**: 4ea27a63d0fac9ccc9eb38cde522d9b17b58799b (origin/app)
- **Tested SHA**: 4ea27a63d0fac9ccc9eb38cde522d9b17b58799b (origin/app, HEAD ветки docs/t111-reality-check-refresh)
- **Branch**: docs/t111-reality-check-refresh
- **Исполнитель**: хранитель документации (e682f2d5-7541-475e-a0b4-ef0b8ae885f4)

## Результат

1. Добавлен раздел «Срез 2» в `docs/vision/00-reality-check.md` (§С2.1–С2.7),
   фиксирующий изменения после эпиков E-01–E-05 на коммите `4ea27a6`.
2. Обновлена врезка в начале `docs/vision/00-reality-check.md`: указано, что
   актуальный срез — ревизия 3 (2026-09-20).
3. Добавлен раздел `## Что сломано` в `CLAUDE.md` (до блока Multica runtime).

## Как проверено

| Утверждение | Источник | Команда/чтение |
|---|---|---|
| 50 test-файлов в server/ | `server/tests/*.test.ts` | `find server -name "*.test.ts" \| wc -l` |
| 48 test-файлов в web/ | `web/tests/`, `web/app/**/*.spec.ts` | `find web -name "*.test.ts" -o -name "*.spec.ts" \| wc -l` |
| CI: Node 24.12.0 из .nvmrc, pnpm из packageManager | `.github/workflows/pull_request.yml:24,28` | чтение |
| 30 моделей, 13 enum | `server/prisma/schema.prisma` | `grep "^model \|^enum " schema.prisma` |
| Role: 7 значений | `server/prisma/schema.prisma:674-682` | чтение |
| `User.handle`, `HandleHistory` | `server/prisma/schema.prisma:19,64-75` | чтение |
| Session с tokenHash | `server/prisma/schema.prisma:87-112` | чтение |
| BFF-прокси | `web/server/api/graphql.post.ts` | чтение |
| `useGraphQL` composable | `web/app/composables/useGraphQL.ts` | чтение |
| Email убран из публичного User | `server/src/graphql/user/schema.graphql:23-36` | чтение |
| Черновики/архив защищены | `server/src/visibility/article.ts:4,83-86,106` | чтение |
| Tag-based invalidation (Lua) | `server/src/cache/redis.ts:22-57` | чтение |
| NoopCache | `server/src/cache/noop.ts:1-38` | чтение |
| Structured logger (pino) | `server/src/observability/logger.ts:50` | чтение |
| Модуль почты | `server/src/mail/transports/` | `ls server/src/mail/transports/` |
| Health-check | `server/src/health.ts:53-131` | чтение |
| auth.global.ts закомментирован | `web/app/middleware/auth.global.ts:1-13` | чтение |
| /me заглушка | `web/app/pages/me/index.vue:10` | чтение |
| error-t.vue существует | `web/app/error-t.vue` | `ls web/app/error-t.vue` |
| refresh/logout нет | `server/src/graphql/auth/schema.graphql:7-10` | чтение |
| Rate limiting нет | `server/src/server.ts` | поиск по файлу |

## Критерии готовности

| AC | Статус | Доказательство |
|---|---|---|
| AC-1: каждое утверждение срез 2 помечено `[ФАКТ: файл:строка]` | ПРОВЕРЕНО | Все 32 утверждения в §С2.1–С2.7 содержат `[ФАКТ:]`; финальный `grep -c "\[ФАКТ:" 00-reality-check.md` = 151 |
| AC-2: независимое ревью одобрило изменения | ОЖИДАЕТ РЕВЬЮ | — |

## Остаток

Требуется независимое ревью (AC-2).
