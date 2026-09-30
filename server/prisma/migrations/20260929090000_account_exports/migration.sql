CREATE TABLE "account_exports" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "scope" JSONB NOT NULL,
  "storageKey" TEXT,
  "sizeBytes" INTEGER,
  "readyAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "account_exports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_exports_jobId_key" ON "account_exports"("jobId");
CREATE UNIQUE INDEX "account_exports_storageKey_key" ON "account_exports"("storageKey");
CREATE INDEX "account_exports_userId_requestedAt_idx" ON "account_exports"("userId", "requestedAt" DESC);
CREATE INDEX "account_exports_expiresAt_idx" ON "account_exports"("expiresAt");

ALTER TABLE "account_exports"
  ADD CONSTRAINT "account_exports_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "account_exports"
  ADD CONSTRAINT "account_exports_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
