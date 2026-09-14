# Task 3 minimal auth dispatch readiness

Date: 2026-09-14  
Status: **ready as a bounded implementation sequence; no new owner decision is
required for the local/synthetic closure described here.** This is planning,
not implementation, task acceptance, a stopped-check recovery, or evidence
that T019, T021, T022, T023, or T112 is done.

## Exact dependency result

The smallest honest dependency graph for SSR `me`, a real named `auth`
middleware, and eventual web typecheck recovery is:

```text
T008 generated GraphQL types ─→ full T011 role/schema acceptance ─→ T012 sessions + hashed links
                                      │                              │
                                      └─→ T019 full schema ─→ T021 mail

T009 private Nuxt BFF ────────────────────────────────┐
T012 persisted auth state ────────────────────────────┼─→ T022 request/verify login
T021 mail delivery/history ───────────────────────────┘             │
T012 persisted sessions ────────────────────────────────────────────┼─→ T023 cookie/rotation/logout
                                                                   └─→ SSR-safe `me` state
                                                                        └─→ named `auth` middleware
                                                                             └─→ five diagnostics removable
```

T009 and T008/T011/T012 may be prepared independently. T022 cannot be accepted
before its declared T012, T021, and T009 dependencies. T023 cannot be accepted
before T012 and T022. T021 declares T019 as a dependency, and T019 declares
T011. These edges come from the task files and cannot be weakened merely to
obtain a green typecheck.

There are two distinct completion levels:

1. A **causal interface milestone** may implement only the mail persistence and
   transport pieces needed by login, then the BFF/session/current-user path.
   This can remove the five missing-middleware diagnostics honestly if the
   behavior below is real and tested. It must leave T019 and any transitively
   dependent task marked partial while full dependency criteria remain open.
2. **Backlog task acceptance** requires every task's full result and acceptance
   criteria. Because T019 contains jobs, AI-process history, mail history,
   backend errors, legal-text versions, and user consents, a mail-only migration
   is not full T019. Consequently, full T021/T022 acceptance cannot be claimed
   from the causal subset alone. No dependency waiver is present in the
   approved documents.

This distinction closes the M5 planning gap without pulling admin screens,
workers, real legal copy, mail deliverability, or the whole T112 matrix into a
typecheck repair.

## Exact task clauses and minimum usable slice

| Task | Declared dependency and full result | Full acceptance criteria that remain intact | Minimum interface needed by auth closure | Status boundary |
|---|---|---|---|---|
| T019 | Depends on T011. Adds schema for jobs, AI-process log, mail history, backend-error records, legal-text versions, and user consents. | Schema review proves no secret/token fields in mail history or error records; migration is rehearsed on a copy. | Login needs durable mail history with recipient, subject, redacted rendered content, status, provider/message identity, and timestamps; consent needs version identifiers and recorded acceptance. Synthetic legal-version fixtures may be used, without adding real legal text. | A mail/consent subset is a prerequisite interface only. It does not complete T019, and it does not authorize jobs, AI, errors, legal UI/content, or admin sections. |
| T021 | Depends on T019. Provides one `mail` interface plus `smtp`, `console`, and `fake`; every message is recorded and emits `mail.queued`, `mail.sent`, or `mail.failed`; login links go through this module rather than server logging. | A login message appears both in history and the local SMTP receiver; a failing fake records `mail.failed` and returns `PROVIDER_UNAVAILABLE: mail`. | `send(template, to, params)` with a deterministic login template, history persistence with magic-link secret removed from the stored/admin-visible copy, and local/fake transports. Logs contain `template`, `messageId`, and status, never the address or token. | Unit-only fake delivery is enough to develop T022, but full T021 still needs the local SMTP plus history acceptance. A real provider, SPF/DKIM/DMARC, newsletters, retries UI, and production deliverability are excluded. |
| T022 | Depends on T012, T021, T009. Implements the single registration/login flow on `/login` and `/auth/verify`, including archived-account branches and auth events. Rotation belongs to T023. | All documented `login.md` and `verify.md` states are reproducible in Playwright; link-request responses are indistinguishable for existing and absent addresses; an archived account reaches its approved state. Resolver tests and flow #1 evidence remain required. | Request stores only a token hash and sends via T021. Verify consumes a one-use 15-minute link, creates a first account as `reader/free` with consent/version data, or returns the existing account outcome. The BFF result is a typed account/session outcome and exposes no browser-managed token. `self` archive yields a limited-session outcome; `admin/emergency` yields no session. | Resolver/BFF operations may land before page polish, but that is partial T022. A console-printed link, token-returning legacy payload, identical TypeScript cast, or mocked current user is not closure. |
| T023 | Depends on T012 and T022. Adds refresh rotation/reuse detection, logout/logoutAll, revocation, and the BFF-owned httpOnly cookie. | Reuse of an old refresh revokes all user sessions and records `session.reuse_detected`; Playwright proves the cookie is unavailable through `document.cookie`; logoutAll leaves no sessions under the approved all-sessions rule. | BFF issues/rotates/clears `Secure`, `httpOnly`, `SameSite=Lax` site cookie; revoked/expired state becomes visitor; server reads role and plan fresh from the database; BFF `me` returns a credential-free typed state during SSR and client navigation. | A cookie helper alone is partial. T023 is not complete without persisted rotation, chain/user revocation, logout paths, and its exact tests. `/me/sessions` UI remains T025 and is unnecessary for this closure. |

T019's full scope is a real acceptance dependency, but it is not all causal
source needed to make the named guard work. If the controller dispatches only
the causal slice, reports must say “T019 prerequisite interface implemented;
T019 remains incomplete,” and the same for downstream tasks whose full AC were
not run.

## Minimum SSR `me` and named-middleware contract

The web boundary must be implemented after T023 supplies the cookie lifecycle:

1. The browser calls only the relative Nuxt `/api/graphql` endpoint from T009.
   Private upstream address and credentials remain server-only. Browser storage,
   payloads, hydrated state, and JavaScript do not contain access or refresh
   tokens.
2. One SSR-safe current-user loader calls the BFF `me` operation with the
   incoming request cookie on SSR and the browser-managed cookie on later
   navigation. Its generated GraphQL type comes from T008 rather than a manual
   role union or unchecked cast.
3. The loader exposes a typed state with three semantic outcomes: visitor,
   authenticated account, and limited self-archive session. Internal names are
   an implementation choice; the distinctions and data provenance are not.
   The authenticated account includes the approved `me` identity and fresh
   database role/plan. The limited state contains only what is required to
   route to `/me/archived`; it is not treated as a normal account.
4. `web/app/middleware/auth.ts` awaits that state during SSR and client
   navigation. Visitor requests to the five existing `/me` pages redirect to
   `/login?next=<relative route>`. Limited sessions redirect to
   `/me/archived`. A normal authenticated session proceeds. Page-specific role,
   ownership, plan, and staff-account rules remain server/page concerns and are
   not collapsed into this authentication guard.
5. The five existing declarations remain in:
   `web/app/pages/me/index.vue`, `web/app/pages/me/articles/index.vue`,
   `web/app/pages/me/articles/new.vue`,
   `web/app/pages/me/articles/[slug].vue`, and
   `web/app/pages/me/articles/[slug]/edit.vue`. The obsolete no-op global
   placeholder must be removed or made deliberately non-overlapping; a second
   fake guard is not permitted.

The approved page behavior is unambiguous: `/me` without a session redirects
to `/login?next=/me`; a limited self-archive session redirects to
`/me/archived`; expired or revoked sessions behave as visitor requests.
Administrative archive creates no session. Authorization still executes on
the server before role/plan/object/limit checks; hiding UI is not enforcement.

## Approved policy and numeric choices

No new owner input is required for the minimum local/synthetic implementation.
The documents already establish these rules:

| Choice | Current authority | Dispatch treatment |
|---|---|---|
| Magic link is the only login; passwords/OAuth absent | ADR-0022 and approved session policy | Fixed. Do not add providers or password recovery. |
| Magic-link lifetime and one-use/hash behavior | Session policy: 15 minutes, stored hash, repeat is `NOT_FOUND` | Fixed for this chain. |
| Browser session boundary | Approved G2 session policy plus ADR-0023 | Fixed: same-origin BFF and httpOnly cookie; no browser token state. The later G2 policy controls where older implementation text differs. |
| Cookie attributes | ADR-0023 | `httpOnly`, `Secure`, `SameSite=Lax`; mutation origin checks and Yoga CSRF header remain required. |
| Role/plan freshness | Session policy rule 8 and ADR-0009 | Read from the database on every authenticated request; no role claim as authority. |
| Revocation and reuse | ADR-0009, session policy, T023 AC | Rotate hashes; old-token reuse revokes all user sessions for T023 acceptance; logoutAll means none remain. |
| Limited self-archive behavior | G2/G3 session, route, verify, and archived-state specs | Behavior is fixed. `Session.limited` is an approved implementation assumption, so another equivalent persisted representation is allowed only if it proves the same boundary; this is not a missing product decision. |
| Login rate limits | Approved G2 `rate-limits.md` rule 3 | Current project constants are 5 link requests/hour/e-mail, 20/hour/IP, and 10 verify attempts/hour/IP. They remain explicitly labelled assumptions, but they are the present documented values. They supersede ADR-0024's older 3/15-minute and 10/hour draft figures. Do not invent alternatives. |
| Access/refresh duration | ADR-0009 and approved session policy | Use the documented 15-minute access and 30-day inactivity expiry through existing configuration for T023 work. The policy still labels timing as an assumption; the schema stores `expiresAt`. No new numeric choice is needed for the guard/typecheck slice. |
| Device cap | Session policy lists “up to 10” as an assumption | Not required by T023's three AC or the named guard. Do not add it to this closure. |
| Mail provider/domain | ADR-0024 calls production provider/domain a later owner gate; T021 explicitly excludes a real provider | Not a local/synthetic blocker. Use local SMTP, console, and fake. Production provider, deliverability, and domain setup remain unselected and outside this dispatch. |
| Real legal text | T019/flow require versioned consent, but real copy is outside this closure | Use synthetic version fixtures for tests. Do not author legal content or claim the full legal-text product complete. |

The documents contain no exact missing clause that requires an owner answer for
SSR `me`, the visitor/limited redirects, token storage, cookie attributes,
rotation/revocation, or local mail testing. Remaining `[ДОПУЩЕНИЕ]` labels are
recorded implementation/default limits, deferred presentation, or production
operations; none justifies stopping this narrow implementation chain. If a
future task wants different numeric values or a production mail provider, that
is a separate decision and does not block M5's synthetic auth closure.

## Focused implementation and acceptance sequence

1. **Bind foundations:** accept T009; complete T008/T011/T012 in their existing
   scopes, including generated role types, hash-only magic links, persisted
   sessions, and disposable PostgreSQL rehearsal. Do not run ordinary server
   `build` if it performs migration deploy.
2. **Create the smallest mail/consent schema slice:** additive migration and
   repository interfaces needed by login, with secret-free history and
   synthetic consent versions. Run schema review and disposable-copy rehearsal.
   Record T019 partial unless every T019 entity and AC is actually complete.
3. **Implement T021 transport boundary:** fail first on fake transport/history
   assertions; add smtp/console/fake and login mail; verify local SMTP plus DB
   history and the failing-fake `PROVIDER_UNAVAILABLE: mail` path. No real
   network/provider is needed.
4. **Implement T022 resolvers and BFF outcomes:** test uniform request response,
   hash-only one-use token, first/existing account, consent, invalid/used/expired
   links, and both archive branches. Then exercise the documented login/verify
   state table with local mail and browser fixtures. Keep rotation out until
   T023.
5. **Implement T023 transactionally:** tests cover initial issuance, rotation,
   old-token reuse, expiry/revocation-as-visitor, logout, logoutAll, and limited
   session. Browser acceptance proves same-origin BFF, cookie flags,
   `document.cookie` invisibility, CSRF refusal, and SSR `me` freshness.
6. **Add current-user state and named guard:** focused Nuxt tests cover direct
   SSR entry and client navigation for visitor/authenticated/limited outcomes,
   relative `next`, no hydration token, and no duplicate global redirect. Keep
   page role/plan checks separate.
7. **Recover the existing Task3 check only after all nine diagnosed causes are
   removed and the controller authorizes the same stopped check.** Run the
   documented web typecheck once on the exact final revision with raw output and
   dirty fingerprint. Passing narrow auth tests does not reset the retained
   `task3-web-typecheck:2` or `task3-independent-review:2` history.

Each backlog task keeps its own required evidence and independent review. A
shared integration scenario may support several tasks, but it cannot replace a
task's missing database, local SMTP, browser-state, or migration criterion.

## Explicit exclusions and dispatch facts still needed

This brief does not authorize admin/archive UI, jobs or workers, AI/mail/error
admin sections, mail retry screens, newsletters, real legal text, new auth
providers, payments, production SMTP/provider credentials, or the remaining
T112 flows. T025 session-list UI is also unnecessary.

No product-policy decision is missing. Before each source dispatch the
controller still needs operational facts, not owner input: fresh HEAD and dirty
scope; exact current SDL/generated-type state; accepted T009/T008/T011/T012
artifacts; a disposable PostgreSQL target and migration history; and local
Mailpit/fake test configuration. These must be established by the corresponding
task without reading production credentials or databases.

This preparation read only the existing task/spec/ADR documents and the prior
Task3 cause/critical-path analyses. It performed no source query, edit, test,
build, browser, network, database, mail, Neon, API, model, native, index, or HEAD
operation.
