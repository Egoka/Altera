ALTER TABLE "article_translations"
  ADD COLUMN "readCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reviewerId" TEXT,
  ADD COLUMN "reviewerRole" "Role",
  ADD COLUMN "reviewClaimedAt" TIMESTAMP(3);

ALTER TABLE "article_translations"
  ADD CONSTRAINT "article_translations_readCount_nonnegative" CHECK ("readCount" >= 0);

CREATE INDEX "article_translations_status_reviewerId_updatedAt_idx"
  ON "article_translations"("status", "reviewerId", "updatedAt");
