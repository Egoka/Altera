# T-084 Admin Grants Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock `/admin/grants` and `/admin/subscriptions` flows with finance-authorized GraphQL reads and audited manual grant/revoke mutations.

**Architecture:** Add a focused `server/src/admin/grants.ts` service and an auto-loaded GraphQL domain, then expose typed web operations through one shared Nuxt composable consumed by both pages. Prisma writes and their audit records run in one interactive transaction; list status is derived from `startsAt`, `endsAt`, and `revokedAt`, and manual grants always require `endsAt`.

**Tech Stack:** TypeScript 5.8, GraphQL Yoga 5, Prisma 6.12, Nuxt 4/Vue 3, GraphQL Code Generator 7, Vitest 5, Playwright 1.63.

**Spec:** `docs/backlog/tasks/T-084-admin-grants-launch.md`, `docs/spec/40-admin/grants-and-promo.md`, `docs/spec/40-admin/subscriptions.md`, `docs/spec/70-plans-and-billing/grants-and-promo.md`

## Global Constraints

- Only `analyst`, `admin`, and `owner` access the flow through `finance`; actor identity comes from `GraphQLContext.currentUser`.
- A manual grant without `endsAt` returns `VALIDATION_ERROR`; the Playwright scenario remains `todo` until T-110.
- Automatic first-launch authorship is not represented as a `PlanGrant` row and is never synthesized into these lists.
- Promocodes, payments, prices, refunds, and manual subscription extension are out of scope.
- No migration or live-database mutation is required; existing `PlanGrant` and `AuditLog` models are used.
- All GraphQL errors use the existing error dictionary and do not expose sensitive internals.

---

### Task 1: Server grant service

**Files:**

- Create: `server/src/admin/grants.ts`
- Create: `server/tests/admin-grants.test.ts`

**Interfaces:**

- Produces `listAdminGrants(ctx, now?)`, `getAdminGrant(ctx, id, now?)`, `grantPlan(ctx, input, now?)`, and `revokePlan(ctx, input, now?)`.
- Returns rows with `status: "queued" | "active" | "ended" | "revoked"`, selected user/grantor identity, and ISO-compatible `Date` fields.

- [ ] Write failing tests proving finance denial, deterministic four-state derivation, missing `endsAt` validation, missing/archived/service-account rejection, transactional `plan.grant` audit, and transactional `plan.revoke` audit.
- [ ] Run `pnpm --filter server test -- tests/admin-grants.test.ts` and verify failures name the missing service.
- [ ] Implement validation and read helpers. The required validation branch is:

```ts
if (!input.endsAt) {
  throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "endsAt", rule: "required" })
}
```

- [ ] Implement both mutations with `ctx.prisma.$transaction(async (tx) => { ... })`; create the `PlanGrant`/`revokedAt` update and matching `AuditLog` in the same callback.
- [ ] Re-run the focused test and adjacent permissions tests.

### Task 2: GraphQL contract and resolvers

**Files:**

- Create: `server/src/graphql/grant/schema.graphql`
- Create: `server/src/graphql/grant/resolver.ts`
- Create: `server/tests/admin-grants-schema-contract.test.ts`

**Interfaces:**

- Produces `adminGrants: [AdminPlanGrant!]!`, `adminGrant(id: ID!): AdminPlanGrant`, `grantPlan(input: GrantPlanInput!): AdminPlanGrant!`, and `revokePlan(input: RevokePlanInput!): AdminPlanGrant!`.
- `GrantPlanInput` consumes `userHandle`, `tier`, `startsAt`, required `endsAt`, and `reason`; `RevokePlanInput` consumes `grantId` and `reason`.

- [ ] Write a failing executable-schema test that selects all client fields and asserts GraphQL `data` plus authorization/validation `errors`.
- [ ] Run the focused contract test and verify the missing schema fields fail.
- [ ] Add SDL and thin resolvers delegating to Task 1.
- [ ] Re-run the contract test and `web/tests/graphql-operations.test.ts` after Task 3 operations exist.

### Task 3: Typed Nuxt data flow and visible states

**Files:**

- Create: `web/app/graphql/operations/admin/grants.graphql`
- Create: `web/app/composables/useAdminGrants.ts`
- Modify: `web/app/pages/admin/grants/index.vue`
- Modify: `web/app/pages/admin/subscriptions/index.vue`
- Create: `web/tests/admin-grants-pages.nuxt.test.ts`
- Modify: `web/tests/e2e/17-admin-grants.spec.ts`
- Modify: `web/i18n/locales/en.json`
- Modify: `web/i18n/locales/ru.json`
- Regenerate: `web/app/graphql/generated/graphql.ts`, `web/app/graphql/generated/gql.ts`, `web/app/graphql/generated/schema.graphql`

**Interfaces:**

- Produces `useAdminGrants()` with `grants`, `loading`, `failed`, `requestId`, `refresh()`, `grant(input)`, and `revoke(input)`.
- Pages consume the shared state; user writes call `useGraphQL`, inspect both `data` and `errors`, and refresh only after confirmed mutation data.

- [ ] Write failing Nuxt tests proving both pages render the fetched four states, never render the removed first-launch fixture, require an end date for manual submission, surface request failure, and refresh after successful grant/revoke.
- [ ] Change the indefinite manual-grant Playwright test to `test.todo`; keep the visible first-launch banner and four-state acceptance cases backed by intercepted GraphQL responses.
- [ ] Run the focused web tests and verify they fail because mock rows still own page state.
- [ ] Add operations/composable, run `pnpm codegen`, and replace both mock arrays and `setTimeout` writes with the shared typed data flow.
- [ ] Re-run focused unit, operation-contract, i18n, and Playwright tests.

### Task 4: Evidence, receipt, and PR head

**Files:**

- Modify: `docs/reports/tasks/T-084.json`
- Modify: `docs/reports/tasks/T-084.md`

- [ ] Run `pnpm format`, `pnpm lint`, `pnpm test`, `pnpm --filter server run build:ci`, `pnpm --filter nuxt-app run typecheck`, and the scoped Playwright file with Node 24.12.0. Do not run `server start` or migrations.
- [ ] Record exact commands/results, baseline `a5f6c64eef712dceef8f36b2aea69f07a331ffd1`, source SHA, current run ID, and final tested SHA; distinguish the T-110 `todo` and missing `LOG_HASH_SECRET` preflight evidence from passed checks.
- [ ] Inspect the staged diff, commit only T-084 files, then push the rebased branch with `--force-with-lease` as explicitly authorized.
- [ ] Read back PR #135 head/base/check URLs. CI is external after push; do not poll unless the issue acceptance explicitly requires its result.
