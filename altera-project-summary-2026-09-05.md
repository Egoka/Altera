> **Исторический документ.** Срез на коммите `e1b9a97` заменён проверенным срезом реальности [docs/vision/00-reality-check.md](docs/vision/00-reality-check.md) (коммит `8cb987c`, 2026-09-05); расхождения перечислены там в §8.

# Altera — Project State Summary
**Revision**: HEAD `e1b9a97da23e02de9a3fb3e801e323531b08c825` · Branch `server/api` · Date 2026-09-05

Source: architect review (ALTE-2) + independent tester verification, same snapshot.

---

## Stack (verified)

| Layer | Technology | Version |
|---|---|---|
| Frontend | Nuxt + Vue | 4.0.0 / 3.5.17 |
| Styling | Tailwind + FishtVue | 4.1.11 / 0.2.11 |
| State | Pinia + VueUse | — |
| API | GraphQL Yoga (Node HTTP) | — |
| ORM | Prisma | 6.12 |
| Database | Neon PostgreSQL | — |
| Cache | Redis (ioredis) | required at import, no fallback |
| Runtime | Node.js | 24.12.0 (local) |
| Package manager | pnpm workspace | — |

---

## Subsystem Status

### Implemented and functional
- **Visual UI foundation**: app shell, header/mega-menu/footer, dark/light theme, EN/RU toggle, fonts, Tailwind theme, article cards, responsive/scroll composables, showcase pages.
- **Server GraphQL resolvers**: public article/author/tag/content-type queries, auth `me`/`myArticlesStats`, author lifecycle (create/update/archive/requestReview/revert), admin list/filter/sort/pagination for articles/users/tags/content types, admin status transitions and bulk operations, tag merge, content type CRUD/reorder/archive.
- **Prisma schema**: `User`, `MagicLinkToken`, `Article`, `ContentType`, `SectionTag` + 4 migrations; statuses draft/review/published/archived; roles reader/author/editor/admin.
- **Auth foundation**: cryptographically random single-use expiring magic-link tokens; JWT signature/expiry verified; ownership/role checks on most server mutations.

### Partially implemented (stubs or incomplete)
- **Home page sections** (Featured/Latest/Popular): UI built, all data from static fixtures; `Popular` has TODO comment for GraphQL.
- **Article page** (`/[slugType]/[slugArticle]`): renders route params only, no data fetch.
- **Admin WIP** (current branch, uncommitted): layout, sidebar, article/tag/type/user tables with local static data; user save writes to a local array + console.log only.
- **Auth guards**: `auth.global.ts` and `admin.ts` middleware fully commented out — `/me` and `/admin` routes are unprotected in the UI (server-side admin resolvers still check role independently).
- **`featuredArticles`**: returns latest published, not true editorial picks.
- **`popularArticles`**: latest by time window, no real popularity metric; view/share counters always 0.
- **Redis cache**: present but cache key for admin search does not include the search term (different searches can share one cached result); update/rename/status changes don't invalidate all related caches; bulk invalidation uses blocking `KEYS`.

### Stubs / not implemented
- **MDC editor and rendering**: no `@nuxt/content` or MDC dependency, no editor, no preview/render pipeline, no component allowlist, no media upload. `Article.body` is a plain `String`.
- **Email delivery**: magic link URL is printed to server log; no email service.
- **Web ↔ API connection**: 35 GraphQL operations exist in `web/app/query/` but no GraphQL client/plugin is installed, no runtime API URL, no `useFetch`/`useAsyncData` consumer; web and API are disconnected.
- **GraphQL contract alignment**: of 35 web operations, only 10 validate against the actual server schema; 25 are mismatched (missing resolvers, wrong argument names, wrong return types). Web role enum (`user|admin`) differs from server (`reader|author|editor|admin`).
- **Auth flow (refresh/revoke/logout)**: refresh token is issued but no refresh/revoke/logout/session-storage flow exists.
- **Auth pages** (`/login`, `/auth/verify`): absent. Auth layout exists but has a temporary placeholder element.
- **Rate limiting / abuse protection**: none at any layer.
- **Access control gaps**: `article(slug)` returns draft/review/archived articles to any caller; `user.email` is exposed on public `User` type.
- **Search / navigation API**: not in server schema.
- **Admin user management**: list only; no role change or profile edit.
- **Personal cabinet** (`/me`, `/articles/new`, `/articles/:id`): 12-line route stubs.
- **Database seed** (`prisma:seed`): references `seed/seed.ts` which does not exist.
- **Tests**: no `*.test.*` / `*.spec.*` files, no Vitest/Jest/Playwright config in any package; `pnpm test` exits 0 but runs zero tests.
- **Web typecheck** (`nuxi typecheck`): fails — `vue-tsc` not installed; Node 24 incompatibility with the fallback package.
- **CI**: GitHub Actions runs only for PRs to `app`; `timeout 2s pnpm start || true` masks startup failure; no web build/typecheck, no real tests.
- **Deploy manifests**: no Docker/Compose/Vercel/Render/Fly configs; no healthcheck, migration/rollback/restore procedure.

---

## Key Gaps

| Gap | Impact |
|---|---|
| Web disconnected from API | No real data in any public or admin page |
| 25/35 web GraphQL ops invalid | Any future integration attempt will hit contract mismatches |
| Draft/PII exposure via public `article(slug)` and `user.email` | Security: drafts and emails readable without auth |
| No rate limit / magic-link abuse protection | Security: account enumeration, spam |
| MDC editor absent | Core product feature missing |
| Auth middleware commented out | UI routes unprotected |
| No tests, broken CI | No automated verification |
| Migration risk (enum cast on non-empty DB) | Deployment to existing data may fail |
| Redis mandatory, no fallback | Service fails if Redis is unavailable |

---

## Open Architectural Questions

1. Who can register and write (open vs invited)?
2. Is user email public information?
3. Can editors moderate articles from other authors?
4. What constitutes "featured" and "popular"?
5. What MDC components are allowed in articles?
6. Storage/media provider for uploads?
7. Refresh token revocation strategy?
8. Redis: mandatory dependency or cache-aside with fallback?
9. `CreateContentTypeInput.status` default: enum case mismatch (`ACTIVE` vs lower-case enum) — no runtime default applied.

---

## Recommended Sequence (from architect)

1. Agree on a single GraphQL contract and generate client types for both sides.
2. Close draft/PII exposure; complete magic-link/session lifecycle (refresh/revoke/logout).
3. Connect public web pages to the API.
4. Implement MDC editor, render pipeline, and upload boundary.
5. Finish personal cabinet, admin CRUD, search, and navigation.
6. Add behavior/API/auth/cache/e2e tests; make CI honest.
7. Then fix deploy target, migration path, and rollback plan.

---

## Verification Notes (tester, same snapshot)

- `server tsc --noEmit`: **pass** (exit 0, no diagnostics)
- `server eslint src --ext .ts`: **pass** (exit 0, no diagnostics)
- `web eslint app`: **fail** — unused `mockStats` in `web/app/pages/types/index.vue:105`
- Web typecheck (`vue-tsc`): **gap** — `vue-tsc` not installed; Node 24 incompatibility with fallback
- Automated tests: **none** — `test` scripts absent in `server/package.json` and `web/package.json`
- Playwright browser check: **completed with findings** — Altera confirmed at `127.0.0.1:3100`; the home page rendered and navigation to `/popular` worked. `/_ipx/_/images/Sport.png` and `/_ipx/_/images/Art.png` returned HTTP 500 due to a pre-existing IPX/static-content defect; screenshot evidence is attached to ALTE-2.
- Context7 Vue docs lookup: confirms `vue-tsc` is the recommended CLI typecheck tool for SFCs — consistent with the setup gap finding

---

*Generated by Altera — хранитель документации for ALTE-2. Facts sourced from architect review and independent tester verification on branch `server/api` HEAD `e1b9a97`.*
