# T-008 — generated GraphQL types implementer brief

> Preparation only. Inspected execution HEAD `89290c074b895edbe163ebbb626e80d9db4cbcff` with an unrelated modified execution report and existing untracked D1/evidence paths. This brief neither incorporates nor changes that work. No package install, network, check, database, environment, auth, model, Multica, source, index, or HEAD operation was run.

## Required outcome

`server/src/graphql/**/*.graphql` remains the sole API contract. The frontend consumes committed generated TypeScript types and `TypedDocumentNode` values; hand-written schema enums and response shapes are removed. Root command `pnpm codegen --check` must pass on committed output and fail when SDL or a `.graphql` document changes without regeneration.

T-008 supplies generation and drift detection. T-010 still owns moving and rewriting all legacy operations from `web/app/query/**/*.ts` into `web/app/graphql/**/*.graphql`; T-009 supplies the BFF transport. Do not add a GraphQL client in T-008.

## Current evidence

- Root `package.json` has no `codegen` script and no GraphQL Code Generator packages. `web/package.json` has build, typecheck, Vitest, and Playwright scripts but no codegen dependency or command.
- `web` declares neither `graphql` nor `@graphql-typed-document-node/core`. The lockfile contains `@graphql-typed-document-node/core@3.2.0` only transitively through server GraphQL tooling; it is not an honest web dependency.
- There is no codegen config and no `web/app/graphql` document tree. The current 13 operation-bearing source files remain template strings under `web/app/query`; the barrel and `query/types.ts` make 15 files in that tree.
- Manual schema duplicates exist in `web/app/types/{article,contentType,sectionTag,user}.ts` and `web/app/query/types.ts`. The role unions currently disagree: `"user" | "admin"` versus `"reader" | "author" | "editor" | "admin"`; the SDL currently has the latter four values. T-011 will later add `moderator`, `analyst`, and `owner`, and should make `codegen --check` red until output is regenerated.
- Trace found the live type consumers. `User` is imported by `components/header/user.vue` and `pages/authors/[slug].vue`; `ArticleListItem` by `components/article/author.vue` and the author page; `ArticleResponse` by 14 article/demo/page files; `PopularArticleData` by `components/article/text.vue` and `components/pages/start/Popular.vue`; `ContentType` by `components/header/type.vue`, `pages/types/index.vue`, and `pages/[slugTypeContent]/index.vue`; `SectionTag` by `components/header/tag.vue`. The remaining declarations in those five manual files have no indexed external use.
- Generated types will expose real SDL nullability. For example, article `dek`, `excerpt`, `featuredImage`, and `publishedAt` are nullable, while several manual view types claim non-null strings. Fix touched consumers with explicit guards/defaults; do not use casts to retain a false contract.

## Minimal implementation

1. Add explicitly pinned root dev dependencies `@graphql-codegen/cli`, `@graphql-codegen/typescript`, `@graphql-codegen/typescript-operations`, and `@graphql-codegen/typed-document-node`. Add direct web dev dependencies `graphql` and `@graphql-typed-document-node/core`; do not rely on their current transitive lockfile entries. Update `pnpm-lock.yaml` through the authorized package-manager install.
2. Add root `codegen.ts` with:
   - `schema: "server/src/graphql/**/*.graphql"` (local files, never a running server or remote URL);
   - `documents: "web/app/graphql/**/*.graphql"`;
   - one committed output such as `web/app/graphql/generated.ts` using `typescript`, `typescript-operations`, and `typed-document-node`;
   - `ignoreNoDocuments: true` so T-008 can precede the full T-010 move;
   - deterministic options including `enumsAsTypes: true` and a concrete `JSON` scalar mapping such as `Record<string, unknown>`.
3. Add root script `"codegen": "graphql-codegen --config codegen.ts"`. Arguments must pass through so the exact accepted command is `pnpm codegen --check`. Do not attach generation to `prepare` or a package install; generated output is committed and CI verifies it.
4. Add real frontend fragments under `web/app/graphql/fragments/`, sufficient to replace active manual shapes without moving legacy operations:
   - an author/profile fragment for the fields consumed by `HeaderUser` and its current author-page fixture;
   - an article-card fragment for the fields consumed by article card components;
   - a popular-article fragment;
   - content-type and section-tag summary fragments.
   This gives `typescript-operations` and `typed-document-node` real documents to generate and validates the component-facing selections against SDL. It avoids a meaningless health-check operation and stays short of T-010's operation migration.
5. Generate and commit `web/app/graphql/generated.ts`. Update the traced consumers to import generated fragment types. Change the author fixture's obsolete `role: "user"` to the current generated `reader` value. Where UI-only data is real (for example current `ContentType.iconUrl`, which is absent from SDL), define a narrowly named view-model extension such as `ContentTypeSummaryFragment & { iconUrl?: string }`; never copy the GraphQL fields or enum into another interface.
6. Delete `web/app/types/article.ts`, `contentType.ts`, `sectionTag.ts`, `user.ts`, and `web/app/query/types.ts` after every active import is migrated. Leave the template-string operation files and their barrel for T-010. A generated union is allowed because SDL produced it; no hand-written role/status union remains.
7. Keep generated output out of hand-written style enforcement by adding its exact path to `.prettierignore` and the web ESLint ignore list, unless the selected generator is proven to emit bytes that pass both existing format and lint unchanged. Do not run a formatter after generation if that makes `codegen --check` compare against different bytes.
8. Add `pnpm codegen --check` to `.github/workflows/pull_request.yml` after the frozen install in the existing `checks` job. The aggregate `test` job already depends on `checks`, so no new terminal job is needed.

Expected source/config scope:

- `package.json`, `web/package.json`, `pnpm-lock.yaml`, `codegen.ts`;
- `.github/workflows/pull_request.yml`, and exact generated-file ignores if required;
- `web/app/graphql/fragments/*.graphql`, `web/app/graphql/generated.ts`;
- deletion of the five manual type files above;
- only the traced import consumers and the nullability handling directly required by their generated fragment types.

## Legacy auth query ruling

Do **not** fix or move the token/auth template strings in T-008.

Current `web/app/query/common/auth.ts` is invalid against current SDL in several ways: `requestMagicLink` selects `{ success message }` from a `Boolean!`; `verifyMagicLink` selects `token` while `AuthPayload` exposes `accessToken` and `refreshToken`; and the file declares `logout`/`refreshToken` operations absent from the SDL. Merely changing `token` to `accessToken` would preserve browser-managed token handling that the approved BFF/httpOnly-session work must remove.

T-010 owns moving/revalidating operations after T-008/T-009, and T-022 owns the accepted login result. Therefore T-008's document glob must not ingest `common/auth.ts`, and it must not create a temporary `.graphql` copy of those invalid operations. Record them as known downstream contract work, not a T-008 failure or an excuse to weaken document validation.

## TDD and acceptance evidence

Implement in an isolated writer and retain raw command, exit, HEAD, and dirty-scope evidence.

1. **RED: configuration absent.** Before changes, capture that root `pnpm codegen --check` has no script/tool and exits non-zero. This is T-008 evidence, not a package-install request from this preparation.
2. **GREEN: deterministic generation.** After the authorized install and implementation, run `pnpm codegen`, then `pnpm codegen --check`; the second command must exit 0 with no tracked diff. Run it again from a clean checkout to rule out local generated/cache dependence.
3. **RED: SDL drift.** In a disposable copy/worktree, add one valid nullable SDL field without regenerating and run the same `pnpm codegen --check`; require non-zero. Discard the copy. Do not mutate or restore the accepted source in place for this proof.
4. **RED: document validation.** In a disposable copy, add a `.graphql` document selecting a nonexistent field; require codegen to fail. This proves `documents` is active rather than silently generating schema types only.
5. **Single-source check.** Assert the five manual type files are absent, their old imports are absent, and no hand-written `Role`/`ArticleStatus`/`ContentTypeStatus` union remains outside generated output. Inspect generated `Role` and fragment types to prove they reflect current SDL and nullability.
6. **Repository compatibility.** Run existing format/lint and the web build/typecheck commands only under the controller's applicable check identities. Generated output must not introduce new diagnostics. Existing stopped Task-3 typecheck counters are not reset or reused by T-008, and unrelated pre-existing diagnostics cannot be reported as T-008 acceptance.

No database, server process, environment secret, BFF, auth session, or browser flow is needed for T-008 acceptance. No owner decision remains.
