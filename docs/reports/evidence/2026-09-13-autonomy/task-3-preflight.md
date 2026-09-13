# Task 3 preflight — verifiable product infrastructure

Read-only preflight for Task 3. No product/config/backlog files were edited, no packages were installed, no real database/network service was used, and no commit was created. Build/cache outputs and this report/log directory are ignored by Git.

## Snapshot and evidence boundary

- Working tree: `/private/tmp/altera-agent-loop-autonomy`, branch `docs/agent-loop-autonomy`.
- Start HEAD: `eb4dc504f590e951ec8ae9f0d5404aaff05ad51d`.
- Final observed HEAD: `f5f95f49a0027e2258e409674e3f9f4d77b7584b` (`docs(multica): сохранить снимок и проверенные корректировки`). Other agents advanced HEAD during this preflight.
- Critical Task 3 inputs did not change across that range: `git diff --name-only eb4dc5..f5f95f -- package.json server/package.json web/package.json pnpm-lock.yaml .github/workflows/pull_request.yml server/src/graphql/user/schema.graphql web/app/pages` returned no paths, exit `0`.
- Final dirty snapshot contained `docs/development/agent-loop-gate.md`, `scripts/agent-loop/gate.py`, and `scripts/agent-loop/test_gate.py`, all owned by the concurrent Task 2 agent. Full capture: `task-3-preflight-logs/git-status-final.log`; SHA-256 of the captured porcelain stream: `99bbeedb46f450e1a25d79a28917761550031084dd7a978c185721b68e24444a`.
- The already-established 24-test baseline was intentionally not rerun. `docs/development/testing.md` records 19 server + 5 web tests passing; Task 3 must preserve them.
- Trace was used first (`get_project_map(summary_only=true)`). Caveat: trace reported index/current HEAD `7fdae9b60367db0403a6353b046fc3925304f9e2`, while this checkout was on the HEADs above. Critical configuration was read from this checkout, and the route inventory was cross-checked with `git ls-tree`.

## Remaining acceptance criteria

### T-001 — remaining AC 2 and 3

1. **AC2 remains partial.** CI runs format, lint, the 24 Vitest tests, server `build:ci`, output existence, and server smoke. It does not build `nuxt-app` and does not run a web typecheck. The backlog's literal `pnpm --filter server build` is stale and unsafe because `server:build` contains `prisma migrate deploy`; the effective safe requirement is `pnpm --filter server run build:ci`.
2. **AC3 remains open.** `.nvmrc` and root `engines` are absent. Both CI jobs use Node `20`. The default local binary is Node `v24.3.0`, while the controller-selected and already-installed target is `v24.12.0`. Exact target compatibility is confirmed for both safe builds below.
3. **pnpm is not yet singular.** Root `packageManager` is `pnpm@10.18.3`; `server/package.json` still says `pnpm@10.12.4`; `web/package.json` has no package manager field. The root field is what `pnpm/action-setup` consumes.
4. **Existing T-001 AC1/AC4 should stay intact.** Vitest currently fails with no test files per prior evidence, and workflow `run` commands do not mask server startup with `|| true`.

Required implementation scope: pin `.nvmrc` and root `engines.node` to `24.12.0`, remove/align the conflicting server pnpm declaration, make both setup-node steps consume the same pin, add web build and deterministic typecheck commands to package scripts/CI, preserve `build:ci`, and keep the required aggregate `test` job honest. Do not use `server:build` in CI.

### T-002 — remaining AC 2 and 3

1. **AC2 is absent and the live contract currently violates it.** `docs/spec/50-access/visibility.md` says public SDL types must exclude `email`, `role`, `planTier`, and `sessions`. Trace `get_symbol` shows `User.email: String!`; public `author(slug): User` and `Article.author: User!` make the field publicly reachable in SDL. No SDL contract test exists. T-002 explicitly permits a `todo` until T-027, but that is an honest unfulfilled security criterion, not passing coverage. The implementer should first capture a targeted RED against the assembled live schema; if product repair remains out of scope, retain the live assertion as a T-027-linked todo and report AC2 open.
2. **AC3 is absent.** There is no direct `@playwright/test` dependency, Playwright binary, config, smoke file, package script, or CI browser step. Optional peer references in `pnpm-lock.yaml` do not provide an installed runner. Add one real homepage smoke that starts the web app, opens `/`, asserts the actual title, and executes in CI. This smoke must be the executed browser test; T-112 skipped scenarios cannot substitute for it.

### T-112 — prepare nine flows; do not claim execution

Suggested one-file-per-flow scenario inventory. Each scenario must preserve the source's ordered steps and expected states and remain explicitly skipped until its owning features/dependencies exist. Use a clear dependency/task marker in each skip reason.

| Flow | Suggested scenario | Minimum prepared steps / current blocker |
|---|---|---|
| #1 registration/login | `01-register-login.spec.ts` | Request magic link with consent without account disclosure; consume one-use 15-minute token; create/login; session redirect; archived-account branch. Requires mail fake, `/login`, verify route, consent/session behavior; those pages are absent. |
| #3 write/publish | `03-write-publish.spec.ts` | Create draft; edit/media/license/SEO; submit to `ai_check`; fake AI publish vs review; rework/resubmit; final reviewer outcome. Article pages/queries are partial, while AI/review/mail fixtures are not established. |
| #4 re-edit after autopublish | `04-reedit-after-autopublish.spec.ts` | Autopublish; expose one-time control for one hour; withdraw to draft; resubmit through AI; assert expired/reused control is unavailable. No verified time-window/status behavior exists. |
| #5 manual moderation | `05-manual-moderation.spec.ts` | Claim oldest review; inspect revision/reasons; request rework vs manual publish vs final rejection; author reply/resubmit; unpublish branch. `/admin/review` is absent. |
| #11 admin archive/restore account | `11-admin-archive-account.spec.ts` | Warn about articles/plan; transactional archive + session/article effects; blocked login; one appeal; admin decision; per-article restore. Admin user screens exist but use mock/partial UI; blocked-appeal and required lifecycle are absent. |
| #12 self archive/export | `12-self-archive-export.spec.ts` | Request/download export; email-confirm self archive; session/article effects; limited login; restore account; restore articles one by one. `/me/export`, `/me/delete`, and archived-state pages are absent. |
| #13 email change/recovery | `13-email-change-recovery.spec.ts` | Request code to new address; confirm while preserving sessions; notify old address; support recovery; audited admin change; login with new address. `/me/email` and support/admin recovery workflow are absent. |
| #15 article archive/restore | `15-article-archive-restore.spec.ts` | Self/staff archive; 410/media/list effects; archive filter actor label; author restrictions; owner restore; published-vs-draft result. Article/admin pages exist, but exact archive hierarchy, restore, 410, and media semantics are unverified. |
| #16 permanent delete | `16-permanent-delete.spec.ts` | Owner-only archived entity; preview cascade; exact-name + reason confirmation; transactional deletion; 404; immutable audit; reserved slug/handle; conflict branches. Trace found no `permanentDelete` symbol; feature is absent. Never execute this destructive flow against an unknown environment. |

The checkout has 26 Nuxt page files. It has article and admin user/article pages, but no login/verify, review queue, archived-state, self-delete/export, or email-change pages. Some present screens are placeholders or mock-backed, so file presence is not feature readiness.

## Existing scripts and workflow

| Area | Existing commands | Finding |
|---|---|---|
| Root | `pnpm test`, `pnpm lint`, `pnpm format`, `pnpm format:fix` | `test` delegates recursively; `format:fix` mutates and is outside this preflight. |
| Server | `test`, `build`, `build:ci`, `smoke` | `build:ci` is safe; ordinary `build` performs `prisma migrate deploy` and must not be used here/CI. |
| Web (`nuxt-app`) | `test`, `build`, `dev`, `generate`, `preview` | No `typecheck` or browser-test script. `nuxi typecheck` is exposed transitively, but dynamically invokes missing `vue-tsc`. |
| Workflow | checks + server-smoke + aggregate `test` | Node 20 in both jobs; no web build/typecheck/Playwright smoke; server uses safe `build:ci`. |

## Baseline commands and classification

All commands ran from the scratch checkout. Complete logs are under `task-3-preflight-logs/`.

| Check | Runtime | Exit | Log / classification |
|---|---|---:|---|
| `pnpm --filter server run build:ci` | Node 24.3.0, pnpm 10.18.3 | 0 | `server-build-ci.log`; baseline pass. |
| `pnpm --filter nuxt-app run build` | Node 24.3.0, pnpm 10.18.3 | 0 | `web-build.log`; pass with restricted-network font-provider errors and a missing optional `sharp` binary warning. The build completed and produced `.output`. |
| `pnpm --filter nuxt-app exec nuxi typecheck` | Node 24.3.0, pnpm 10.18.3 | 1 | `web-typecheck.log`; **pre-existing repository blocker plus environmental trigger**. `vue-tsc` is not installed/declared, so Nuxt invoked `npx -p vue-tsc -p typescript`; registry DNS is unavailable in this environment. `pnpm --filter nuxt-app why vue-tsc` returned no package and `web/node_modules/.bin/vue-tsc` is absent. Do not rely on on-demand install in CI. Not rerun unchanged. |
| `pnpm --filter server run build:ci` | **Node 24.12.0**, pnpm 10.18.3 | 0 | `server-build-ci-node24.12.log`; target-pin compatibility pass. |
| `pnpm --filter nuxt-app run build` | **Node 24.12.0**, pnpm 10.18.3 | 0 | `web-build-node24.12.log`; target-pin compatibility pass with the same non-fatal network/font warnings. |

No failure was introduced by this preflight because no tracked Task 3 file changed. The only failed check is the pre-existing non-deterministic typecheck path. Generated `server/dist` and `web/.output` are ignored; the final tracked status contained no build-produced change.

## Implementer handoff

1. Keep T-001/T-002/T-112 backlog statuses unchanged unless acceptance is granted.
2. Start with RED checks for runtime/config consistency, CI web build/typecheck/browser invocation, and the live SDL exposure. Preserve stable check IDs and stop one check after two failed implementation attempts; continue independent checks.
3. Declare/install the required typecheck and Playwright packages through the normal implementation change, then use package scripts so CI never downloads a missing compiler ad hoc.
4. Keep the homepage Playwright smoke executable. Keep all nine T-112 flows skipped with explicit missing dependency/task reasons; skipped cases are prepared scenarios, not passed E2E.
5. Do not run real mail, external services, destructive flows, or any server command containing `migrate deploy`.
