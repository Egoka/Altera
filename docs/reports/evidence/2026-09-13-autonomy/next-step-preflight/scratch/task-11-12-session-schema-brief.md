# T-011/T-012 — implementer brief for the session-schema milestone

> Read-only preparation, not implementation or acceptance. Source contract was inspected at immutable execution base `a51b1116e1e2553605ab704bda2efc1cb463b31b`. During preparation the shared worktree advanced to `bbe668c59b3f3dbfe3c2a8bb0157f9e4e6e0fcff` for the separate D1 writer and had that writer's report/evidence dirt; this brief does not incorporate or modify D1. No database, migration, test, model, environment, credential, source, index, or HEAD operation was run.

## Accepted contract and current gap

The product policy is sufficient; no owner decision is needed for this milestone.

- T-011 fixes the only role set as `reader | author | editor | moderator | analyst | admin | owner`. A visitor has no session and is not a role. `reader`/`author` are ordinary accounts; the five staff roles use separate staff accounts. Several owners are allowed and application logic must prevent the last owner from being removed.
- Account archive state records time, mode (`self | admin | emergency`), actor, the actor's role snapshot, a free-form internal reason, and whether the subject is a staff account. The four reason-category names remain deferred by Q-05/T-073 and must not be added here.
- T-012 stores magic-link and refresh credentials only as SHA-256 hashes. A session stores current and previous refresh hashes, expiry/revocation/activity dates, optional raw user-agent/IP, and the approved `limited` flag. It stores no IP-derived geography. Raw user-agent and IP are later filtered from the public API; this schema milestone does not add that API.
- Self-service email change has one pending request per user: new email, hashed code, expiry, and an attempt counter. Occupancy is checked on confirmation; the active session remains. Lost-email recovery is the approved manual support/admin flow, so an automated recovery-code table would invent behavior.

At the pinned base, Prisma has only four roles; `User` has no archive/staff/session/email-change fields; `MagicLinkToken.token` is plaintext; no `Session` exists. GraphQL repeats the four roles. `web/app/types/user.ts` still defines `"user" | "admin"`, while other web mocks/types contain upper-case or four-role dictionaries. `requestMagicLink` stores the raw token and `verifyMagicLink(token)` looks it up directly. The public mutation names, arguments, result shape, first-login account creation, and one-token-per-user upsert are the legacy auth interface to preserve.

## Minimal target schema

Use technical names consistently across Prisma and SQL; the following shape is the smallest one that covers the approved requirements:

```prisma
enum Role {
  reader
  author
  editor
  moderator
  analyst
  admin
  owner
}

enum AccountArchiveMode {
  self
  admin
  emergency
}

model User {
  // existing fields and relations remain
  archivedAt       DateTime?
  archiveMode      AccountArchiveMode?
  archivedById     String?
  archivedBy       User?               @relation("UserArchiveActor", fields: [archivedById], references: [id], onDelete: SetNull)
  archivedUsers    User[]               @relation("UserArchiveActor")
  archiveActorRole Role?
  archiveReason    String?
  isStaffAccount   Boolean              @default(false)
  sessions         Session[]
  emailChange      EmailChangeRequest?
}

model Session {
  id                String    @id @default(uuid())
  userId            String
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash         String    @unique
  previousTokenHash String?
  expiresAt         DateTime
  revokedAt         DateTime?
  userAgent         String?
  ip                String?
  limited           Boolean   @default(false)
  createdAt         DateTime  @default(now())
  lastUsedAt        DateTime  @default(now())

  @@index([userId])
  @@index([previousTokenHash])
  @@map("sessions")
}

model MagicLinkToken {
  // preserve id, unique userId, user relation, expiresAt, usedAt, createdAt
  tokenHash String @unique
  // remove plaintext token and the redundant non-unique token index
}

model EmailChangeRequest {
  id           String   @id @default(uuid())
  userId       String   @unique
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  newEmail     String
  codeHash     String
  attempts     Int      @default(0)
  expiresAt    DateTime
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([expiresAt])
  @@map("email_change_requests")
}
```

`isStaffAccount` is independent of the current role: a staff account remains distinguishable after its role is removed. Backfill existing `editor` and `admin` rows to true and `reader`/`author` to false; future staff-account creation owns setting it. Nullable archive columns preserve every current user. Application transactions later enforce a complete archive tuple and last-owner protection; do not encode a role-inclusion hierarchy or equate staff status with the current role.

No maximum-attempt or TTL number belongs in this migration. `attempts = 0` is storage initialization, while the maximum remains an approved open assumption. `expiresAt` values are supplied by application code from existing `MAGIC_LINK_EXPIRY_MINUTES`/`JWT_*_EXPIRY` configuration. Do not add plan, subscription, mail, legal, audit, appeal, job, or IP-geolocation models.

## Ordered migration and compatibility path

1. **Rehearse the existing history first.** On a disposable PostgreSQL database, apply the repository history from empty. On a separate disposable copy at the current schema, record migration history, row counts, IDs/FKs and counts per role; seed/retain an article and used/unused magic links. Never point these commands at a developer or production database.
2. **Handle the historical `user` hazard only if the copied history proves it exists.** `20250726211815_update_roles` casts `user` directly into an enum that lacks it and therefore fails if a database stopped before that migration with data. Do not edit an already checksummed historical migration. If an actual upgrade source has that state, use a separately reviewed pre-deploy SQL repair that first adds `reader`, maps `user -> reader`, and only then lets the historical migration run. This is a data-state prerequisite, not a product decision.
3. **Migration A: `role_add_moderator_analyst_owner`.** Add the three values to PostgreSQL `Role`; do not use a newly added value in the same migration transaction. Existing `reader`, `author`, `editor`, and `admin` values remain byte-for-byte unchanged.
4. **Migration B: `user_account_archive_state`.** Create `AccountArchiveMode`, add the nullable archive/actor/reason fields, the self-relation FK, and `isStaffAccount`; backfill the staff marker. Do not create an owner, reclassify ordinary users, archive anything, or implement archive/session revocation.
5. **Migration C: `sessions_magic_link_hash_email_change`.** Create `sessions` and `email_change_requests` with the listed constraints/indexes. Add nullable `magic_link_tokens.tokenHash`, backfill it as lower-case hex SHA-256 of the existing transmitted token string's UTF-8 bytes, prove zero nulls and no duplicate hashes, then make it required/unique, drop plaintext `token`, and drop/rename both old token indexes so exactly one unique hash index remains. PostgreSQL's exact SHA-256 expression/version support must be proven in the disposable target image; do not add an extension or delete pending links merely to avoid that check.
6. **Ship the hash-aware resolver with Migration C.** Put one small `sha256Hex(raw: string)` helper in `server/src/security/tokens.ts` (or the existing security utility location if one exists by implementation time). `requestMagicLink` continues to generate 32 random bytes and expose the same raw hex string in the existing link, but persists only `sha256Hex(rawToken)`. `verifyMagicLink(token)` computes the same hash before `findUnique({ where: { tokenHash } })`. Keep `requestMagicLink(email): Boolean`, `verifyMagicLink(token): AuthPayload`, account creation, expiry/used checks, and response fields unchanged. Logging/removing the printed link is T-021, and session creation/rotation/logout is T-023; do not pull either into this schema milestone.
7. **Update the contract source.** Change `server/src/graphql/user/schema.graphql` to the exact seven-value enum. Do not replace the web's two-value union with another hand-written union. Full T-011 AC3 requires T-008's generated GraphQL types and `codegen --check`; until T-008 removes `web/app/types/user.ts`/other schema-duplicating types, record T-011 as partially blocked rather than weakening `role` to `string` or claiming completion from a narrow grep.

If deployment requires mixed old/new server versions, split Migration C into explicit expand/backfill/contract releases. No such zero-downtime requirement is present in the approved material; a coordinated application-plus-migration release is the minimal current path. This is an operational implementation choice, not owner policy.

## Focused TDD and acceptance evidence

Create the failing checks before schema/resolver changes. Keep tests under the existing Vitest discovery path `server/tests/**/*.test.ts`.

- `server/tests/role-schema-contract.test.ts`: build the merged GraphQL SDL and compare `Role` with the exact ordered Prisma role set. It must fail on any missing/extra value. T-008's real `pnpm codegen --check` supplies the frontend single-source proof; grep alone is supporting evidence.
- `server/tests/auth-token-hash.test.ts`: use a fake Prisma context and dynamic import after synthetic JWT env setup. Assert the upsert contains a 64-character lower-case SHA-256 hash and no raw-token field; extract the raw token from the existing logged link only inside the test and prove its hash equals the persisted value. Assert verification queries by the input token's hash and preserves invalid/used/expired behavior and the public payload. No network or database is needed.
- `server/tests/schema-contract.test.ts`: inspect Prisma's generated metadata or validated schema for Session fields/indexes/cascades, `limited`, one pending email request per user, hashed code, no geography field, and absence of `MagicLinkToken.token`. This is useful structural coverage but does not replace migration rehearsal.
- Disposable-DB rehearsal (a dedicated script/test outside the ordinary unit run is acceptable): (a) apply all migrations from empty; (b) upgrade the populated current-schema fixture; (c) compare user/article/magic-link counts and stable IDs/FKs before/after; (d) assert exact enum values and staff backfill; (e) prove an unused pre-migration raw magic link still verifies through the hash-aware resolver, while the database contains only its hash; (f) inspect required unique/index/FK/cascade constraints; (g) exercise inserts and cascades inside transactions that are rolled back.

After implementation, run only against synthetic settings and the disposable DB: Prisma format/validate, focused Vitest files, the two rehearsal paths, `pnpm --filter server run build:ci`, and T-008 codegen validation when available. Never use the server's ordinary `build` for verification because it runs `prisma migrate deploy`. Save exact commands, disposable image/version and database identifiers, sanitized before/after queries, row counts, exit codes, and raw logs in the task evidence/report.

T-011 AC1 and T-012 AC3 require the disposable database. Exact Prisma/GraphQL role parity, absence of geography/plaintext fields, resolver hashing, and public auth-shape compatibility can be checked locally without a database. The full login/session/rotation/logout/browser flows belong to T-023/T-025 and are not evidence that this schema task passed.

## Remaining information, none of it owner policy

- The actual target database's `_prisma_migrations` state, PostgreSQL version, role counts, and presence of pending magic links must come from the authorized disposable copy/rehearsal. This brief did not access them.
- T-008 must be sequenced before or with final T-011 acceptance so frontend roles are generated from SDL. T-009/T-010 are not required to create these tables, while later browser/session flows still depend on the BFF and operations work.
- The approved assumptions still open are refresh inactivity duration/device cap, email-code maximum attempts/shared TTL, and limited-session/appeal presentation. The schema stores `expiresAt`, `attempts`, and `limited` without choosing those behaviors.
- First-owner seeding, last-owner transactional protection, archive/revoke behavior, email-change mutations, manual recovery/audit, retention cleanup, and session rotation are later application tasks. Their accepted behavior does not require new owner input here.

Implementation can therefore proceed within T-011/T-012 once it has an isolated writer and disposable database. It cannot honestly mark all T-011 acceptance complete until T-008's generated frontend type source exists.
