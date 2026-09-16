ALTER TYPE "ArticleStatus" ADD VALUE IF NOT EXISTS 'ai_check' AFTER 'draft';
ALTER TYPE "ArticleStatus" ADD VALUE IF NOT EXISTS 'in_review' AFTER 'review';
ALTER TYPE "ArticleStatus" ADD VALUE IF NOT EXISTS 'rework' AFTER 'in_review';

BEGIN;

CREATE TYPE "ArticleRevisionKind" AS ENUM ('publish', 'editorial', 'manual', 'autosave');

CREATE TEMP TABLE "_t015_before_counts" (
  "articles" BIGINT NOT NULL
) ON COMMIT DROP;

INSERT INTO "_t015_before_counts"
SELECT COUNT(*) FROM "articles";

ALTER TABLE "articles"
  ADD COLUMN "sourceLocale" "Locale" NOT NULL DEFAULT 'ru',
  ADD COLUMN "isEditorial" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "firstPublishedAt" TIMESTAMP(3),
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedByActorId" TEXT,
  ADD COLUMN "archivedByRole" "Role",
  ADD COLUMN "archiveReason" TEXT;

UPDATE "articles"
SET
  "firstPublishedAt" = "publishedAt",
  "archivedAt" = CASE WHEN "status" = 'archived' THEN "updatedAt" ELSE NULL END;

CREATE TABLE "article_translations" (
  "id" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "locale" "Locale" NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "dek" TEXT,
  "excerpt" TEXT,
  "featuredImage" TEXT,
  "body" JSONB NOT NULL,
  "status" "ArticleStatus" NOT NULL DEFAULT 'draft',
  "rejected" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3),
  "reeditUntil" TIMESTAMP(3),
  "reeditedAt" TIMESTAMP(3),
  "translatorId" TEXT,
  "sourceRevisionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "article_translations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "article_revisions" (
  "id" TEXT NOT NULL,
  "translationId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "dek" TEXT,
  "excerpt" TEXT,
  "body" JSONB NOT NULL,
  "kind" "ArticleRevisionKind" NOT NULL,
  "createdById" TEXT NOT NULL,
  "note" TEXT,
  "restoredFromId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "article_revisions_pkey" PRIMARY KEY ("id")
);

INSERT INTO "article_translations" (
  "id",
  "articleId",
  "locale",
  "slug",
  "title",
  "dek",
  "excerpt",
  "featuredImage",
  "body",
  "status",
  "publishedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'translation-' || "id",
  "id",
  'ru',
  "slug",
  "title",
  "dek",
  "excerpt",
  "featuredImage",
  to_jsonb("body"),
  "status",
  "publishedAt",
  "createdAt",
  "updatedAt"
FROM "articles";

INSERT INTO "article_revisions" (
  "id",
  "translationId",
  "title",
  "dek",
  "excerpt",
  "body",
  "kind",
  "createdById",
  "createdAt"
)
SELECT
  'revision-' || a."id",
  t."id",
  a."title",
  a."dek",
  a."excerpt",
  to_jsonb(a."body"),
  CASE WHEN a."publishedAt" IS NOT NULL THEN 'publish' ELSE 'manual' END::"ArticleRevisionKind",
  a."authorId",
  a."updatedAt"
FROM "articles" a
JOIN "article_translations" t ON t."articleId" = a."id" AND t."locale" = 'ru';

CREATE UNIQUE INDEX "article_translations_articleId_locale_key"
  ON "article_translations"("articleId", "locale");
CREATE UNIQUE INDEX "article_translations_locale_slug_key"
  ON "article_translations"("locale", "slug");
CREATE INDEX "article_translations_status_publishedAt_idx"
  ON "article_translations"("status", "publishedAt");
CREATE INDEX "article_translations_translatorId_idx"
  ON "article_translations"("translatorId");
CREATE INDEX "article_translations_sourceRevisionId_idx"
  ON "article_translations"("sourceRevisionId");
CREATE INDEX "article_revisions_translationId_createdAt_idx"
  ON "article_revisions"("translationId", "createdAt");
CREATE INDEX "article_revisions_createdById_idx"
  ON "article_revisions"("createdById");
CREATE INDEX "article_revisions_restoredFromId_idx"
  ON "article_revisions"("restoredFromId");
CREATE INDEX "articles_archivedByActorId_idx"
  ON "articles"("archivedByActorId");

ALTER TABLE "article_translations" ADD CONSTRAINT "article_translations_articleId_fkey"
  FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_translations" ADD CONSTRAINT "article_translations_translatorId_fkey"
  FOREIGN KEY ("translatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_translationId_fkey"
  FOREIGN KEY ("translationId") REFERENCES "article_translations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_restoredFromId_fkey"
  FOREIGN KEY ("restoredFromId") REFERENCES "article_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "article_translations" ADD CONSTRAINT "article_translations_sourceRevisionId_fkey"
  FOREIGN KEY ("sourceRevisionId") REFERENCES "article_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE
  before_count BIGINT;
BEGIN
  SELECT "articles" INTO before_count FROM "_t015_before_counts";

  IF before_count <> (SELECT COUNT(*) FROM "articles")
    OR before_count <> (SELECT COUNT(*) FROM "article_translations")
    OR before_count <> (SELECT COUNT(*) FROM "article_revisions") THEN
    RAISE EXCEPTION 'article migration row-count postcondition failed' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "articles" a
    JOIN "article_translations" t ON t."articleId" = a."id"
    JOIN "article_revisions" r ON r."translationId" = t."id"
    WHERE t."locale" <> 'ru'
      OR t."slug" <> a."slug"
      OR t."title" <> a."title"
      OR t."body" <> to_jsonb(a."body")
      OR t."status" <> a."status"
      OR r."title" <> a."title"
      OR r."body" <> to_jsonb(a."body")
  ) THEN
    RAISE EXCEPTION 'article migration content postcondition failed' USING ERRCODE = 'P0001';
  END IF;
END $$;

COMMIT;
