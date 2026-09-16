# T-015: материалы, языковые версии и ревизии — отчёт реализации

- **Дата**: 2026-09-16
- **Задача**: T-015 / ALTE-47
- **Native issue**: `01a0a941-2557-70f5-998a-254971327cb2`
- **План**: `docs/plans/2026-09-16-t015-articles-migration.md`
- **Ветка**: `server/t015-articles-migration`
- **Baseline**: `b0d45d7de65f022f2b4965fc36908c77d5c26d4d`
- **Источник**: `docs/backlog/tasks/T-015-migration-articles-translations-revisions.md`, blob `5fdfdd37295e4f47f216792f4d7ff82a19a0c073`

## Результат

1. Добавлены `ArticleTranslation` и `ArticleRevision`: локаль, адрес, локализованный текст, JSON-тело,
   публикационный статус, отдельный признак окончательного отказа, окно перередактирования и снимки ревизий.
2. `Article` дополнен общими метаданными `sourceLocale`, `isEditorial`, `firstPublishedAt` и полями архива:
   временем, актором, ролью и причиной.
3. Prisma и GraphQL используют один enum: `draft`, `ai_check`, `review`, `in_review`, `rework`, `published`,
   `archived`; совпадение закреплено контрактным тестом.
4. Миграция создаёт для каждой текущей статьи одну версию `ru` и одну ревизию, переносит статусы и даты,
   проверяет количество и содержимое строк до commit.
5. Legacy-тело сохраняется в JSONB как JSON-строка без смысловой конверсии. Преобразование в документ
   ProseMirror остаётся в T-020; текущие поля `Article` временно являются источником записи для действующих
   резолверов. DB-trigger атомарно создаёт/обновляет исходную версию и ревизии до перехода API на языковые версии.
6. Перед pre-migration count берётся `ACCESS EXCLUSIVE` lock на `articles`, поэтому конкурентная запись не может
   попасть между снимком количества и backfill. Lock удерживается только в транзакции миграции.

## Критерии

- **AC-1 passed**: контрактный тест сравнивает полный упорядоченный enum Prisma и GraphQL со спецификацией.
- **AC-2 passed**: PostgreSQL-тест на копии legacy-схемы подтвердил три статьи → три версии `ru` + три ревизии,
  точное сохранение текста, статуса, дат и начального вида ревизии. Отдельный сценарий подтвердил insert/update
  после миграции, сохранение JSON-looking/Unicode/multiline текста как JSON-строки и создание следующей ревизии.
- **AC-3 passed**: Prisma-схема и SQL содержат `archivedByActorId`, `archivedByRole`, `archivedAt`,
  `archiveReason`; миграционный тест читает эти поля после применения.

## Как проверено

Рабочая БД — одноразовый локальный контейнер `postgres:17-alpine`; Neon и другие внешние БД не менялись.

| Проверка               | Команда                                                                                                  | Фактический результат                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Baseline server tests  | `pnpm --filter server test`                                                                              | 17 files passed, 2 skipped; 109 passed, 6 skipped; exit 0 |
| TDD RED enum           | `pnpm --filter server exec vitest run tests/article-schema-contract.test.ts`                             | 1 failed: отсутствовали три статуса; exit 1               |
| TDD GREEN enum         | та же команда после schema/SDL и `prisma generate`                                                       | 1 passed; exit 0                                          |
| TDD RED migration      | `T015_TEST_DATABASE_URL=… pnpm --filter server exec vitest run tests/article-migration-database.test.ts` | 2 failed: target migration отсутствовала; exit 1          |
| TDD GREEN migration    | та же команда после migration/schema                                                                     | 1 file, 3 tests passed; exit 0                            |
| Prisma schema          | `DATABASE_URL=… DATABASE_URL_UNPOOLED=… pnpm --filter server exec prisma validate`                       | schema valid; exit 0                                      |
| Clean migration deploy | `pnpm --filter server exec prisma migrate deploy` на пустой PostgreSQL 17                                | 10 migrations applied; exit 0                             |
| Migration drift        | `prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code`                            | `No difference detected`; exit 0                          |
| Server build           | `pnpm --filter server run build:ci`                                                                      | Prisma generate, TypeScript, GraphQL copy; exit 0         |
| Workspace tests        | `T015_TEST_DATABASE_URL=… pnpm test`                                                                     | server 113 passed / 6 skipped; web 120 passed; exit 0     |
| Lint                   | `pnpm lint`                                                                                              | exit 0                                                    |
| Format                 | `pnpm format`                                                                                            | all matched files use Prettier; exit 0                    |
| Whitespace             | `git diff --check`                                                                                       | exit 0                                                    |

## Ограничения

- Полная конверсия строкового body в ProseMirror и общая репетиция миграций E-03 относятся к T-020.
- До cutover legacy-поля — источник записи, trigger — временный compatibility contract; T-020/API-cutover обязаны
  удалить trigger вместе с legacy-полями после финальной синхронизации. При сбое после добавления enum основная
  транзакция откатывается, но enum-значения остаются; повтор миграции использует `IF NOT EXISTS`, а запись
  `_prisma_migrations` разрешается штатным Prisma recovery-процессом.
- Проверка populated legacy-базы применяет целевой SQL через `prisma db execute`, чтобы наблюдать состояние
  непосредственно до и после одной миграции; отдельно весь migration ledger применён через `prisma migrate deploy`
  на пустой PostgreSQL 17. Финальная репетиция на клоне development data остаётся release-шагом.
- Поля archive attribution созданы в T-015; заполнение их действующей archive mutation относится к T-045/T-072.
- Два DB-набора других задач остаются skipped без их отдельных URL; T-015 DB-набор реально выполнен.
- Preflight был запущен после начала реализации и не является PASS: `clean_start` не подтвердился из-за
  runtime-managed `AGENTS.md`/`CLAUDE.md`, `fresh_app_baseline` не подтвердился после продвижения `origin/app`
  относительно выданного baseline, `LOG_HASH_SECRET` отсутствует. Локальные миграционные проверки не требовали
  запуска server runtime; исходный baseline из handoff не менялся и автоматически не перебазировался.
- Deployment не выполнялся; следующий шаг после CI и независимого review — контролируемая release-проверка.
