ALTER TABLE "users"
ADD COLUMN "isTestAccount" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "users_isTestAccount_idx" ON "users"("isTestAccount");
