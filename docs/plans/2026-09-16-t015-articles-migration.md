# T-015 Articles Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить нормализованную схему материалов, языковых версий и ревизий с безопасным переносом существующих статей и единым контрактом статусов Prisma/GraphQL.

**Architecture:** `Article` получает общие метаданные и связи, а новый `ArticleTranslation` — локализованный текст, адрес и жизненный цикл; `ArticleRevision` хранит неизменяемые снимки текста версии. Миграция создаёт для каждой текущей статьи русскую версию и первую ревизию, сохраняя строковое тело как JSON-строку без преждевременной конверсии в ProseMirror; legacy-колонки остаются временным compatibility layer для действующих резолверов до T-020 и API-задач.

**Tech Stack:** PostgreSQL 17, Prisma 6.12, GraphQL SDL, TypeScript 5.8, Vitest 5.

**Spec:** `docs/backlog/tasks/T-015-migration-articles-translations-revisions.md`

## Global Constraints

- Статусы версии: `draft`, `ai_check`, `review`, `in_review`, `rework`, `published`, `archived`; окончательный отказ хранится отдельным `rejected`.
- `ArticleTranslation.body` и `ArticleRevision.body` имеют тип Prisma `Json`; структурная конверсия legacy-строки в ProseMirror относится к T-020.
- Каждая существующая статья получает ровно одну версию `ru` и ровно одну исходную ревизию без изменения исходного текста.
- Статья хранит `archivedByActorId`, `archivedByRole`, `archivedAt` и `archiveReason`; роль использует существующий enum `Role`.
- Слаг уникален в пределах локали; отдельная история слагов не создаётся по решению §26.10.
- Текущий GraphQL API остаётся собираемым за счёт временно сохранённых legacy-полей `Article`; переход резолверов на версии не входит в T-015.

---

### Task 1: Контракт статусов Prisma и GraphQL

**Files:**

- Create: `server/tests/article-schema-contract.test.ts`
- Modify: `server/src/graphql/article/schema.graphql:1-8`
- Modify: `server/prisma/schema.prisma`

**Interfaces:**

- Consumes: сгенерированный Prisma enum `ArticleStatus`, собранный GraphQL SDL.
- Produces: единый упорядоченный набор из семи статусов в обоих контрактах.

- [x] **Step 1: Write the failing contract test**

```ts
const expectedStatuses = ["draft", "ai_check", "review", "in_review", "rework", "published", "archived"]
expect(Object.values(ArticleStatus)).toEqual(expectedStatuses)
expect(graphqlStatuses).toEqual(expectedStatuses)
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter server exec vitest run tests/article-schema-contract.test.ts`

Expected: FAIL because Prisma and GraphQL expose only `draft`, `review`, `published`, `archived`.

- [x] **Step 3: Extend both enums with `ai_check`, `in_review`, and `rework`**

Keep the canonical order from the specification in `schema.prisma` and `schema.graphql`.

- [x] **Step 4: Regenerate Prisma and verify GREEN**

Run: `pnpm --filter server exec prisma generate && pnpm --filter server exec vitest run tests/article-schema-contract.test.ts`

Expected: the focused contract test passes.

### Task 2: Normalized Prisma schema and data migration

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260916120000_article_translations_revisions/migration.sql`
- Create: `server/tests/article-migration-database.test.ts`

**Interfaces:**

- Consumes: legacy `articles` rows after migration `20260915180000_taxonomy_section_format_tag`.
- Produces: `article_translations`, `article_revisions`, their constraints/indexes, article archive metadata, and one `ru` translation plus revision per legacy article.

- [x] **Step 1: Write the failing PostgreSQL migration test**

The test applies baseline migrations to a disposable database, inserts draft/published/archived legacy articles, applies only the T-015 migration, and asserts literal row counts, locales, status preservation, JSON-string body preservation, initial revision kinds, uniqueness constraints, and archive actor/role columns.

- [x] **Step 2: Run the database test and verify RED**

Run: `T015_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres pnpm --filter server exec vitest run tests/article-migration-database.test.ts`

Expected: FAIL because the target migration directory does not exist.

- [x] **Step 3: Add the Prisma models and migration SQL**

Add `ArticleTranslation`, `ArticleRevision`, `ArticleRevisionKind`, article-level source/editorial/archive fields, relations and indexes. In SQL, add enum values outside the data transaction if PostgreSQL requires committed values before use; create tables and backfill in one transaction, derive revision kind as `publish` when `publishedAt` is present and `manual` otherwise, then assert postconditions before commit.

```prisma
model ArticleTranslation {
  id               String        @id @default(uuid())
  articleId        String
  locale           Locale
  slug             String
  title            String
  dek              String?
  excerpt          String?
  featuredImage    String?
  body             Json
  status           ArticleStatus @default(draft)
  rejected         Boolean       @default(false)
  publishedAt      DateTime?
  reeditUntil      DateTime?
  reeditedAt       DateTime?
  sourceRevisionId String?

  @@unique([articleId, locale])
  @@unique([locale, slug])
}

model ArticleRevision {
  id             String              @id @default(uuid())
  translationId  String
  title          String
  dek            String?
  excerpt        String?
  body           Json
  kind           ArticleRevisionKind
  createdById    String
  note           String?
  restoredFromId String?
  createdAt      DateTime            @default(now())
}
```

- [x] **Step 4: Validate schema and verify the database test GREEN**

Run: `pnpm --filter server exec prisma validate`

Run: `T015_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres pnpm --filter server exec vitest run tests/article-migration-database.test.ts`

Expected: schema validation and all database assertions pass.

### Task 3: Documentation, full verification, and delivery evidence

**Files:**

- Create: `docs/reports/2026-09-16-t015-articles-migration-report.md`
- Create: `docs/reports/tasks/T-015.json`
- Modify: `docs/plans/2026-09-16-t015-articles-migration.md`

**Interfaces:**

- Consumes: exact final Git SHA, local command outputs, independent review verdict.
- Produces: human-readable report and canonical machine-readable receipt for the controller.

- [x] **Step 1: Run scoped and repository checks**

Run: focused contract/database tests, `pnpm --filter server test`, `pnpm --filter server run build:ci`, `pnpm format`, and `pnpm lint`.

- [ ] **Step 2: Obtain independent read-only review**

The reviewer checks the exact diff from baseline `b0d45d7de65f022f2b4965fc36908c77d5c26d4d`, with special attention to the body boundary (`to_jsonb` preservation now, ProseMirror conversion only in T-020), data-loss risks, constraints, and schema/GraphQL enum parity.

- [ ] **Step 3: Record evidence and canonical receipt**

The report records the exact commands, exit codes, test counts, SQL assertions, limitations and review verdict. `docs/reports/tasks/T-015.json` records task/issue IDs, baseline/tested SHA, branch, implementer IDs, PR, criteria, checks and remaining work without setting controller-owned `verified` or `accepted_at`.

- [ ] **Step 4: Commit, push, and open a PR to `app`**

Stage only T-015 files, inspect the staged diff, commit with a Conventional Commit message, push `server/t015-articles-migration`, and create or update its focused PR against `app`.
