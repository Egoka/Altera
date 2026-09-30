CREATE TYPE "AccountAppealStatus" AS ENUM ('submitted', 'restored', 'confirmed');

CREATE TABLE "account_appeals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "status" "AccountAppealStatus" NOT NULL DEFAULT 'submitted',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByActorId" TEXT,
    "decidedByRole" "Role",
    "decisionReason" TEXT,
    "archivedAt" TIMESTAMP(3) NOT NULL,
    "reasonCategory" "AccountArchiveReasonCategory" NOT NULL,
    "staffMessage" TEXT,
    "planTier" "PlanTier" NOT NULL,
    "planUntil" TIMESTAMP(3),

    CONSTRAINT "account_appeals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_appeals_userId_key" ON "account_appeals"("userId");
CREATE INDEX "account_appeals_status_submittedAt_idx" ON "account_appeals"("status", "submittedAt");

ALTER TABLE "account_appeals"
ADD CONSTRAINT "account_appeals_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "account_appeal_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_appeal_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_appeal_tokens_userId_key" ON "account_appeal_tokens"("userId");
CREATE UNIQUE INDEX "account_appeal_tokens_tokenHash_key" ON "account_appeal_tokens"("tokenHash");
CREATE INDEX "account_appeal_tokens_expiresAt_idx" ON "account_appeal_tokens"("expiresAt");

ALTER TABLE "account_appeal_tokens"
ADD CONSTRAINT "account_appeal_tokens_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
