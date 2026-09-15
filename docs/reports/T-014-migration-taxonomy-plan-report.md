# T-014: миграция таксономии — отчёт реализации

- **Дата**: 2026-09-15
- **Задача**: T-014 / ALTE-37
- **План**: `docs/plans/T-014-migration-taxonomy-plan.md`
- **Ветка**: `server/t-014-taxonomy`
- **Baseline**: `96ef15c06f3596b8eea2f9421d0915f9b6f31c4a`
- **Вход реализации**: `d3ed6c73b36e56879ba02a05e67801389c7c238b`

## Результат

1. Prisma-модели `ContentType` и `SectionTag` заменены на `Section` и `Tag`; добавлены nullable `Format`,
   `TaxonomyStatus`, self-relation преемника и append-only реестры `SectionSlugHistory`/`TagSlugHistory`.
2. Миграция `20260915180000_taxonomy_section_format_tag` переименовывает legacy-таблицы, колонку и M:N-таблицу
   без копирования сущностей, выполняет preflight, backfill реестров и postcondition counts в одной транзакции.
3. Named DB constraints запрещают архивную рубрику без преемника и self-successor; сервис архива дополнительно
   блокирует source/target, требует активного преемника, переносит статьи и redirect metadata атомарно.
4. Tag создаётся ролями `author`/`admin`/`owner`; rename, archive, restore и merge ограничены `admin`/`owner`.
   Slug сначала резервируется в history внутри той же Prisma transaction.
5. GraphQL и web operations/types переведены на `Section`, optional `Format` и `Tag`; generated-клиент обновлён.
   Карточки корректно не строят публичную ссылку для draft без рубрики.

## AC evidence

### AC-1 — `t014-section-archive-successor-db`

`server/tests/taxonomy-migration-database.test.ts` выполняет migration на отдельной PostgreSQL 16 и проверяет,
что прямые updates `archived + NULL successor` и `archived + self successor` отклоняются SQLSTATE `23514`.
`server/tests/taxonomy-service.test.ts` отдельно проверяет inactive successor, роль и атомарную последовательность
переноса статей, slug redirects и записи archive metadata.

### AC-2 — `t014-taxonomy-migration-preserves-data`

Rehearsal создаёт две legacy-рубрики, два legacy-тега, две статьи и три M:N-пары. До/после сравниваются точные
множества `(id, slug)`, `(articleId, sectionId)` и `(A, B)`, а также counts slug registries. Результат: 2/2 DB
теста прошли; UUID, slugs, назначения статей и все три пары совпали.

## Как проверено

Рабочий PostgreSQL: локальный одноразовый контейнер `postgres:16-alpine`; development/production Neon не менялись.

| Check | Команда | Фактический результат |
| --- | --- | --- |
| TDD RED AC-1/AC-2 | `T014_TEST_DATABASE_URL=… pnpm -F server exec vitest run tests/taxonomy-migration-database.test.ts` | 2 failed: target migration отсутствовала |
| TDD GREEN AC-1/AC-2 | та же команда после migration/schema | 1 file passed, 2 tests passed |
| Taxonomy service | `pnpm -F server exec vitest run tests/taxonomy-service.test.ts` | 1 file passed, 7 tests passed |
| Prisma schema | `pnpm -F server exec prisma validate` | schema valid |
| Clean migration deploy | `pnpm -F server exec prisma migrate deploy` на пустой БД | 9 migrations applied, exit 0 |
| Drift | `pnpm -F server exec prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --exit-code` | `No difference detected`, exit 0 |
| Server build | `pnpm -F server run build:ci` | Prisma generate, TypeScript и GraphQL copy, exit 0 |
| Server tests | `T014_TEST_DATABASE_URL=… pnpm -F server test` | 17 files passed, 1 skipped; 101 tests passed, 4 skipped |
| Web tests | `pnpm -F nuxt-app test` | 14 files passed, 106 tests passed |
| Web typecheck | `pnpm -F nuxt-app typecheck` | exit 0 |
| Workspace tests | `T014_TEST_DATABASE_URL=… pnpm test` | server 101 passed; web 106 passed; exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Format | `pnpm format` | all matched files use Prettier, exit 0 |
| Diff whitespace | `git diff --check` | exit 0 |

## Ограничения и отклонения

- Четыре PostgreSQL-теста T-013 остаются skipped, поскольку для них отдельно требуется
  `T013_TEST_DATABASE_URL`; T-014 DB-suite при общей проверке реально выполнен через `T014_TEST_DATABASE_URL`.
- Среда использовала Node `24.3.0` при заявленном engine `24.12.0`; pnpm выдавал warning, проверки завершились
  с указанными exit codes.
- Production/development Neon не мигрировался. Выпуск и проверка реальной инфраструктуры остаются стадией
  release engineer после независимого review.
