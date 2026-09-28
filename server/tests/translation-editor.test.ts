import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import { createDocument, createParagraph, createText } from "@altera/content"
import {
  authoringTaxonomy,
  getEditorTranslation,
  listRevisions,
  restoreRevision,
  saveTranslation,
  setSlug,
  setTaxonomy,
  submitTranslation,
  withdrawTranslation
} from "../src/translation/editor"

/**
 * T-040: обвязка редактора (`docs/spec/30-account/author/article-edit.md`).
 *
 * Критерий 1 — сохранение с устаревшей базовой ревизией отвечает `CONFLICT` (ADR-0033).
 * Критерий 2 — подача без обложки отклоняется (журнал §29.1).
 */

const NODE_ID = "0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a7b"
const body = (text = "Текст материала") => createDocument([createParagraph([createText(text)], NODE_ID)])

const author = {
  id: "author-1",
  name: "Пётр Соколов",
  handle: "petr",
  role: "author",
  archivedAt: null,
  planTier: "standard",
  planUntil: new Date("2099-01-01T00:00:00.000Z"),
  locale: "ru"
}

const expiredAuthor = { ...author, planUntil: new Date("2020-01-01T00:00:00.000Z") }

/** Готовая обложка: запись `ready`, у которой собран хотя бы один кадр карточки. */
const readyCover = {
  id: "cover-1",
  processingStatus: "ready",
  deletedAt: null,
  alt: "Вид на залив",
  focalX: 0.5,
  focalY: 0.5,
  variants: {
    version: 1,
    placeholder: null,
    thumbnailWidth: 480,
    focal: { x: 0.5, y: 0.5 },
    items: [{ format: "webp", width: 960, height: 480, key: "a/lede-w960.webp", byteSize: 10, crop: "lede" }]
  }
}

const translation = (overrides: Record<string, unknown> = {}, articleOverrides: Record<string, unknown> = {}) => ({
  id: "translation-1",
  articleId: "article-1",
  locale: "ru",
  slug: "draft-article-1",
  title: "Заголовок",
  dek: "Лид",
  excerpt: null,
  body: body(),
  status: "draft",
  rejected: false,
  publishedAt: null,
  reeditUntil: null,
  updatedAt: new Date("2026-09-28T10:00:00.000Z"),
  article: {
    id: "article-1",
    authorId: "author-1",
    isEditorial: false,
    status: "draft",
    sourceLocale: "ru",
    coverAssetId: "cover-1",
    firstPublishedAt: null,
    section: { id: "section-1", slug: "culture", name: "Культура", status: "active" },
    format: null,
    tags: [],
    translations: [{ id: "translation-1", locale: "ru", status: "draft", rejected: false }],
    ...articleOverrides
  },
  revisions: [{ id: "revision-9" }],
  ...overrides
})

interface PrismaDouble {
  articleTranslation: Record<string, ReturnType<typeof vi.fn>>
  articleRevision: Record<string, ReturnType<typeof vi.fn>>
  article: Record<string, ReturnType<typeof vi.fn>>
  mediaAsset: Record<string, ReturnType<typeof vi.fn>>
  section: Record<string, ReturnType<typeof vi.fn>>
  format: Record<string, ReturnType<typeof vi.fn>>
  tag: Record<string, ReturnType<typeof vi.fn>>
  $executeRawUnsafe: ReturnType<typeof vi.fn>
  $transaction: ReturnType<typeof vi.fn>
}

const prismaDouble = (overrides: Partial<Record<string, unknown>> = {}): PrismaDouble => {
  const client: PrismaDouble = {
    articleTranslation: {
      findUnique: vi.fn().mockResolvedValue(translation()),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0)
    },
    articleRevision: {
      create: vi.fn().mockResolvedValue({ id: "revision-10", createdAt: new Date("2026-09-28T10:05:00.000Z") }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null)
    },
    article: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({})
    },
    mediaAsset: { findUnique: vi.fn().mockResolvedValue(readyCover) },
    section: { findFirst: vi.fn().mockResolvedValue({ id: "section-1" }), findMany: vi.fn().mockResolvedValue([]) },
    format: { findFirst: vi.fn().mockResolvedValue({ id: "format-1" }), findMany: vi.fn().mockResolvedValue([]) },
    tag: { count: vi.fn().mockResolvedValue(0) },
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(),
    ...(overrides as object)
  } as PrismaDouble
  // Транзакция выполняет обратный вызов на том же двойнике: writer работает одним клиентом.
  client.$transaction.mockImplementation((run: (tx: PrismaDouble) => unknown) => run(client))
  return client
}

const context = (prisma: PrismaDouble, currentUser: object | null = author) =>
  ({
    prisma,
    currentUser,
    requestId: "request-1",
    logger: { log: vi.fn() },
    cache: { delByTags: vi.fn() },
    media: { mediaBaseUrl: "https://media.example" }
  }) as never

const extensionsOf = async (call: Promise<unknown>) => {
  const error = await call.then(
    () => null,
    (reason: unknown) => reason
  )
  expect(error, "ожидался отказ API").toBeInstanceOf(GraphQLError)
  return (error as GraphQLError).extensions
}

describe("T-040 сохранение версии", () => {
  it("критерий 1: устаревшая базовая ревизия отвечает CONFLICT и называет свежую", async () => {
    const prisma = prismaDouble()

    const extensions = await extensionsOf(
      saveTranslation(context(prisma), {
        id: "translation-1",
        baseRevisionId: "revision-8",
        patch: { title: "Новый заголовок" },
        kind: "autosave"
      })
    )

    expect(extensions).toMatchObject({
      code: "CONFLICT",
      entity: "revision",
      expected: "revision-9",
      actual: "revision-8"
    })
    expect(prisma.articleRevision.create).not.toHaveBeenCalled()
    expect(prisma.articleTranslation.update).not.toHaveBeenCalled()
  })

  it("свежая базовая ревизия сохраняет снимок и возвращает новую ревизию", async () => {
    const prisma = prismaDouble()

    const result = await saveTranslation(context(prisma), {
      id: "translation-1",
      baseRevisionId: "revision-9",
      patch: { title: "Новый заголовок", lead: "  ", body: body("Другой текст") },
      kind: "autosave"
    })

    expect(result).toEqual({ revisionId: "revision-10", savedAt: "2026-09-28T10:05:00.000Z" })
    expect(prisma.articleRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Новый заголовок",
          dek: null,
          kind: "autosave",
          createdById: "author-1"
        })
      })
    )
    expect(prisma.articleTranslation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "translation-1" } })
    )
  })

  it("наследная строка обновляется той же транзакцией с выключенной синхронизацией", async () => {
    const prisma = prismaDouble()

    await saveTranslation(context(prisma), {
      id: "translation-1",
      baseRevisionId: "revision-9",
      patch: { title: "Заголовок версии", body: body("Текст версии") },
      kind: "manual"
    })

    // Без выключенной синхронизации trigger переписал бы версию наследными значениями.
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(`SET LOCAL "altera.legacy_sync" = 'off'`)
    const mirrored = prisma.article.update.mock.calls[0]?.[0] as { data: { title: string; body: string } }
    expect(mirrored.data.title).toBe("Заголовок версии")
    // В наследное тело кладётся сериализованный документ: стороннее срабатывание trigger
    // разберёт его обратно без потерь.
    expect(JSON.parse(mirrored.data.body)).toMatchObject({ type: "doc" })
  })

  it("вторая языковая версия наследную строку не трогает", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(translation({ locale: "en" }))

    await saveTranslation(context(prisma), {
      id: "translation-1",
      baseRevisionId: "revision-9",
      patch: { title: "Title" },
      kind: "manual"
    })

    expect(prisma.article.update).not.toHaveBeenCalled()
  })

  it("тело не по схеме каталога отклоняется до записи", async () => {
    const prisma = prismaDouble()

    const extensions = await extensionsOf(
      saveTranslation(context(prisma), {
        id: "translation-1",
        baseRevisionId: "revision-9",
        patch: { body: { type: "doc", attrs: { schemaVersion: 1 }, content: [{ type: "gallery" }] } },
        kind: "manual"
      })
    )

    expect(extensions).toMatchObject({ code: "CONTENT_INVALID" })
    expect(prisma.articleRevision.create).not.toHaveBeenCalled()
  })

  it("отклонённая редакцией версия не сохраняется", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(translation({ rejected: true }))

    const extensions = await extensionsOf(
      saveTranslation(context(prisma), {
        id: "translation-1",
        baseRevisionId: "revision-9",
        patch: { title: "Правка" },
        kind: "manual"
      })
    )

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "translation.save" })
  })

  it("истёкший план отвечает PLAN_LIMIT, а не отказом доступа", async () => {
    const prisma = prismaDouble()

    const extensions = await extensionsOf(
      saveTranslation(context(prisma, expiredAuthor), {
        id: "translation-1",
        baseRevisionId: "revision-9",
        patch: { title: "Правка" },
        kind: "autosave"
      })
    )

    expect(extensions).toMatchObject({ code: "PLAN_LIMIT", requiredTier: "standard" })
  })
})

describe("T-040 подача к публикации", () => {
  it("критерий 2: подача без обложки отвечает VALIDATION_ERROR", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(translation({}, { coverAssetId: null }))

    const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "cover", rule: "required" })
    expect(prisma.articleTranslation.update).not.toHaveBeenCalled()
  })

  it("критерий 2: незаконченная обработка обложки подачу тоже не пропускает", async () => {
    const prisma = prismaDouble()
    prisma.mediaAsset.findUnique.mockResolvedValue({ ...readyCover, processingStatus: "processing" })

    const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "cover", rule: "processing" })
  })

  it("подача без рубрики отклоняется: рубрика обязательна перед проверкой", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(translation({}, { section: null }))

    const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "sectionId", rule: "required" })
  })

  it("подача без текста отклоняется", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(translation({ body: body("   ") }))

    const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "body", rule: "required" })
  })

  it("заполненная версия уходит в review", async () => {
    const prisma = prismaDouble()

    const result = await submitTranslation(context(prisma), "translation-1")

    expect(result.status).toBe("review")
    expect(prisma.articleTranslation.update).toHaveBeenCalledWith({
      where: { id: "translation-1" },
      data: { status: "review" }
    })
    expect(prisma.article.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "review" }) })
    )
  })

  it("очередь из пяти материалов останавливает шестую подачу", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.count.mockResolvedValue(5)

    const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "PLAN_LIMIT", limit: 5, current: 5 })
  })

  it("поданная версия отзывается в черновик", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(translation({ status: "review" }))

    const result = await withdrawTranslation(context(prisma), "translation-1")

    expect(result.status).toBe("draft")
    expect(prisma.articleTranslation.update).toHaveBeenCalledWith({
      where: { id: "translation-1" },
      data: { status: "draft" }
    })
  })
})

describe("T-040 режим чтения и доступ", () => {
  it.each([
    ["rejected", translation({ rejected: true }), author, "rejected"],
    ["ai_check", translation({ status: "ai_check" }), author, "ai_check"],
    ["review", translation({ status: "review" }), author, "in_review"],
    ["архив материала", translation({}, { status: "archived" }), author, "archived"],
    ["опубликована", translation({ status: "published" }), author, "published"],
    ["истёкший план", translation(), expiredAuthor, "plan"],
    ["черновик с планом", translation(), author, "none"]
  ])("%s даёт readOnlyReason %s", async (_name, record, user, expected) => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(record)

    const view = await getEditorTranslation(context(prisma, user), "translation-1")

    expect(view.readOnlyReason).toBe(expected)
    expect(view.currentRevisionId).toBe("revision-9")
  })

  it("чужая версия отвечает NOT_FOUND, а не отказом доступа", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(translation({}, { authorId: "author-2" }))

    const extensions = await extensionsOf(getEditorTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "NOT_FOUND", entity: "translation" })
  })

  it("гость отвечает UNAUTHENTICATED", async () => {
    const extensions = await extensionsOf(getEditorTranslation(context(prismaDouble(), null), "translation-1"))

    expect(extensions).toMatchObject({ code: "UNAUTHENTICATED" })
  })
})

describe("T-040 ревизии, таксономия и адрес", () => {
  it("список ревизий отдаёт размер текста и курсор", async () => {
    const prisma = prismaDouble()
    prisma.articleRevision.findMany.mockResolvedValue([
      { id: "revision-9", createdAt: new Date("2026-09-28T10:00:00.000Z"), kind: "manual", body: body("Пять") },
      { id: "revision-8", createdAt: new Date("2026-09-28T09:00:00.000Z"), kind: "autosave", body: body("Текст") }
    ])

    const page = await listRevisions(context(prisma), "translation-1", null, 2)

    expect(page.items).toEqual([
      { id: "revision-9", createdAt: "2026-09-28T10:00:00.000Z", kind: "manual", size: 4 },
      { id: "revision-8", createdAt: "2026-09-28T09:00:00.000Z", kind: "autosave", size: 5 }
    ])
    expect(page.hasNextPage).toBe(false)
    expect(page.endCursor).toBe("revision-8")
  })

  it("восстановление снимка заводит новую ревизию со ссылкой на источник", async () => {
    const prisma = prismaDouble()
    prisma.articleRevision.findFirst.mockResolvedValue({
      id: "revision-3",
      title: "Старый заголовок",
      dek: null,
      excerpt: null,
      body: body("Старый текст")
    })

    const result = await restoreRevision(context(prisma), "translation-1", "revision-3")

    expect(result.revisionId).toBe("revision-10")
    expect(prisma.articleRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "Старый заголовок", kind: "manual", restoredFromId: "revision-3" })
      })
    )
  })

  it("архивированная рубрика в редакторе не выбирается", async () => {
    const prisma = prismaDouble()
    prisma.article.findUnique.mockResolvedValue({
      id: "article-1",
      authorId: "author-1",
      isEditorial: false,
      status: "draft"
    })
    prisma.section.findFirst.mockResolvedValue(null)

    const extensions = await extensionsOf(
      setTaxonomy(context(prisma), { articleId: "article-1", sectionId: "section-9", formatId: null, tagIds: [] })
    )

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "sectionId", rule: "active" })
  })

  it("адрес меняется до первой публикации и закрыт после неё", async () => {
    const prisma = prismaDouble()
    await setSlug(context(prisma), "translation-1", "Moj-Material")
    expect(prisma.articleTranslation.update).toHaveBeenCalledWith({
      where: { id: "translation-1" },
      data: { slug: "moj-material" }
    })

    const published = prismaDouble()
    published.articleTranslation.findUnique.mockResolvedValue(
      translation({}, { firstPublishedAt: new Date("2026-09-01T00:00:00.000Z") })
    )
    const extensions = await extensionsOf(setSlug(context(published), "translation-1", "novyj-adres"))
    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "translation.setSlug" })
  })

  it("занятый адрес отвечает CONFLICT", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findFirst.mockResolvedValue({ id: "translation-2" })

    const extensions = await extensionsOf(setSlug(context(prisma), "translation-1", "zanyato"))

    expect(extensions).toMatchObject({ code: "CONFLICT", entity: "slug" })
  })

  it("справочник редактора отдаёт только действующие рубрики и форматы", async () => {
    const prisma = prismaDouble()
    prisma.section.findMany.mockResolvedValue([{ id: "section-1", name: "Культура" }])
    prisma.format.findMany.mockResolvedValue([{ id: "format-1", name: "Эссе" }])

    const result = await authoringTaxonomy(context(prisma))

    expect(result.sections).toHaveLength(1)
    expect(prisma.section.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "active" } }))
    expect(prisma.format.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "active" } }))
  })
})
