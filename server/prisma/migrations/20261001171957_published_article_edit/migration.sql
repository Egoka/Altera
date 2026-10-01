-- CreateEnum
CREATE TYPE "PublishedArticleEditStatus" AS ENUM ('draft', 'ai_check', 'review', 'rework');

-- CreateTable
CREATE TABLE "published_article_edits" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "translationId" TEXT NOT NULL,
    "latestRevisionId" TEXT NOT NULL,
    "status" "PublishedArticleEditStatus" NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "published_article_edits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "published_article_edits_articleId_key" ON "published_article_edits"("articleId");

-- CreateIndex
CREATE INDEX "published_article_edits_translationId_idx" ON "published_article_edits"("translationId");

-- CreateIndex
CREATE INDEX "published_article_edits_latestRevisionId_idx" ON "published_article_edits"("latestRevisionId");

-- AddForeignKey
ALTER TABLE "published_article_edits" ADD CONSTRAINT "published_article_edits_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_article_edits" ADD CONSTRAINT "published_article_edits_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "article_translations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_article_edits" ADD CONSTRAINT "published_article_edits_latestRevisionId_fkey" FOREIGN KEY ("latestRevisionId") REFERENCES "article_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_article_edits" ADD CONSTRAINT "published_article_edits_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
