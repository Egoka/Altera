-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('free', 'standard', 'pro');

-- AlterTable
ALTER TABLE "users"
ADD COLUMN "planTier" "PlanTier" NOT NULL DEFAULT 'free',
ADD COLUMN "planUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "plan_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "PlanTier" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "grantedById" TEXT,
    "reason" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "plan_grants_paid_tier_check" CHECK ("tier" <> 'free'),
    CONSTRAINT "plan_grants_source_check" CHECK (
        ("endsAt" IS NULL AND "grantedById" IS NULL AND "tier" = 'standard')
        OR ("endsAt" IS NOT NULL AND "grantedById" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "bookmarks" (
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "ownerRole" "Role" NOT NULL DEFAULT 'reader',
    "ownerIsServiceAccount" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("userId", "articleId"),
    CONSTRAINT "bookmarks_personal_account_check" CHECK (
        "ownerRole" IN ('reader', 'author') AND NOT "ownerIsServiceAccount"
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "users_id_role_isServiceAccount_key"
ON "users"("id", "role", "isServiceAccount");

-- CreateIndex
CREATE INDEX "plan_grants_userId_endsAt_idx" ON "plan_grants"("userId", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "plan_grants_one_lifelong_per_user_idx"
ON "plan_grants"("userId")
WHERE "endsAt" IS NULL AND "revokedAt" IS NULL;

-- CreateIndex
CREATE INDEX "bookmarks_userId_createdAt_idx" ON "bookmarks"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "plan_grants"
ADD CONSTRAINT "plan_grants_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_grants"
ADD CONSTRAINT "plan_grants_grantedById_fkey"
FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks"
ADD CONSTRAINT "bookmarks_userId_ownerRole_ownerIsServiceAccount_fkey"
FOREIGN KEY ("userId", "ownerRole", "ownerIsServiceAccount")
REFERENCES "users"("id", "role", "isServiceAccount") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks"
ADD CONSTRAINT "bookmarks_articleId_fkey"
FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Существующие авторы сохраняют базовое авторство первого запуска без подписки.
INSERT INTO "plan_grants" ("id", "userId", "tier", "reason")
SELECT md5("id" || ':base-authorship'), "id", 'standard', 'import: base authorship'
FROM "users"
WHERE "role" = 'author';

UPDATE "users"
SET "planTier" = 'standard', "planUntil" = NULL
WHERE "role" = 'author';

-- Снимок допуска к закладкам служит только для декларативного ограничения в базе.
CREATE FUNCTION sync_bookmark_owner_eligibility() RETURNS trigger AS $$
DECLARE
    owner_role "Role";
    owner_is_service BOOLEAN;
BEGIN
    SELECT "role", "isServiceAccount"
    INTO owner_role, owner_is_service
    FROM "users"
    WHERE "id" = NEW."userId";

    NEW."ownerRole" := owner_role;
    NEW."ownerIsServiceAccount" := owner_is_service;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookmarks_sync_owner_eligibility
BEFORE INSERT OR UPDATE OF "userId" ON "bookmarks"
FOR EACH ROW EXECUTE FUNCTION sync_bookmark_owner_eligibility();
