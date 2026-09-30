-- T-051: токен ссылки `/me/articles/{id}/edit?token=` из письма о доработке или снятии
-- с публикации (`routes.md` #68). Один активный токен на версию — новое письмо заменяет прежний.
ALTER TABLE "article_translations" ADD COLUMN "editTokenHash" VARCHAR(64);
ALTER TABLE "article_translations" ADD COLUMN "editTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "article_translations_editTokenHash_key" ON "article_translations"("editTokenHash");
