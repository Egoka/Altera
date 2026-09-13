# Task 3 recovery cause analysis

Date: 2026-09-13  
Execution worktree: `/private/tmp/altera-agent-loop-autonomy`  
Analyzed HEAD: `62567862027b3a0ba056a916f9f1466214fcc55e`

## Status and limits

This is a read-only cause analysis. It is not a third implementation, typecheck, browser, or review attempt. No product source, configuration, index, or commit was changed, and none of the stopped checks was run.

The stopped counters remain:

- `task3-web-typecheck: 2`
- `task3-independent-review: 2`

The retained browser RED remains one failed title assertion with nine skipped tests. This document does not change any acceptance result.

Evidence limits that a recovery implementer must preserve:

- Raw output from the two web typecheck attempts is absent. The retained reports consistently record nine diagnostics and exit 2, but only summarized diagnostic text is available.
- The retained typecheck report misnames two of the five pages with `middleware: ["auth"]`: `create.vue` and `settings.vue` do not exist at analyzed HEAD. Immutable HEAD inspection identifies the actual five pages listed below. The total of five auth diagnostics is reconcilable; the old path list is not exact evidence.
- There is no accepted current-user/session interface in the web app from which an honest auth middleware can be implemented. The only apparent auth logic is commented-out placeholder code.
- The original checkout was reported at `82d3b96a048cc25b32d9375dcf5a80c3e6912bbb`, and that revision overlaps `Author.vue`, `Type.vue`, and `pages/index.vue`. Trace later reported a moving/stale original index. Recovery must remain isolated or re-audit those exact files before integration; this analysis does not assume the original checkout's state.

## Exact causes and minimal cause-removal changes

| Failure | Root cause | Minimal concrete change | Scope and prerequisite |
|---|---|---|---|
| `web/app/components/show/Author.vue:10:6` | The `link` prop is declared `Date | string`, while `NuxtLink.to` accepts a router location. Known callers construct string paths. | Change the prop to `RouteLocationRaw` and import that type from `vue-router`. A stricter `string` also fits current callers, but `RouteLocationRaw` matches the component boundary. | Runtime-preserving product-source type repair. It does not invent behavior, but it is outside the strict original T001 CI/config-only scope and needs a narrowly authorized recovery change. |
| `web/app/components/show/Type.vue:10:6` | Same invalid prop contract as `Author.vue`. | Apply the same `RouteLocationRaw` prop type repair. | Same scope condition as `Author.vue`. |
| `web/app/error-t.vue:71:47` | The template calls `$router.go(-1)`, but `$router` is absent from the inferred setup component instance. | Add `const router = useRouter()` in `<script setup>` and call `router.go(-1)` from the template. This retains the current back-navigation behavior. | Runtime-preserving product-source repair; outside strict T001 scope, but no new product behavior is needed. |
| `web/app/pages/[slugTypeContent]/[slugArticle].vue:8:24` | `route.params.slugArticle` has router type `string | string[] | undefined`, while `HeaderTag` requires a string name. | Normalize the param in a computed value, selecting the first array item and falling back to `""`; pass that computed string to `HeaderTag`. Do not use an unchecked cast. | Product-source type repair; outside strict T001 scope. The fallback policy is already implicit in rendering an absent label, but should be reviewed as a narrow recovery change. |
| Five named-middleware diagnostics | Five pages declare `middleware: ["auth"]`, but no named `web/app/middleware/auth.ts` exists. The existing `auth.global.ts` is a no-op whose intended current-user and role checks are commented out. | After the auth contract exists, add a real named `auth.ts` that reads the accepted session/current-user source and redirects unauthenticated users according to the accepted login/return-url contract. Keep the five page declarations. Decide whether `auth.global.ts` is removed or repurposed only as part of that architecture decision. | Cannot be removed honestly inside the current Task 3 scope. Requires T-022/T-023 prerequisites: accepted session/current-user source, unauthenticated redirect behavior, cookie/session lifecycle, and role policy. A no-op named middleware, removing page declarations, renaming the global placeholder, or type augmentation would only conceal missing protection. |
| Homepage browser title | `web/app/pages/index.vue`, `web/app/app.vue`, and `web/nuxt.config.ts` provide no homepage/global title. The retained browser expectation is exactly `Altera`, and the actual title is empty. | Add `useHead({ title: "Altera" })` to `web/app/pages/index.vue`. Page-local metadata is the smallest change and does not impose a title on unrelated routes. | The value is already fixed by retained test/product evidence, so no behavior needs to be invented. It is still a product metadata edit outside the strict original T002 test-scaffolding scope and must be treated as an explicitly authorized narrow recovery. Reconcile with the overlapping original-checkout edit before integration. |
| Flow 16 wrong modal context | The flow opens the article cascade modal, then navigates to category and last-owner pages for conflict checks. The transactional-delete step immediately fills article modal fields while still on the last-owner page. The earlier reason field is also lost on navigation. | At the start of the transactional-delete step, navigate back to `/admin/articles/permanent-delete-fixture`, re-establish the archived article state, reopen permanent delete, fill both exact name `Permanent delete fixture` and reason `Fixture cleanup`, then confirm. | Fully within T-112 preparation scope. It is a static scaffold repair under the existing early skip and invents no product/auth behavior. Execution still requires T-076 plus isolated destructive fixtures for owner, archive state, blockers, relations, audit, and slug/handle reservation. |

The exact five pages declaring the missing named middleware at analyzed HEAD are:

- `web/app/pages/me/index.vue`
- `web/app/pages/me/articles/index.vue`
- `web/app/pages/me/articles/new.vue`
- `web/app/pages/me/articles/[slug].vue`
- `web/app/pages/me/articles/[slug]/edit.vue`

Representative proposed local type changes are:

```ts
import type { RouteLocationRaw } from "vue-router"

defineProps<{
  link: RouteLocationRaw
  name?: string
}>()
```

```ts
const router = useRouter()
// template: @click="router.go(-1)"
```

```ts
const slugArticle = computed(() => {
  const value = route.params.slugArticle
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
})
```

```ts
useHead({ title: "Altera" })
```

## Scope verdict

Flow 16 can be corrected entirely within the existing T-112 preparation scope without inventing product or auth behavior.

The title and four non-auth type diagnostics have minimal, behavior-preserving cause removals, but those changes edit product source and exceed the strict original T001/T002 CI-and-scaffolding scope. They are suitable only for an explicitly bounded recovery change. The homepage title value is already established by the retained RED expectation, so its repair requires no new product decision.

The five auth diagnostics cannot be removed honestly within the existing scope. A real fix depends on the T-022/T-023 session and authentication contract. Consequently, all nine diagnostics cannot be cleared within strict current scope without inventing or bypassing auth behavior. Even after an authorized four-diagnostic recovery, the five auth diagnostics and aggregate CI acceptance must remain open until those prerequisites land.

## Evidence required for a later recovery

1. Before editing, record exact execution HEAD, dirty-scope manifest, and hashes of every touched file. Preserve the two stopped counters rather than resetting them implicitly.
2. For the four non-auth diagnostics, limit the diff to the exact symbols above. Only after the controller explicitly authorizes/resumes the stopped check should the implementer run the same `task3-web-typecheck` check once and save its exact command, raw output, exit code, HEAD, and dirty fingerprint under the existing check identity. With auth still absent, five diagnostics should remain; that is useful cause-isolation evidence, not acceptance.
3. For the title, retain `task-3-fix1-browser-title-red.txt` as RED evidence. After the authorized page metadata change and an explicit check resume, run the same title-focused browser check once and retain raw output. The expected result is one passed title assertion and nine skipped tests; this analysis did not execute it.
4. For flow 16, review the static sequence against the permanent-delete flow source: article navigation and modal reopening must occur after both blocker-page visits, and exact name plus reason must be refilled before confirmation. A targeted lint/format check is sufficient while the T-076 skip and destructive-fixture prerequisites remain. Do not run the destructive flow against a real database.
5. `task3-independent-review` remains stopped at two attempts until the controller explicitly resumes it after independent cause removal. This diagnosis is neither that review nor acceptance.

## Addendum: approved auth policy versus missing implementation

This addendum corrects the earlier wording about an “accepted auth contract.” The product policy is approved and is not an owner-input blocker. `docs/spec/50-access/session-lifecycle.md` has status “approved (gate G2)” and already establishes the relevant behavior: the browser uses a Nuxt BFF with an httpOnly cookie, browser JavaScript does not hold tokens, expired or revoked sessions become visitor requests, `/me` without a session redirects, role and plan are read fresh from the database, and limited archived-account sessions are redirected to `/me/archived`. T-009, T-012, and T-021 each explicitly require no owner decision; the controller confirms the same for T-022 and T-023.

What is missing is an implemented interface that carries that approved policy into Nuxt route middleware:

- `server/src/prisma.ts` has a legacy `GraphQLContext.currentUser`, populated from an `Authorization: Bearer` access token, and `Query.me` consumes it. That is a server-side precursor, but it is not the approved browser session boundary and cannot be used as-is because browser JavaScript tokens are forbidden.
- `web/app/query/common/auth.ts` still models token-returning login/refresh operations, and its `verifyMagicLink` selection requests `token` while the current SDL exposes `accessToken` and `refreshToken`. This is legacy/incomplete implementation evidence, not an undecided policy.
- The web app has no auth composable or SSR-safe current-user state. Both `auth.global.ts` and `admin.ts` are commented-out placeholders. Therefore a named `auth.ts` has nothing honest to read today.

The minimal dependency closure for a real named middleware is implementation work only:

1. Complete T-009: browser GraphQL traffic goes through Nuxt `/api/graphql`, with server-only API address and CSRF handling.
2. Complete T-012 after its T-011 prerequisite: persisted sessions and hashed magic-link tokens provide the approved storage boundary.
3. Complete T-021 after its T-019 prerequisite: magic-link delivery uses the mail interface. This is a transitive login prerequisite, not middleware policy.
4. Complete T-022 on T-009/T-012/T-021: implement request/verify login and expose the accepted authenticated account result without returning browser-managed session tokens.
5. Complete T-023 on T-012/T-022: issue, rotate, revoke, and clear the httpOnly session cookie through the BFF, and make the authenticated `me` result available during SSR and client navigation.
6. Add one SSR-safe web auth state/composable backed by that BFF `me` result. Then implement named `web/app/middleware/auth.ts` to await/read it and apply the approved unauthenticated and limited-session redirects. `admin.ts` may use the same fresh state for its separate role check. Resolve the obsolete no-op global placeholder deliberately so it does not duplicate the named guard.

No additional owner input is necessary for that closure. The implementation must follow the approved G2 rules and the existing task dependency order. A no-op named middleware, removal of `middleware: ["auth"]`, unchecked casts, browser token storage, or diagnostic suppression remains invalid.

The controller also ruled that the renewed request already authorizes the four narrow type repairs, the existing `Altera` title, and the flow 16 context repair in the isolated recovery. The earlier statements that those changes need additional authorization are superseded. They remain queued until the sole runtime writer finishes; this addendum performs none of them. The retained failure and review counters are unchanged.
