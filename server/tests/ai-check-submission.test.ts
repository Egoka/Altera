/**
 * T-048, критерий готовности 2: текст для проверки не содержит имени и e-mail автора.
 *
 * Проверяется с двух сторон: выборка загрузчика не запрашивает полей автора вообще, и сборщик
 * подачи отдаёт закрытый перечень полей — даже если в него передать запись с данными автора,
 * в подачу они не попадут (`legal-content-rules.md` §4, `write-and-publish.md` шаг 3).
 */

import { createDocument, createFigure, createHeading, createParagraph, createText } from "@altera/content"
import { describe, expect, it } from "vitest"
import {
  AI_CHECK_REVISION_SELECT,
  AI_CHECK_SOURCE_SELECT,
  buildAiCheckSubmission,
  loadAiCheckSource,
  type AiCheckSource
} from "../src/ai/submission"
import { createAiCheckMemoryStore, type AiCheckStoreFixture } from "./helpers/ai-check-memory-store"

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
}

const TRANSLATION_ID = "translation-1"
const REVISION_ID = "revision-1"
const COVER_ID = uuid(900)
const BODY_ASSET_ID = uuid(901)

const AUTHOR_NAME = "Мария Иванова"
const AUTHOR_EMAIL = "maria@example.test"
const AUTHOR_HANDLE = "maria"

/** Все ключи выборки, включая вложенные `select`. */
function selectKeys(select: unknown, keys: string[] = []): string[] {
  if (!select || typeof select !== "object") return keys
  for (const [key, value] of Object.entries(select as Record<string, unknown>)) {
    // `orderBy` — порядок выборки, а не запрошенное поле: в перечень полей он не входит.
    if (key === "orderBy") continue
    if (key === "select") {
      selectKeys(value, keys)
      continue
    }
    keys.push(key)
    if (value && typeof value === "object") selectKeys(value, keys)
  }
  return keys
}

/** Все строковые значения объекта на любой глубине. */
function stringValues(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") found.push(value)
  else if (Array.isArray(value)) for (const item of value) stringValues(item, found)
  else if (value && typeof value === "object") for (const item of Object.values(value)) stringValues(item, found)
  return found
}

function fixture(): AiCheckStoreFixture {
  return {
    translationId: TRANSLATION_ID,
    revisionId: REVISION_ID,
    locale: "ru",
    title: "Вечер на Оке",
    dek: "Как выглядит река в октябре",
    body: createDocument([
      createParagraph([createText("Первый абзац.")], uuid(1)),
      createHeading(2, [createText("Подзаголовок")], uuid(2)),
      createFigure(BODY_ASSET_ID, "wide", uuid(3)),
      createParagraph([createText("Последний абзац.")], uuid(4))
    ]),
    sectionSlug: "culture",
    tags: ["reka", "osen"],
    coverAssetId: COVER_ID,
    media: [
      {
        id: COVER_ID,
        alt: "Река в тумане",
        caption: "Ока у Каширы",
        attribution: "Фото: пресс-служба музея",
        license: "own",
        licenseNote: null
      },
      {
        id: BODY_ASSET_ID,
        alt: null,
        caption: "Берег",
        attribution: "Архив автора",
        license: "cc_by",
        licenseNote: "CC BY 4.0"
      }
    ]
  }
}

describe("экстрактор подачи для AI-проверки", () => {
  it("выборка загрузчика не запрашивает имя, e-mail и хэндл автора", () => {
    const keys = [...selectKeys(AI_CHECK_SOURCE_SELECT), ...selectKeys(AI_CHECK_REVISION_SELECT)]

    for (const forbidden of [
      "author",
      "authorId",
      "name",
      "email",
      "handle",
      "translator",
      "createdBy",
      "createdById"
    ]) {
      expect(keys).not.toContain(forbidden)
    }
    expect([...new Set(selectKeys(AI_CHECK_SOURCE_SELECT))].sort()).toEqual([
      "article",
      "coverAssetId",
      "dek",
      "id",
      "locale",
      "section",
      "slug",
      "tags",
      "title"
    ])
    expect([...new Set(selectKeys(AI_CHECK_REVISION_SELECT))].sort()).toEqual(["body", "dek", "id", "title"])
  })

  it("подача содержит ровно разрешённый перечень полей", async () => {
    const memory = createAiCheckMemoryStore(fixture())
    const source = await loadAiCheckSource(memory.store, {
      translationId: TRANSLATION_ID,
      revisionId: REVISION_ID
    })

    const submission = buildAiCheckSubmission(source)

    expect(Object.keys(submission).sort()).toEqual([
      "adultMarkedByAuthor",
      "blocks",
      "dek",
      "images",
      "locale",
      "revisionId",
      "sectionSlug",
      "tags",
      "title",
      "translationId"
    ])
    expect(Object.keys(submission.images[0]).sort()).toEqual([
      "alt",
      "assetId",
      "attribution",
      "caption",
      "license",
      "licenseNote",
      "role"
    ])
  })

  it("данные автора не попадают в подачу, даже если пришли вместе с записью", async () => {
    const memory = createAiCheckMemoryStore(fixture())
    const source = await loadAiCheckSource(memory.store, {
      translationId: TRANSLATION_ID,
      revisionId: REVISION_ID
    })
    // Загрузчик автора не читает, поэтому сюда он подставлен вручную: так проверяется, что
    // сборщик подачи берёт только известные ему поля, а не расширенную запись целиком.
    const widened = {
      ...source,
      translation: {
        ...source.translation,
        article: {
          ...source.translation.article,
          author: { name: AUTHOR_NAME, email: AUTHOR_EMAIL, handle: AUTHOR_HANDLE }
        }
      }
    } as AiCheckSource

    const submission = buildAiCheckSubmission(widened)
    const values = stringValues(submission)

    expect(values).not.toContain(AUTHOR_NAME)
    expect(values).not.toContain(AUTHOR_EMAIL)
    expect(values).not.toContain(AUTHOR_HANDLE)
    expect(JSON.stringify(submission)).not.toContain(AUTHOR_EMAIL)
    expect(values.some((value) => value.includes("@"))).toBe(false)
  })

  it("текст подачи идёт по порядку блоков, подписи изображений в него не попадают", async () => {
    const memory = createAiCheckMemoryStore(fixture())
    const source = await loadAiCheckSource(memory.store, {
      translationId: TRANSLATION_ID,
      revisionId: REVISION_ID
    })

    const submission = buildAiCheckSubmission(source)

    expect(submission.blocks).toBe("Первый абзац.\n\nПодзаголовок\n\nПоследний абзац.")
    expect(submission.blocks).not.toContain("Берег")
    expect(submission.title).toBe("Вечер на Оке")
    expect(submission.dek).toBe("Как выглядит река в октябре")
    expect(submission.locale).toBe("ru")
    expect(submission.sectionSlug).toBe("culture")
    expect(submission.tags).toEqual(["reka", "osen"])
    expect(submission.adultMarkedByAuthor).toBe(false)
  })

  it("изображения подачи начинаются с обложки и несут атрибуцию и лицензию", async () => {
    const memory = createAiCheckMemoryStore(fixture())
    const source = await loadAiCheckSource(memory.store, {
      translationId: TRANSLATION_ID,
      revisionId: REVISION_ID
    })

    const submission = buildAiCheckSubmission(source)

    expect(submission.images).toEqual([
      {
        assetId: COVER_ID,
        role: "cover",
        alt: "Река в тумане",
        caption: "Ока у Каширы",
        attribution: "Фото: пресс-служба музея",
        license: "own",
        licenseNote: null
      },
      {
        assetId: BODY_ASSET_ID,
        role: "body",
        alt: null,
        caption: "Берег",
        attribution: "Архив автора",
        license: "cc_by",
        licenseNote: "CC BY 4.0"
      }
    ])
  })

  it("ревизия из другой версии не загружается", async () => {
    const memory = createAiCheckMemoryStore(fixture())

    await expect(
      loadAiCheckSource(memory.store, { translationId: TRANSLATION_ID, revisionId: "revision-other" })
    ).rejects.toThrow("Article revision not found for this translation")
    await expect(
      loadAiCheckSource(memory.store, { translationId: "translation-other", revisionId: REVISION_ID })
    ).rejects.toThrow("Article translation not found")
  })
})
