-- Invalidate legacy plaintext magic links before the column becomes hash-only.
DELETE FROM "magic_link_tokens";

-- Drop the redundant non-unique index before renaming the token column.
DROP INDEX "magic_link_tokens_token_idx";

ALTER TABLE "magic_link_tokens" RENAME COLUMN "token" TO "tokenHash";
ALTER TABLE "magic_link_tokens"
  ALTER COLUMN "tokenHash" TYPE VARCHAR(64),
  ADD CONSTRAINT "magic_link_tokens_tokenHash_check"
    CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER INDEX "magic_link_tokens_token_key"
  RENAME TO "magic_link_tokens_tokenHash_key";

CREATE TABLE "sessions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "previousTokenHash" VARCHAR(64),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "userAgent" TEXT,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sessions_tokenHash_check"
    CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "sessions_previousTokenHash_check"
    CHECK ("previousTokenHash" IS NULL OR "previousTokenHash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "email_change_requests" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "newEmail" TEXT NOT NULL,
  "codeHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_change_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_change_requests_codeHash_check"
    CHECK ("codeHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");
CREATE INDEX "sessions_previousTokenHash_idx" ON "sessions"("previousTokenHash");
CREATE UNIQUE INDEX "email_change_requests_userId_key"
  ON "email_change_requests"("userId");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_change_requests" ADD CONSTRAINT "email_change_requests_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
