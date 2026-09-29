# T-050 Review Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать рабочую очередь `/admin/review` для чтения `admin` и решений `moderator`/`owner`, включая закрепление, доработку, ручную публикацию, окончательный отказ, снятие с публикации, переписку, заметки к блокам и проверки профиля.

**Architecture:** Доменная логика и транзакционные проверки конкуренции живут в `server/src/review/queue.ts`; GraphQL-модуль только переводит типы и даты. Nuxt использует один типизированный composable, URL-фильтры и две страницы очереди/карточки. Существующая история автора остаётся источником переписки, а новые решения создают совместимые `ReviewMessage`.

**Tech Stack:** TypeScript, GraphQL Yoga, Prisma/PostgreSQL, Nuxt 4/Vue 3, Vitest, Playwright.

**Spec:** `docs/spec/40-admin/review-queue.md`, источник `docs/backlog/tasks/T-050-review-queue-manual-branch.md` (`ae33d47329d8cf9b53bcc5a3773888803b0cdbaa`).

## Global Constraints

- `admin` читает очередь без кнопок решений; `moderator` и `owner` принимают решения; остальные роли получают `FORBIDDEN`.
- E-mail автора не выбирается и не возвращается; только имя и хэндл.
- Решения по закреплённой версии принимает только закрепивший ревьюер; `owner` может снять закрепление.
- Ручная публикация видна публичному GraphQL-запросу сразу и инвалидирует кеш статьи/ленты.
- Первая публикация требует активную рубрику, обложку, имя и хэндл; решения пишут audit/log events #24, #25, #69, #70.
- Локальные проверки не применяют миграции к неизвестной БД; миграция проверяется генерацией Prisma и CI на изолированной БД.

## Review Focus

- Два ревьюера одновременно решают одну карточку: второй получает `CONFLICT`, состояние не перезаписывается.
- Автор отзывает или повторно подаёт материал между чтением и решением: условный update возвращает `CONFLICT`.
- Пустые рекомендации/заметка/сообщение: `VALIDATION_ERROR`, пробельная строка не сохраняется.
- `admin` не может вызвать ни одну решающую мутацию и не получает e-mail автора.
- Ручная публикация без рубрики, обложки, имени или хэндла не меняет видимость и возвращает `VALIDATION_ERROR`.

---

### Task 1: Persistence and reviewer service

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260929150000_review_queue/migration.sql`
- Create: `server/src/review/queue.ts`
- Create: `server/tests/review-queue.test.ts`

**Interfaces:**

- Produces: `listReviewQueue(ctx, input)`, `getReviewItem(ctx, id)`, `claimReview`, `releaseReview`, `requestReviewRework`, `publishReviewManual`, `rejectReviewFinal`, `unpublishReview`, `replyInReviewDecision`, `createReviewNote`, `listProfileReviewQueue`, `decideProfileCheck`.
- Persists: `ArticleTranslation.reviewerId`, `reviewClaimedAt`, `readCount`; existing `ReviewMessage`, `ReviewNote`, `AuditLog` hold durable history.

- [ ] Write unit tests for role boundaries, field projection without e-mail, filtering/pagination, claim ownership, all decisions, validation, audit/log side effects, profile decisions and cache invalidation.
- [ ] Run `pnpm --filter server exec vitest run tests/review-queue.test.ts` and verify failures are caused by the missing service/schema.
- [ ] Add the minimal Prisma fields/migration and service implementation with conditional updates inside transactions.
- [ ] Run the focused test until green, then run adjacent review-history and translation-editor tests.

### Task 2: GraphQL contract

**Files:**

- Create: `server/src/graphql/review-queue/schema.graphql`
- Create: `server/src/graphql/review-queue/resolver.ts`
- Create: `server/tests/review-queue-graphql.test.ts`

**Interfaces:**

- Consumes: service exports from Task 1.
- Produces: `reviewQueue`, `reviewItem`, `profileReviewQueue` and mutations named in `review-queue.md` with safe DTOs and pagination.

- [ ] Write schema/resolver tests selecting author name/handle, status/readCount, decisions/history/notes and asserting no e-mail field exists.
- [ ] Run the focused GraphQL test and verify RED from absent operations/types.
- [ ] Add SDL and thin resolver mappings; serialize dates and bigint count safely.
- [ ] Run focused GraphQL tests, public schema contract, `pnpm codegen`, and server typecheck via `build:ci`.

### Task 3: Nuxt queue and card

**Files:**

- Create: `web/app/graphql/operations/admin/review.graphql`
- Create: `web/app/composables/useAdminReview.ts`
- Create: `web/app/middleware/admin-review.ts`
- Create: `web/app/pages/admin/review/index.vue`
- Create: `web/app/pages/admin/review/[id].vue`
- Modify: `web/app/utils/admin.ts`
- Modify: `web/i18n/locales/ru.json`
- Modify: `web/i18n/locales/en.json`
- Create: `web/tests/admin-review-page.nuxt.test.ts`

**Interfaces:**

- Consumes: generated GraphQL documents from Task 2.
- Produces: URL-driven queue filters, profiles tab, loading/empty/error/conflict states, read-only admin card and desktop-confirmed decision controls.

- [ ] Write component tests for every state row, exact count, author identity without e-mail, admin read-only mode, modal validation, retained input after errors and conflict refresh.
- [ ] Run the focused Nuxt test and verify RED from missing pages/composable.
- [ ] Implement deterministic SSR-safe pages using `useAsyncData`; writes use `useGraphQL`, then refresh.
- [ ] Run codegen and focused web tests until green.

### Task 4: Acceptance and delivery

**Files:**

- Create: `web/tests/e2e/50-admin-review.spec.ts`
- Create after code CI: `docs/reports/2026-09-29-t050-review-queue-report.md`
- Create after code CI: `docs/reports/tasks/T-050.json`
- Create after code CI: `docs/reports/tasks/T-050.md`

**Interfaces:**

- Playwright proves state rows, cross-reviewer conflict and immediate guest visibility after manual publication.

- [ ] Write the Playwright scenarios before any e2e-only product adjustment and verify the missing flow fails.
- [ ] Run focused Playwright on an isolated test database, then `pnpm format`, `pnpm lint`, `pnpm test`, server `build:ci`, web `typecheck`, web `build`, and smoke commands.
- [ ] Inspect the final diff, commit scoped code, push `feature/t050-review-queue`, open a PR to `app`, enable GitHub auto-merge, and record the exact head SHA.
- [ ] Request independent review for that SHA; write the final receipt/report only after current-head CI evidence, using a separate report PR as required by the controller contract.
