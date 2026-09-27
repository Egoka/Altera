-- T-020: конверсия legacy-тел материалов в документ `content`.
--
-- T-015 перенесла тело статьи в JSONB как `to_jsonb("body")`, то есть как JSON-строку без
-- смысловой конверсии, и оставила trigger `t015_sync_legacy_article`, повторяющий ту же строку
-- при каждой записи в `articles`. Эта миграция превращает такие тела в документ `content`
-- (`@altera/content`, ADR-0001, ADR-0029) и переводит trigger на запись документа.
--
-- Каталог блоков (Q-02) в объём T-020 не входит: конверсия использует единственный блочный
-- узел «абзац» [ДОПУЩЕНИЕ]. Заголовок и цитата legacy-тела становятся абзацами — текст
-- сохраняется полностью, семантика блока возвращается отдельной задачей после утверждения
-- каталога для конверсии.
--
-- Функции конверсии остаются в базе после миграции: их вызывает trigger и скрипт
-- `pnpm verify:legacy-bodies`, который проверяет результат настоящим валидатором каталога.
-- Второй реализации того же алгоритма на TypeScript в проекте нет намеренно.
--
-- Legacy-поля `articles.*` и сам trigger не снимаются: их снятие требует перевода резолверов
-- на языковые версии (API cutover), который в объём T-020 не входит.
--
-- Своего `BEGIN`/`COMMIT` в файле нет намеренно: `prisma migrate deploy` выполняет миграцию
-- в собственной транзакции, а `prisma db execute` отправляет файл одним простым запросом,
-- то есть тоже одной неявной транзакцией. Явная транзакция здесь лишь прятала бы диагностику:
-- при откате Prisma не доходила бы до `COMMIT` и сообщала «current transaction is aborted»
-- вместо текста постпроверки. Управление транзакцией нужно там, где в файле есть
-- `ALTER TYPE … ADD VALUE` (как в T-015); здесь такого оператора нет.

-- Текст legacy-узла: собственный `text` плюс текст вложенных `children` в порядке следования.
CREATE OR REPLACE FUNCTION "t020_legacy_node_text"(node jsonb) RETURNS text AS $$
DECLARE
  child jsonb;
  result text := '';
BEGIN
  IF node IS NULL OR jsonb_typeof(node) = 'null' THEN
    RETURN '';
  END IF;
  IF jsonb_typeof(node) = 'string' THEN
    RETURN node #>> '{}';
  END IF;
  IF jsonb_typeof(node) <> 'object' THEN
    RETURN '';
  END IF;

  IF jsonb_typeof(node -> 'text') = 'string' THEN
    result := node ->> 'text';
  END IF;

  IF jsonb_typeof(node -> 'children') = 'array' THEN
    FOR child IN SELECT value FROM jsonb_array_elements(node -> 'children') AS value LOOP
      result := result || "t020_legacy_node_text"(child);
    END LOOP;
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Абзац каталога. `attrs.id` обязателен и стабилен с момента создания (ADR-0001 п. 3),
-- поэтому он выдаётся здесь и больше не меняется. Пустой абзац допустим: `paragraph`
-- требует не менее нуля дочерних узлов.
CREATE OR REPLACE FUNCTION "t020_content_paragraph"(body text) RETURNS jsonb AS $$
  SELECT CASE
    WHEN body IS NULL OR body = '' THEN
      jsonb_build_object('type', 'paragraph', 'attrs', jsonb_build_object('id', gen_random_uuid()::text))
    ELSE
      jsonb_build_object(
        'type',
        'paragraph',
        'attrs',
        jsonb_build_object('id', gen_random_uuid()::text),
        'content',
        jsonb_build_array(jsonb_build_object('type', 'text', 'text', body))
      )
  END;
$$ LANGUAGE sql;

-- Документ из готового списка блоков. `doc` требует не менее одного блока, поэтому пустой
-- список становится документом из одного пустого абзаца — тем же, что открывает новый черновик.
CREATE OR REPLACE FUNCTION "t020_content_document"(blocks jsonb) RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'type',
    'doc',
    'attrs',
    jsonb_build_object('schemaVersion', 1),
    'content',
    CASE
      WHEN blocks IS NULL OR jsonb_typeof(blocks) <> 'array' OR jsonb_array_length(blocks) = 0
        THEN jsonb_build_array("t020_content_paragraph"(NULL))
      ELSE blocks
    END
  );
$$ LANGUAGE sql;

-- Список legacy-узлов → документ: один узел даёт один абзац, порядок сохраняется.
CREATE OR REPLACE FUNCTION "t020_legacy_nodes_to_document"(nodes jsonb) RETURNS jsonb AS $$
DECLARE
  node jsonb;
  blocks jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(nodes) <> 'array' THEN
    RETURN NULL;
  END IF;

  FOR node IN SELECT value FROM jsonb_array_elements(nodes) AS value LOOP
    blocks := blocks || "t020_content_paragraph"("t020_legacy_node_text"(node));
  END LOOP;

  RETURN "t020_content_document"(blocks);
END;
$$ LANGUAGE plpgsql;

-- Обычный текст → документ: каждая непустая строка становится абзацем. Перевод строки внутри
-- абзаца смысла в документе не имеет, а пустые строки разделяли абзацы и в исходном тексте.
CREATE OR REPLACE FUNCTION "t020_text_to_document"(body text) RETURNS jsonb AS $$
DECLARE
  line text;
  blocks jsonb := '[]'::jsonb;
BEGIN
  FOR line IN SELECT btrim(value) FROM regexp_split_to_table(coalesce(body, ''), '\r\n|\r|\n') AS value LOOP
    IF line <> '' THEN
      blocks := blocks || "t020_content_paragraph"(line);
    END IF;
  END LOOP;

  RETURN "t020_content_document"(blocks);
END;
$$ LANGUAGE plpgsql;

-- Тело уже является документом каталога: корень `doc` с целой версией схемы.
CREATE OR REPLACE FUNCTION "t020_is_content_document"(body jsonb) RETURNS boolean AS $$
  SELECT jsonb_typeof(body) = 'object'
    AND body ->> 'type' = 'doc'
    AND jsonb_typeof(body -> 'attrs' -> 'schemaVersion') = 'number';
$$ LANGUAGE sql;

-- Legacy-корень: объект с массивом `children` (форма прежнего редактора) либо документ каталога.
CREATE OR REPLACE FUNCTION "t020_is_legacy_root"(body jsonb) RETURNS boolean AS $$
  SELECT "t020_is_content_document"(body)
    OR (jsonb_typeof(body) = 'object' AND jsonb_typeof(body -> 'children') = 'array');
$$ LANGUAGE sql;

-- Единственная реализация конверсии тела в документ `content`.
--
-- `NULL` означает отказ: такое тело нельзя привести к документу, не придумывая содержимое.
-- Миграция на таком теле останавливается, а `verify:legacy-bodies` считает его неконвертируемым.
-- Функция идемпотентна: на своём же результате возвращает его без изменений.
CREATE OR REPLACE FUNCTION "t020_legacy_body_to_document"(body jsonb) RETURNS jsonb AS $$
DECLARE
  kind text;
  raw text;
  parsed jsonb;
BEGIN
  IF body IS NULL THEN
    RETURN "t020_content_document"(NULL);
  END IF;

  kind := jsonb_typeof(body);

  IF kind = 'null' THEN
    RETURN "t020_content_document"(NULL);
  END IF;

  IF kind = 'object' THEN
    IF "t020_is_content_document"(body) THEN
      RETURN body;
    END IF;
    IF jsonb_typeof(body -> 'children') = 'array' THEN
      RETURN "t020_legacy_nodes_to_document"(body -> 'children');
    END IF;
    IF jsonb_typeof(body -> 'content') = 'array' THEN
      RETURN "t020_legacy_nodes_to_document"(body -> 'content');
    END IF;
    RETURN NULL;
  END IF;

  IF kind = 'array' THEN
    RETURN "t020_legacy_nodes_to_document"(body);
  END IF;

  IF kind = 'string' THEN
    raw := body #>> '{}';
    IF btrim(coalesce(raw, '')) = '' THEN
      RETURN "t020_content_document"(NULL);
    END IF;
    -- Текст, который сам является JSON, разбирается только если это legacy-корень или документ.
    -- Иначе `{"note": 1}` в теле — это просто текст статьи, и он остаётся текстом.
    BEGIN
      parsed := raw::jsonb;
    EXCEPTION
      WHEN others THEN parsed := NULL;
    END;
    IF parsed IS NOT NULL AND "t020_is_legacy_root"(parsed) THEN
      RETURN "t020_legacy_body_to_document"(parsed);
    END IF;
    RETURN "t020_text_to_document"(raw);
  END IF;

  -- Число и boolean: текста в них нет, конверсия была бы выдумкой.
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Снимок количеств до конверсии: критерий готовности T-020 требует сверки числа статей.
CREATE TEMP TABLE "_t020_before_counts" (
  "articles" BIGINT NOT NULL,
  "translations" BIGINT NOT NULL,
  "revisions" BIGINT NOT NULL
) ON COMMIT DROP;

INSERT INTO "_t020_before_counts"
SELECT
  (SELECT COUNT(*) FROM "articles"),
  (SELECT COUNT(*) FROM "article_translations"),
  (SELECT COUNT(*) FROM "article_revisions");

-- Конверсия. Неконвертируемое тело намеренно не обновляется: его находит постпроверка ниже
-- и останавливает всю транзакцию. Отдельной предпроверки здесь нет — она бы выбросила ошибку
-- в середине файла, а Prisma показывает сообщение только последнего оператора, и вместо
-- диагноза оператор увидел бы «current transaction is aborted».
-- Результат конверсии считается один раз на строку: функция выдаёт `attrs.id` абзацев через
-- `gen_random_uuid()`, поэтому вызывать её и в `SET`, и в `WHERE` значило бы делать работу дважды.
UPDATE "article_translations" AS target
SET "body" = converted."document"
FROM (
  SELECT "id", "t020_legacy_body_to_document"("body") AS "document"
  FROM "article_translations"
  WHERE NOT "t020_is_content_document"("body")
) AS converted
WHERE target."id" = converted."id" AND converted."document" IS NOT NULL;

UPDATE "article_revisions" AS target
SET "body" = converted."document"
FROM (
  SELECT "id", "t020_legacy_body_to_document"("body") AS "document"
  FROM "article_revisions"
  WHERE NOT "t020_is_content_document"("body")
) AS converted
WHERE target."id" = converted."id" AND converted."document" IS NOT NULL;

-- Trigger T-015 переводится на запись документа. До API cutover `articles.body` остаётся
-- источником записи для действующих резолверов, поэтому trigger сохраняется, но больше
-- не создаёт JSON-строку вместо документа.
CREATE OR REPLACE FUNCTION "t015_sync_legacy_article"() RETURNS trigger AS $$
DECLARE
  translation_id TEXT;
  document JSONB;
BEGIN
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

-- Постпроверка в той же транзакции: конверсия не создаёт и не удаляет строки, и ни одного
-- тела-недокумента не остаётся.
DO $$
DECLARE
  before_articles BIGINT;
  before_translations BIGINT;
  before_revisions BIGINT;
  leftovers BIGINT;
BEGIN
  SELECT "articles", "translations", "revisions"
  INTO before_articles, before_translations, before_revisions
  FROM "_t020_before_counts";

  IF before_articles <> (SELECT COUNT(*) FROM "articles")
    OR before_translations <> (SELECT COUNT(*) FROM "article_translations")
    OR before_revisions <> (SELECT COUNT(*) FROM "article_revisions") THEN
    RAISE EXCEPTION 'T-020: число статей, версий или ревизий изменилось при конверсии'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)
  INTO leftovers
  FROM (
    SELECT "body" FROM "article_translations"
    UNION ALL
    SELECT "body" FROM "article_revisions"
  ) AS bodies
  WHERE NOT "t020_is_content_document"("body");

  IF leftovers > 0 THEN
    RAISE EXCEPTION 'T-020: тел материалов, не приводимых к документу content: %; какие именно — покажет pnpm verify:legacy-bodies', leftovers
      USING ERRCODE = 'P0001';
  END IF;
END $$;
