BEGIN;

CREATE TYPE "Locale" AS ENUM ('ru', 'en');
CREATE TYPE "ProfileCheckStatus" AS ENUM ('ok', 'pending', 'rejected');

CREATE TABLE "handle_history" (
  "handle" TEXT NOT NULL,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "handle_history_pkey" PRIMARY KEY ("handle")
);

CREATE INDEX "handle_history_userId_idx" ON "handle_history"("userId");

ALTER TABLE "users"
  ADD COLUMN "handle" TEXT,
  ADD COLUMN "locale" "Locale",
  ADD COLUMN "avatarAssetId" TEXT,
  ADD COLUMN "prevAvatarId" TEXT,
  ADD COLUMN "nameCheckStatus" "ProfileCheckStatus",
  ADD COLUMN "avatarCheckStatus" "ProfileCheckStatus";

DO $$
DECLARE
  collision_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO collision_count
  FROM (
    SELECT lower("slug")
    FROM "users"
    GROUP BY lower("slug")
    HAVING COUNT(*) > 1
  ) AS conflicts;

  IF collision_count > 0 THEN
    RAISE EXCEPTION 'case-insensitive legacy slug conflicts: %', collision_count
      USING ERRCODE = '23505';
  END IF;
END $$;

INSERT INTO "handle_history" ("handle", "userId")
SELECT lower("slug"), "id"
FROM "users";

DO $$
DECLARE
  existing_user RECORD;
  candidate TEXT;
  inserted_rows INTEGER;
BEGIN
  FOR existing_user IN SELECT "id" FROM "users" ORDER BY "id"
  LOOP
    LOOP
      candidate := 'u-' || substring(md5(random()::text || clock_timestamp()::text || existing_user."id") FROM 1 FOR 8);
      INSERT INTO "handle_history" ("handle", "userId")
      VALUES (candidate, existing_user."id")
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS inserted_rows = ROW_COUNT;
      EXIT WHEN inserted_rows = 1;
    END LOOP;

    UPDATE "users" SET "handle" = candidate WHERE "id" = existing_user."id";
  END LOOP;
END $$;

UPDATE "users"
SET
  "locale" = 'ru',
  "nameCheckStatus" = 'ok',
  "avatarCheckStatus" = 'ok';

ALTER TABLE "users"
  ALTER COLUMN "handle" SET NOT NULL,
  ALTER COLUMN "locale" SET NOT NULL,
  ALTER COLUMN "locale" SET DEFAULT 'ru',
  ALTER COLUMN "nameCheckStatus" SET NOT NULL,
  ALTER COLUMN "nameCheckStatus" SET DEFAULT 'ok',
  ALTER COLUMN "avatarCheckStatus" SET NOT NULL,
  ALTER COLUMN "avatarCheckStatus" SET DEFAULT 'ok';

CREATE UNIQUE INDEX "users_handle_key" ON "users"("handle");
CREATE INDEX "users_nameCheckStatus_idx" ON "users"("nameCheckStatus");
CREATE INDEX "users_avatarCheckStatus_idx" ON "users"("avatarCheckStatus");

ALTER TABLE "users" ADD CONSTRAINT "users_handle_fkey"
  FOREIGN KEY ("handle") REFERENCES "handle_history"("handle") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "handle_history" ADD CONSTRAINT "handle_history_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users" ADD CONSTRAINT "users_handle_format_check"
  CHECK ("handle" ~ '^[a-z0-9-]{3,32}$');
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_versions_distinct_check"
  CHECK ("avatarAssetId" IS NULL OR "prevAvatarId" IS NULL OR "avatarAssetId" <> "prevAvatarId");

DROP INDEX "users_slug_key";
ALTER TABLE "users" DROP COLUMN "slug";

COMMIT;
