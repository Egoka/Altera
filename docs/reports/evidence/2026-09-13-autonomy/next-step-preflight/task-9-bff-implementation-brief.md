# T-009 BFF proxy implementation brief

> **For the eventual implementer:** execute with TDD in an isolated worktree after the controller dispatches T-009. This brief is preparation only.

**Goal:** Route browser GraphQL calls through Nuxt `POST /api/graphql`, using a server-only upstream address and the Yoga CSRF header, without adding session or login behavior.

**Architecture:** A Nitro POST handler reads the private Nuxt runtime config and forwards a bounded set of request data to the existing GraphQL Yoga root endpoint. A small auto-imported composable always calls the relative BFF URL. A dedicated Playwright configuration starts Nuxt and a loopback-only synthetic upstream so acceptance needs no API process, database, email, network, or credentials.

**Spec:** `docs/backlog/tasks/T-009-bff-proxy-runtime-config.md`; ADR-0023; ADR-0020; route registry entry 65.

## Dispatch status and fixed boundaries

- Analyzed execution base: `a51b1116e1e2553605ab704bda2efc1cb463b31b`.
- T-009 is still a backlog candidate. This brief does not mark it ready or done.
- No source, config, index, or HEAD mutation and no test execution occurred during preparation.
- Included: private runtime config, Nitro `POST /api/graphql`, relative GraphQL composable, local synthetic-upstream acceptance, client-bundle secrecy check.
- Excluded: cookies, refresh/access lifecycle, login/logout, auth middleware, `me` state, role behavior, production upstream calls, database access, email, credentials, new dependencies, and API transport replacement.
- Do not add an operational upstream fallback. Declare a private runtime-config key with an empty fail-closed value and require `NUXT_API_BASE_URL` at runtime.
- Do not claim all ADR-0023 session/CSRF work. T-009 sets Yoga's required `x-graphql-yoga-csrf` upstream header. Cookie-bound refresh, mutation `Origin`/`Sec-Fetch-Site` enforcement, rotation, and logout remain T-023.
- GraphQL Yoga remains the API transport under ADR-0020.

## Existing interfaces at the analyzed base

- `web/nuxt.config.ts` has no `runtimeConfig` block.
- `web/server/` has no tracked route. Nuxt/Nitro auto-imports the H3 server utilities needed by a route.
- `web/app/query/index.ts` only re-exports GraphQL document strings; there is no GraphQL transport client or composable.
- `server/src/server.ts` already serves Yoga at `/`, enables `useCSRFPrevention()`, accepts only `POST`, and limits API CORS to `process.env.FRONTEND_URL`. The installed plugin's default required header is `x-graphql-yoga-csrf`. T-009 needs no server-source change.
- `web/package.json` at this base already supplies Nuxt, Vitest, Playwright, build, and test scripts. No package installation is needed.

## Exact file scope

- Modify `web/nuxt.config.ts`: add private `runtimeConfig.apiBaseUrl`, defaulting to an empty value so `NUXT_API_BASE_URL` can override it through Nuxt's standard runtime convention.
- Create `web/server/api/graphql.post.ts`: the only product route for this task.
- Create `web/app/composables/useGraphql.ts`: typed generic wrapper around `$fetch("/api/graphql", { method: "POST" })` that sends `{ query, variables }` and returns the GraphQL response envelope without inventing application error policy.
- Create `web/tests/fixtures/t009-graphql-upstream.mjs`: Node built-in HTTP fixture, bound to `127.0.0.1`, with a readiness endpoint and a POST root that validates body and CSRF header before returning `{ "data": { "__typename": "Query" } }`.
- Create `web/tests/e2e/t009-bff-graphql.spec.ts`: browser acceptance for the real Nuxt route.
- Create `web/playwright.bff.config.ts`: isolated configuration that runs only the T-009 spec and starts both the fixture and Nuxt. Reuse the existing Nuxt test port and use one explicit test-only upstream port; do not add either as product defaults.
- Create `web/tests/useGraphql.test.ts`: transport-boundary unit test for the relative URL and request envelope.
- Do not modify `server/src/server.ts`, auth sources, shared `web/playwright.config.ts`, or existing E2E flows.

## Handler contract

`web/server/api/graphql.post.ts` must:

1. Read `apiBaseUrl` from `useRuntimeConfig(event)` and fail with a clear server error before any fetch when it is empty.
2. Accept only POST by file routing and forward the raw GraphQL JSON body to the configured Yoga root URL.
3. Forward only headers needed now: `content-type`, `accept`, and an incoming `authorization` value when present. Set `x-graphql-yoga-csrf: bff` itself. Do not forward browser `host`, `origin`, `cookie`, connection, or content-length headers.
4. Preserve the upstream HTTP status, GraphQL JSON body, and response content type. Do not reinterpret GraphQL `errors` or retry requests.
5. Never expose `apiBaseUrl` through `runtimeConfig.public`, response data, browser code, or logs.

The composable interface should remain transport-only:

```ts
type GraphqlResponse<TData> = {
  data?: TData
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>
}

export function useGraphql<
  TData,
  TVariables extends Record<string, unknown> = Record<string, never>
>(query: string, variables?: TVariables): Promise<GraphqlResponse<TData>>
```

## TDD execution sequence

- [ ] Record HEAD, dirty scope, and hashes for the seven scoped files before editing.
- [ ] Add the loopback fixture, dedicated Playwright config, and `t009-bff-graphql.spec.ts`. The browser test must load the Nuxt origin, call relative `/api/graphql` with `{ __typename }`, assert status 200 and `data.__typename === "Query"`, and assert its observed browser requests contain no upstream origin. The fixture must reject a missing/wrong `x-graphql-yoga-csrf` header or body.
- [ ] Run only `pnpm --dir web exec playwright test tests/e2e/t009-bff-graphql.spec.ts --config=playwright.bff.config.ts`. Preserve the RED output; expected cause is that Nuxt has no `/api/graphql` route. Do not start the real API.
- [ ] Add private runtime config and the minimal Nitro route. Run the identical Playwright command once; preserve raw output and require the single targeted browser test to pass.
- [ ] Add `tests/useGraphql.test.ts` with a stubbed global `$fetch`. Assert the exact relative URL, POST method, query, variables, and returned envelope. Run it RED before the composable exists, then add `useGraphql.ts` and run `pnpm --dir web test -- tests/useGraphql.test.ts` GREEN.
- [ ] Build with a distinctive private sentinel, for example `NUXT_API_BASE_URL=http://t009-private-upstream.invalid/ pnpm --dir web build`. This build must make no upstream request.
- [ ] Run `rg -F "t009-private-upstream.invalid" web/.output/public`. Acceptance requires exit 1 with no match. Also inspect browser-facing payloads from the Playwright run for the same absence.
- [ ] Review the final diff against the exact file list, confirm no lockfile or auth/session change, and record commands, exits, raw logs, HEAD, and dirty fingerprint in the T-009 report. Keep backlog status unchanged until independent review and normal project gates complete.

## Acceptance evidence

The dispatch is complete only when evidence shows all of the following:

- Chromium sends the request to the Nuxt origin at `/api/graphql`; no browser request targets the synthetic upstream.
- The loopback upstream receives the original `{ __typename }` request and `x-graphql-yoga-csrf: bff` from Nitro.
- Nuxt returns the upstream status, JSON envelope, and content type.
- The composable targets only the relative BFF route.
- A production build succeeds with the private sentinel configured, and the sentinel has zero matches under `web/.output/public`.
- No real network, API server, database, mail transport, cookie, token, login, or credential is used.

## Future integration with the original UI branch

The reported original owner revision `eafe748` does not modify `web/nuxt.config.ts` and cannot conflict textually with the new server route or composable. Comparing the later Task 3 execution base directly with `eafe748` makes `web/package.json`, Playwright config, and E2E files appear removed, but that is branch divergence: the controller's owner-baseline comparison shows the owner UI work did not delete that harness. Task 3 added it only on the execution line. The owner does modify `Author.vue` and `Type.vue`, so the separate narrow type repairs need reconciliation; those files are outside T-009.

Therefore the product portion of T-009 should integrate cleanly. Its acceptance harness must be carried deliberately from the execution line rather than described as restoration of owner-deleted files. Keep the dedicated `playwright.bff.config.ts` and new T-009 fixture/spec, then reconcile the execution-line Playwright dependency and scripts with the owner's current package state. Do not restore unrelated legacy E2E flows as part of T-009. Re-run the two T-009 acceptance commands only after the controller chooses the integration order; current dirty migration documentation and lockfile work in the original checkout must remain untouched.
