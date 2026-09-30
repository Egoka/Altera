-- T-076: append-only registry of article `(locale, slug)` pairs so a permanently deleted
-- material's address is never reissued (журнал §26.10, перенесено из AC-T053-2).
CREATE TABLE "article_slug_history" (
  "locale" "Locale" NOT NULL,
  "slug" TEXT NOT NULL,
  "articleId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "article_slug_history_pkey" PRIMARY KEY ("locale", "slug")
);

CREATE INDEX "article_slug_history_articleId_idx" ON "article_slug_history"("articleId");

ALTER TABLE "article_slug_history" ADD CONSTRAINT "article_slug_history_articleId_fkey"
  FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every `(locale, slug)` pair already issued to a translation is reserved retroactively,
-- owned by its current article.
INSERT INTO "article_slug_history" ("locale", "slug", "articleId", "createdAt")
SELECT "locale", "slug", "articleId", now()
FROM "article_translations";
