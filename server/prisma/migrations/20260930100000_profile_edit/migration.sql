ALTER TABLE "users"
ADD COLUMN "handleConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "handleChangedAt" TIMESTAMP(3),
ADD COLUMN "pendingName" TEXT,
ADD COLUMN "nameCheckReason" TEXT,
ADD COLUMN "avatarCheckReason" TEXT;

-- Уже публиковавшиеся авторы прошли прежний публичный барьер. Новый флаг не должен лишать их
-- повторной подачи; подтверждение требуется при первой публикации для остальных аккаунтов.
UPDATE "users" AS "user"
SET "handleConfirmed" = true
WHERE EXISTS (
  SELECT 1
  FROM "articles" AS "article"
  WHERE "article"."authorId" = "user"."id"
    AND ("article"."firstPublishedAt" IS NOT NULL OR "article"."status" = 'published')
);
