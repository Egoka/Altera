-- CreateEnum
CREATE TYPE "AccountArchiveMode" AS ENUM ('self', 'admin', 'emergency');

-- AlterTable
ALTER TABLE "users"
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "archiveMode" "AccountArchiveMode",
ADD COLUMN "archivedByActorId" TEXT,
ADD COLUMN "archivedByRole" "Role",
ADD COLUMN "archiveReason" TEXT,
ADD COLUMN "isServiceAccount" BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing service records. Existing reader/author stay ordinary.
UPDATE "users"
SET "isServiceAccount" = true
WHERE "role" IN ('editor'::"Role", 'admin'::"Role");
