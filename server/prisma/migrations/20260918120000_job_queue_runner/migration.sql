-- Задание сохраняет исходный requestId для сквозной трассировки и лимит автоматических попыток.
ALTER TABLE "jobs"
ADD COLUMN "originRequestId" TEXT,
ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "manualRetryAllowed" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "jobs"
ADD CONSTRAINT "jobs_maxAttempts_positive" CHECK ("maxAttempts" > 0);

CREATE INDEX "jobs_originRequestId_idx" ON "jobs"("originRequestId");
