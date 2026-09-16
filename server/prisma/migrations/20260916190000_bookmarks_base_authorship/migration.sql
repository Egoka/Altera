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
        ("endsAt" IS NULL AND "grantedById" IS NULL)
        OR ("endsAt" IS NOT NULL AND "grantedById" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "bookmarks" (
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("userId", "articleId")
);

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
ADD CONSTRAINT "bookmarks_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks"
ADD CONSTRAINT "bookmarks_articleId_fkey"
FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing authors keep their launch-time base authorship without a subscription.
INSERT INTO "plan_grants" ("id", "userId", "tier", "reason")
SELECT md5("id" || ':base-authorship'), "id", 'standard', 'import: base authorship'
FROM "users"
WHERE "role" = 'author';

UPDATE "users"
SET "planTier" = 'standard', "planUntil" = NULL
WHERE "role" = 'author';

-- Bookmark ownership is a personal reader/author capability, never a service-account capability.
CREATE FUNCTION assert_bookmark_owner_is_personal_account() RETURNS trigger AS $$
DECLARE
    owner_role "Role";
    owner_is_service BOOLEAN;
BEGIN
    SELECT "role", "isServiceAccount"
    INTO owner_role, owner_is_service
    FROM "users"
    WHERE "id" = NEW."userId";

    IF owner_role NOT IN ('reader', 'author') OR owner_is_service THEN
        RAISE EXCEPTION 'bookmarks require an ordinary reader or author account'
            USING ERRCODE = '23514', CONSTRAINT = 'bookmarks_personal_account_check';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookmarks_personal_account_check
BEFORE INSERT OR UPDATE OF "userId" ON "bookmarks"
FOR EACH ROW EXECUTE FUNCTION assert_bookmark_owner_is_personal_account();

CREATE FUNCTION prevent_bookmark_owner_service_conversion() RETURNS trigger AS $$
BEGIN
    IF (NEW."role" NOT IN ('reader', 'author') OR NEW."isServiceAccount")
       AND EXISTS (SELECT 1 FROM "bookmarks" WHERE "userId" = NEW."id") THEN
        RAISE EXCEPTION 'an account with bookmarks cannot become a service account'
            USING ERRCODE = '23514', CONSTRAINT = 'users_bookmarks_personal_account_check';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_bookmarks_personal_account_check
BEFORE UPDATE OF "role", "isServiceAccount" ON "users"
FOR EACH ROW EXECUTE FUNCTION prevent_bookmark_owner_service_conversion();
