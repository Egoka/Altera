# Task 3 — implementer evidence

- **Status:** `DONE_WITH_CONCERNS`
- **Input revision:** `e77c65e0bea357f103b1edbfd30350ac2776b99c`
- **Implementation commit:** `b8e00f13b53cd73db8571d248e6823165d5f3764`
- **Runtime for every reported product command:** `/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin` first in `PATH`; Node `v24.12.0`, pnpm `10.18.3`
- **Scope:** T-001 remaining CI/config work, T-002 executable scaffolding, and nine prepared T-112 flows. No product repair, database migration, real mail, or external service was run.

## Implemented

- Pins Node `24.12.0` in `.nvmrc` and root `engines.node`; keeps the single root `packageManager` pin `pnpm@10.18.3` and removes the conflicting server-local `pnpm@10.12.4` pin.
- Pins compatible test development dependencies from registry metadata: `vue-tsc@3.3.11` (`typescript >=5.0.0`) and `@playwright/test@1.63.0` (`node >=20`).
- Adds deterministic web commands: `nuxt prepare && vue-tsc -b --noEmit` and `playwright test`.
- Adds independent `web-checks` and `web-smoke` CI jobs. Every Node setup consumes `.nvmrc`; the aggregate required `test` job explicitly rejects any non-success result from all four prerequisite jobs.
- Keeps the side-effect-free server command `build:ci`; the ordinary server `build` contains `prisma migrate deploy` and was never run.
- Adds a live-SDL contract assertion. It is an explicit `test.todo` tied to T-027 because the actual public schema violates the contract; it is neither executed nor credited as passing coverage.
- Adds a real Chromium homepage smoke against `/`, asserting the final URL and accessible Altera brand.
- Adds nine ordered T-112 scenarios (#1, #3, #4, #5, #11, #12, #13, #15, #16). Each names its missing product/fixture dependencies and is skipped before any action. They are prepared specifications, not executed E2E coverage. Destructive flow #16 additionally requires an isolated fixture environment.

## Evidence provenance and declared gaps

- Cleaned output/trace export: `.superpowers/sdd/2026-09-13-autonomy-execution/task-3-exported-tool-transcript.md`.
- Post-commit current audit: `.superpowers/sdd/2026-09-13-autonomy-execution/task-3-current-audit-manifest.json`.
- Exact observed pre-commit `HEAD`: `e77c65e0bea357f103b1edbfd30350ac2776b99c`; resulting commit: `b8e00f13b53cd73db8571d248e6823165d5f3764`.
- The pre-commit scoped dirty fingerprint and pre-commit SHA-256 manifest were not captured and are unavailable. The current audit was computed after commit and is explicitly not presented as pre-commit evidence.
- Raw outputs for the SDL RED, both typecheck failures, the first browser RED, and the first cold-cache web-build failure were not written to files at execution time. Where their original tool result is no longer available, the report keeps only the implementer's observed summary and the transcript declares the gap. No output was reconstructed or rerun for this supplement.
- The exported transcript includes the available command, exit code, executed count, significant output, wall time, and tool chunk/session IDs. Command `started_at` values are unavailable except for runner-local times printed by Vitest.

## Meaningful RED and baseline findings

### T-002 public SDL contract

`task3-public-sdl-contract-red`

Output/trace: `task-3-exported-tool-transcript.md#unit-tests-and-sdl-todo`; original raw output and tool-call ID unavailable.

```text
command: pnpm --filter server exec vitest run tests/public-schema-contract.test.ts
exit: 1
expected forbidden fields: []
received exposed fields: ["email", "role"]
```

The test assembled the actual `server/src/graphql/**/*.graphql` definitions with `loadFilesSync`, `mergeTypeDefs`, and `buildASTSchema`. T-027 is the product repair and remains open.

### T-001 deterministic web typecheck — stopped after two failed attempts

Both attempts use the stable `check_id` `task3-web-typecheck` and the same outer command:

Output/trace: `task-3-exported-tool-transcript.md#deterministic-web-typecheck`; raw output, timestamps, wall times, and tool-call IDs unavailable.

```text
PATH=/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin:$PATH pnpm --filter nuxt-app run typecheck
```

1. The first implementation used `nuxt typecheck`. Nuxt 4.0.0 still entered its npx resolver despite the pinned local `vue-tsc`; after resolution it returned exit `2` with nine product diagnostics.
2. Only the command plumbing changed: the package script became `nuxt prepare && vue-tsc -b --noEmit`, which resolves the pinned workspace binary directly and performs no download. The second attempt returned exit `2` with the same nine product diagnostics.

Retained diagnostic locations and meanings from attempt 2:

```text
web/app/components/show/Author.vue:10:6 — string | Date is not assignable to the route input
web/app/components/show/Type.vue:10:6 — string | Date is not assignable to the route input
web/app/error-t.vue:71:47 — $router is absent from the inferred component instance
web/app/pages/[slugTypeContent]/[slugArticle].vue:8:24 — route param can be undefined or string[]
web/app/pages/me/articles/[slug]/edit.vue — named middleware "auth" is absent from the generated middleware union
web/app/pages/me/articles/create.vue — named middleware "auth" is absent from the generated middleware union
web/app/pages/me/articles/index.vue — named middleware "auth" is absent from the generated middleware union
web/app/pages/me/index.vue — named middleware "auth" is absent from the generated middleware union
web/app/pages/me/settings.vue — named middleware "auth" is absent from the generated middleware union
```

The five middleware diagnostics are a meaningful baseline limitation: `web/app/middleware/auth.global.ts` exists as global middleware, but its authentication logic is commented out and the middleware is currently a no-op. Removing page declarations or widening the type union would conceal unfinished private-page protection. No product/auth change is in Task 3 scope. Per the two-failure rule this check was not renamed or retried; T-001 AC2 and the required CI gate remain open.

### T-002 homepage title limitation

The real SSR document at `/` has no HTML `<title>`. The application does expose an accessible brand link whose name begins with `Altera`, and that behavior is what the passing smoke characterizes. If T-002 AC3 uses “заголовок” to mean `document.title`, that criterion remains open; the smoke does not substitute another meaning.

## Verification before commit

| check_id | command | result | output / trace_ref |
| --- | --- | --- | --- |
| `task3-frozen-install` | `CI=true pnpm install --frozen-lockfile` | PASS; lockfile current, 1244 packages. A sandboxed retry was interrupted after DNS denial; the same command passed with registry access. | `task-3-exported-tool-transcript.md#frozen-install`; chunks `6561da`, `e54042`, `5d0f1e` |
| `task3-format` | `pnpm format` | PASS | transcript `#format`; chunk `3cf206` |
| `task3-lint` | `pnpm lint` | PASS | transcript `#lint`; chunk `8687cc` |
| `task3-unit` | `pnpm test` | PASS; 24 passed, 1 explicit todo | transcript `#unit-tests-and-sdl-todo`; chunk `972f74` |
| `task3-server-build-ci` | `pnpm --filter server run build:ci` | PASS | transcript `#safe-server-build`; chunk `99dbcf` |
| `task3-web-build` | `pnpm --filter nuxt-app run build` | PASS after allowing Nuxt's font download; first cold-cache sandbox run failed only on `fonts.gstatic.com` DNS | transcript `#nuxt-build`; passing chunk `255275`; failed-attempt raw output unavailable |
| `task3-web-typecheck` | `pnpm --filter nuxt-app run typecheck` | OPEN after two exit-2 attempts; diagnostics above | transcript `#deterministic-web-typecheck`; raw outputs/tool IDs unavailable |
| `task3-browser-smoke` | `pnpm --filter nuxt-app run test:e2e` | PASS; 1 passed, 9 skipped | transcript `#playwright-homepage-smoke-and-prepared-flows`; chunk `ca65d0` |

The first browser attempt used an exact accessible name `Altera` and failed against the real computed name `Altera ltera`. The assertion was corrected to the stable visible prefix `^Altera`; this was a test-observation correction, not a product change. The following full browser run passed.

## Acceptance mapping

- **T-001 AC2:** server safe build and web build pass; deterministic typecheck is wired into CI but currently fails on baseline product errors, so the criterion and aggregate CI remain open.
- **T-001 AC3:** implemented; local and CI configuration use exact Node `24.12.0`, with pnpm `10.18.3` pinned once at the root.
- **T-002 AC2:** meaningful RED is retained as an explicit T-027 todo; security behavior is open and is not counted as passing.
- **T-002 AC3:** the real Playwright runner and homepage URL/accessible-brand smoke pass. Strict `document.title` interpretation remains open because the baseline document has no title.
- **T-112 AC1/AC2:** nine scenarios are prepared in the requested order and skip safely with explicit dependencies. No skipped scenario is claimed as executed coverage.

## Trace and environment limits

Trace was used first for source exploration. Its index points to the original checkout, so `register_edit` cannot index newly created worktree-only files; every edit notification was still issued and the mismatch is recorded rather than worked around. The first cold Nuxt build required network access for configured Google font download; the identical command passed when that access was allowed. No migration, real database, real email, or destructive E2E action ran.

## Commit and byte identity

Commit `b8e00f13b53cd73db8571d248e6823165d5f3764` contains exactly the 19 owned files listed by `git diff-tree`; no root-owned plan, report, or evidence file was staged. The pre-commit hook passed format, lint, and tests (24 passed, 1 todo). The hook inherited the host default Node `v24.3.0` and printed the new engine warning; the same checks had already passed immediately before the commit under the required Node `v24.12.0` runtime.

Pre-commit hook output/trace: `task-3-exported-tool-transcript.md#commit-hook`, chunk `7841c0`. The exact pre-commit HEAD was `e77c65e0bea357f103b1edbfd30350ac2776b99c`. Its scoped dirty fingerprint/hash manifest is unavailable because it was not saved before commit.

`git diff --exit-code b8e00f13b53cd73db8571d248e6823165d5f3764 -- <all 19 owned files>` returned `0`, proving the tested working bytes were unchanged from the commit. The remaining dirty paths shown by `git status` are root-owned plans/reports/evidence and were neither staged nor reverted.

The per-file SHA-256 comparison now lives in `task-3-current-audit-manifest.json`: all 19 commit and worktree hashes match. It was observed at `2026-09-13T20:14:10.785294+03:00`, after commit, and cannot retroactively establish the missing pre-commit fingerprint.
