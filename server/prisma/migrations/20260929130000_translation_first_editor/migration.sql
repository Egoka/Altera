-- T-040: редактор пишет от языковой версии, а не от наследной строки `articles`.
--
-- Trigger `t015_sync_legacy_article` синхронизирует `article_translations` из `articles` и сам
-- заводит ревизию. Пока единственным писателем был наследный API, это держало обе таблицы в
-- согласии. Редактор (`docs/spec/30-account/author/article-edit.md`) пишет в языковую версию, и
-- любая последующая запись в `articles.status` — архив из кабинета, `setArticleStatus` админки —
-- перезаписала бы текст автора наследными значениями и добавила лишнюю ревизию.
--
-- Миграция добавляет в функцию trigger единственную проверку: параметр сеанса
-- `altera.legacy_sync` со значением `off` выключает синхронизацию до конца транзакции. Писатель
-- «от языковой версии» ставит `SET LOCAL "altera.legacy_sync" = 'off'` и сам держит наследную
-- строку в согласии с версией. По умолчанию параметр не задан, и trigger работает как раньше:
-- `current_setting(..., true)` на незаданном параметре возвращает NULL, а не ошибку.
--
-- Тело функции ниже повторяет редакцию T-020 (`20260928120000_legacy_body_content_document`)
-- без изменений, кроме этой проверки: `CREATE OR REPLACE FUNCTION` требует целого тела.
--
-- Своего `BEGIN`/`COMMIT` в файле нет: `prisma migrate deploy` выполняет миграцию в собственной
-- транзакции, а `ALTER TYPE … ADD VALUE` здесь нет.

CREATE OR REPLACE FUNCTION "t015_sync_legacy_article"() RETURNS trigger AS $$
DECLARE
  translation_id TEXT;
  document JSONB;
BEGIN
  -- Писатель от языковой версии ведёт наследную строку сам (T-040).
  IF current_setting('altera.legacy_sync', true) = 'off' THEN
    RETURN NEW;
  END IF;

  document := "t020_legacy_body_to_document"(to_jsonb(NEW."body"));

  IF TG_OP = 'INSERT' THEN
    translation_id := 'translation-' || NEW."id";

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
    ) VALUES (
      translation_id,
      NEW."id",
      NEW."sourceLocale",
      NEW."slug",
      NEW."title",
      NEW."dek",
      NEW."excerpt",
      NEW."featuredImage",
      document,
      NEW."status",
      NEW."publishedAt",
      NEW."createdAt",
      NEW."updatedAt"
    );

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
    ) VALUES (
      'revision-' || NEW."id",
      translation_id,
      NEW."title",
      NEW."dek",
      NEW."excerpt",
      document,
      CASE WHEN NEW."status" = 'published' THEN 'publish' ELSE 'manual' END::"ArticleRevisionKind",
      NEW."authorId",
      NEW."updatedAt"
    );

    RETURN NEW;
  END IF;

  SELECT "id"
  INTO translation_id
  FROM "article_translations"
  WHERE "articleId" = NEW."id" AND "locale" = NEW."sourceLocale";

  IF translation_id IS NULL THEN
    RAISE EXCEPTION 'missing source translation for legacy article %', NEW."id" USING ERRCODE = 'P0001';
  END IF;

  UPDATE "article_translations"
  SET
    "slug" = NEW."slug",
    "title" = NEW."title",
    "dek" = NEW."dek",
    "excerpt" = NEW."excerpt",
    "featuredImage" = NEW."featuredImage",
    "body" = document,
    "status" = NEW."status",
    "publishedAt" = NEW."publishedAt",
    "updatedAt" = NEW."updatedAt"
  WHERE "id" = translation_id;

  IF NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."dek" IS DISTINCT FROM OLD."dek"
    OR NEW."excerpt" IS DISTINCT FROM OLD."excerpt"
    OR NEW."body" IS DISTINCT FROM OLD."body"
    OR (NEW."status" = 'published' AND OLD."status" <> 'published') THEN
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
    ) VALUES (
      gen_random_uuid()::text,
      translation_id,
      NEW."title",
      NEW."dek",
      NEW."excerpt",
      document,
      CASE
        WHEN NEW."status" = 'published' AND OLD."status" <> 'published' THEN 'publish'
        ELSE 'manual'
      END::"ArticleRevisionKind",
      NEW."authorId",
      NEW."updatedAt"
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
