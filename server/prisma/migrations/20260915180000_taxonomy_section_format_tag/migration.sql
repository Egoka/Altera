BEGIN;

CREATE TEMP TABLE "_t014_before_counts" (
  "sections" BIGINT NOT NULL,
  "tags" BIGINT NOT NULL,
  "articleTags" BIGINT NOT NULL,
  "articles" BIGINT NOT NULL,
  "articleSections" BIGINT NOT NULL
) ON COMMIT DROP;

INSERT INTO "_t014_before_counts"
SELECT
  (SELECT COUNT(*) FROM "content_types"),
  (SELECT COUNT(*) FROM "section_tags"),
  (SELECT COUNT(*) FROM "_ArticleToSectionTag"),
  (SELECT COUNT(*) FROM "articles"),
  (SELECT COUNT(*) FROM "articles" WHERE "typeId" IS NOT NULL);

DO $$
DECLARE
  section_slug_conflicts INTEGER;
  tag_slug_conflicts INTEGER;
  invalid_section_slugs INTEGER;
  invalid_tag_slugs INTEGER;
  archived_sections INTEGER;
BEGIN
  SELECT COUNT(*) INTO section_slug_conflicts
  FROM (SELECT lower("slug") FROM "content_types" GROUP BY lower("slug") HAVING COUNT(*) > 1) conflicts;

  SELECT COUNT(*) INTO tag_slug_conflicts
  FROM (SELECT lower("slug") FROM "section_tags" GROUP BY lower("slug") HAVING COUNT(*) > 1) conflicts;

  SELECT COUNT(*) INTO invalid_section_slugs
  FROM "content_types"
  WHERE "slug" !~ '^[a-z0-9-]+$'
     OR "slug" IN ('en', 'authors', 'tags', 'collections', 'search', 'me', 'admin', 'auth', 'login', 'legal', 'api', 'rss', 'sitemap.xml');

  SELECT COUNT(*) INTO invalid_tag_slugs
  FROM "section_tags"
  WHERE "slug" !~ '^[a-z0-9-]+$';

  SELECT COUNT(*) INTO archived_sections FROM "content_types" WHERE "status" = 'archived';

  IF section_slug_conflicts > 0 OR tag_slug_conflicts > 0 THEN
    RAISE EXCEPTION 'case-insensitive taxonomy slug conflicts: sections=%, tags=%', section_slug_conflicts, tag_slug_conflicts
      USING ERRCODE = '23505';
  END IF;
  IF invalid_section_slugs > 0 OR invalid_tag_slugs > 0 THEN
    RAISE EXCEPTION 'invalid taxonomy slugs: sections=%, tags=%', invalid_section_slugs, invalid_tag_slugs
      USING ERRCODE = '23514';
  END IF;
  IF archived_sections > 0 THEN
    RAISE EXCEPTION 'archived sections require an explicit active successor: count=%', archived_sections
      USING ERRCODE = '23514';
  END IF;
END $$;

ALTER TYPE "ContentTypeStatus" RENAME TO "TaxonomyStatus";

ALTER TABLE "content_types" RENAME TO "sections";
ALTER TABLE "sections" RENAME CONSTRAINT "content_types_pkey" TO "sections_pkey";
ALTER INDEX "content_types_slug_key" RENAME TO "sections_slug_key";

ALTER TABLE "section_tags" RENAME TO "tags";
ALTER TABLE "tags" RENAME CONSTRAINT "section_tags_pkey" TO "tags_pkey";
ALTER INDEX "section_tags_slug_key" RENAME TO "tags_slug_key";

ALTER TABLE "articles" RENAME COLUMN "typeId" TO "sectionId";
ALTER TABLE "articles" RENAME CONSTRAINT "articles_typeId_fkey" TO "articles_sectionId_fkey";
ALTER TABLE "articles" ALTER COLUMN "sectionId" DROP NOT NULL;

ALTER TABLE "_ArticleToSectionTag" RENAME TO "_ArticleToTag";
ALTER TABLE "_ArticleToTag" RENAME CONSTRAINT "_ArticleToSectionTag_AB_pkey" TO "_ArticleToTag_AB_pkey";
ALTER TABLE "_ArticleToTag" RENAME CONSTRAINT "_ArticleToSectionTag_A_fkey" TO "_ArticleToTag_A_fkey";
ALTER TABLE "_ArticleToTag" RENAME CONSTRAINT "_ArticleToSectionTag_B_fkey" TO "_ArticleToTag_B_fkey";
ALTER INDEX "_ArticleToSectionTag_B_index" RENAME TO "_ArticleToTag_B_index";

ALTER TABLE "sections"
  ADD COLUMN "nameEn" TEXT,
  ADD COLUMN "descriptionEn" TEXT,
  ADD COLUMN "seoTitle" TEXT,
  ADD COLUMN "seoTitleEn" TEXT,
  ADD COLUMN "seoDescription" TEXT,
  ADD COLUMN "seoDescriptionEn" TEXT,
  ADD COLUMN "successorId" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedByActorId" TEXT,
  ADD COLUMN "archivedByRole" "Role";

ALTER TABLE "tags"
  ADD COLUMN "nameEn" TEXT,
  ADD COLUMN "status" "TaxonomyStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "mergedIntoId" TEXT,
  ADD COLUMN "createdByActorId" TEXT,
  ADD COLUMN "createdByRole" "Role",
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedByActorId" TEXT,
  ADD COLUMN "archivedByRole" "Role";

CREATE TABLE "formats" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameEn" TEXT,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "descriptionEn" TEXT,
  "status" "TaxonomyStatus" NOT NULL DEFAULT 'active',
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "formats_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "articles" ADD COLUMN "formatId" TEXT;

CREATE TABLE "section_slug_history" (
  "slug" TEXT NOT NULL,
  "ownerSectionId" TEXT,
  "redirectToSectionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "section_slug_history_pkey" PRIMARY KEY ("slug")
);

CREATE TABLE "tag_slug_history" (
  "slug" TEXT NOT NULL,
  "ownerTagId" TEXT,
  "redirectToTagId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tag_slug_history_pkey" PRIMARY KEY ("slug")
);

INSERT INTO "section_slug_history" ("slug", "ownerSectionId", "redirectToSectionId", "createdAt")
SELECT "slug", "id", "id", "createdAt" FROM "sections";

INSERT INTO "tag_slug_history" ("slug", "ownerTagId", "redirectToTagId", "createdAt")
SELECT "slug", "id", "id", "createdAt" FROM "tags";

CREATE UNIQUE INDEX "formats_slug_key" ON "formats"("slug");
CREATE INDEX "formats_status_idx" ON "formats"("status");
CREATE INDEX "sections_status_order_idx" ON "sections"("status", "order");
CREATE INDEX "sections_successorId_idx" ON "sections"("successorId");
CREATE INDEX "tags_status_idx" ON "tags"("status");
CREATE INDEX "tags_mergedIntoId_idx" ON "tags"("mergedIntoId");
CREATE INDEX "tags_createdByActorId_idx" ON "tags"("createdByActorId");
CREATE INDEX "articles_sectionId_idx" ON "articles"("sectionId");
CREATE INDEX "articles_formatId_idx" ON "articles"("formatId");
CREATE INDEX "section_slug_history_ownerSectionId_idx" ON "section_slug_history"("ownerSectionId");
CREATE INDEX "section_slug_history_redirectToSectionId_idx" ON "section_slug_history"("redirectToSectionId");
CREATE INDEX "tag_slug_history_ownerTagId_idx" ON "tag_slug_history"("ownerTagId");
CREATE INDEX "tag_slug_history_redirectToTagId_idx" ON "tag_slug_history"("redirectToTagId");

ALTER TABLE "sections" ADD CONSTRAINT "sections_successorId_fkey"
  FOREIGN KEY ("successorId") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "articles" ADD CONSTRAINT "articles_formatId_fkey"
  FOREIGN KEY ("formatId") REFERENCES "formats"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tags" ADD CONSTRAINT "tags_createdByActorId_fkey"
  FOREIGN KEY ("createdByActorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tags" ADD CONSTRAINT "tags_mergedIntoId_fkey"
  FOREIGN KEY ("mergedIntoId") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sections" ADD CONSTRAINT "sections_slug_fkey"
  FOREIGN KEY ("slug") REFERENCES "section_slug_history"("slug") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "tags" ADD CONSTRAINT "tags_slug_fkey"
  FOREIGN KEY ("slug") REFERENCES "tag_slug_history"("slug") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "section_slug_history" ADD CONSTRAINT "section_slug_history_ownerSectionId_fkey"
  FOREIGN KEY ("ownerSectionId") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "section_slug_history" ADD CONSTRAINT "section_slug_history_redirectToSectionId_fkey"
  FOREIGN KEY ("redirectToSectionId") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tag_slug_history" ADD CONSTRAINT "tag_slug_history_ownerTagId_fkey"
  FOREIGN KEY ("ownerTagId") REFERENCES "tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tag_slug_history" ADD CONSTRAINT "tag_slug_history_redirectToTagId_fkey"
  FOREIGN KEY ("redirectToTagId") REFERENCES "tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sections" ADD CONSTRAINT "sections_archive_successor_check"
  CHECK (
    ("status" = 'active' AND "successorId" IS NULL)
    OR ("status" = 'archived' AND "successorId" IS NOT NULL)
  );
ALTER TABLE "sections" ADD CONSTRAINT "sections_successor_not_self_check"
  CHECK ("successorId" IS NULL OR "successorId" <> "id");
ALTER TABLE "sections" ADD CONSTRAINT "sections_slug_format_check"
  CHECK ("slug" ~ '^[a-z0-9-]+$');
ALTER TABLE "sections" ADD CONSTRAINT "sections_slug_reserved_check"
  CHECK ("slug" NOT IN ('en', 'authors', 'tags', 'collections', 'search', 'me', 'admin', 'auth', 'login', 'legal', 'api', 'rss', 'sitemap.xml'));
ALTER TABLE "tags" ADD CONSTRAINT "tags_merge_not_self_check"
  CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id");
ALTER TABLE "tags" ADD CONSTRAINT "tags_slug_format_check"
  CHECK ("slug" ~ '^[a-z0-9-]+$');

DO $$
DECLARE
  before_counts "_t014_before_counts"%ROWTYPE;
BEGIN
  SELECT * INTO before_counts FROM "_t014_before_counts";
  IF before_counts."sections" <> (SELECT COUNT(*) FROM "sections")
    OR before_counts."tags" <> (SELECT COUNT(*) FROM "tags")
    OR before_counts."articleTags" <> (SELECT COUNT(*) FROM "_ArticleToTag")
    OR before_counts."articles" <> (SELECT COUNT(*) FROM "articles")
    OR before_counts."articleSections" <> (SELECT COUNT(*) FROM "articles" WHERE "sectionId" IS NOT NULL)
    OR before_counts."sections" <> (SELECT COUNT(*) FROM "section_slug_history")
    OR before_counts."tags" <> (SELECT COUNT(*) FROM "tag_slug_history") THEN
    RAISE EXCEPTION 'taxonomy migration postcondition failed' USING ERRCODE = 'P0001';
  END IF;
END $$;

COMMIT;
