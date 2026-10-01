import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import { createDocument, createFigure, createParagraph, createText } from "@altera/content"
import {
  authoringTaxonomy,
  getEditorTranslation,
  listRevisions,
  reeditTranslation,
  restoreRevision,
  saveTranslation,
  saveTranslationPublished,
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
const FIGURE_ID = "0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a7c"
const BODY_ASSET_ID = "0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a7d"
const body = (text = "Текст материала") => createDocument([createParagraph([createText(text)], NODE_ID)])
const bodyWithImage = () =>
  createDocument([
    createParagraph([createText("Текст материала")], NODE_ID),
    createFigure(BODY_ASSET_ID, "normal", FIGURE_ID)
  ])

const author = {
  id: "author-1",
  name: "Пётр Соколов",
  handle: "petr",
  handleConfirmed: true,
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
  attribution: "Фото: автор",
  license: "own",
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
  reeditedAt: null,
  updatedAt: new Date("2026-09-28T10:00:00.000Z"),
  article: {
    id: "article-1",
    authorId: "author-1",
    author: { name: "Пётр Соколов", handle: "petr", handleConfirmed: true },
    isEditorial: false,
    status: "draft",
    sourceLocale: "ru",
    coverAssetId: "cover-1",
    firstPublishedAt: null,
    section: { id: "section-1", slug: "culture", name: "Культура", status: "active" },
    format: null,
    tags: [],
    translations: [{ id: "translation-1", locale: "ru", status: "draft", rejected: false }],
    publishedEdit: null,
    ...articleOverrides
  },
  revisions: [{ id: "revision-9" }],
  ...overrides
})

interface PrismaDouble {
  articleTranslation: Record<string, ReturnType<typeof vi.fn>>
  articleSlugHistory: Record<string, ReturnType<typeof vi.fn>>
  articleRevision: Record<string, ReturnType<typeof vi.fn>>
  article: Record<string, ReturnType<typeof vi.fn>>
  auditLog: Record<string, ReturnType<typeof vi.fn>>
  mediaAsset: Record<string, ReturnType<typeof vi.fn>>
  job: Record<string, ReturnType<typeof vi.fn>>
  aiProcess: Record<string, ReturnType<typeof vi.fn>>
  publishedArticleEdit: Record<string, ReturnType<typeof vi.fn>>
  section: Record<string, ReturnType<typeof vi.fn>>
  format: Record<string, ReturnType<typeof vi.fn>>
  tag: Record<string, ReturnType<typeof vi.fn>>
  $queryRaw: ReturnType<typeof vi.fn>
  $executeRawUnsafe: ReturnType<typeof vi.fn>
  $transaction: ReturnType<typeof vi.fn>
}

const prismaDouble = (overrides: Partial<Record<string, unknown>> = {}): PrismaDouble => {
  const client: PrismaDouble = {
    articleTranslation: {
      findUnique: vi.fn().mockResolvedValue(translation()),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0)
    },
    articleSlugHistory: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({})
    },
    articleRevision: {
      create: vi.fn().mockResolvedValue({ id: "revision-10", createdAt: new Date("2026-09-28T10:05:00.000Z") }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null)
    },
    article: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({})
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    mediaAsset: {
      findUnique: vi.fn().mockResolvedValue(readyCover),
      findMany: vi.fn().mockResolvedValue([readyCover])
    },
    job: { create: vi.fn().mockResolvedValue({ id: "job-1" }) },
    aiProcess: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "ai-process-1" })
    },
    publishedArticleEdit: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "edit-1" }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    section: { findFirst: vi.fn().mockResolvedValue({ id: "section-1" }), findMany: vi.fn().mockResolvedValue([]) },
    format: { findFirst: vi.fn().mockResolvedValue({ id: "format-1" }), findMany: vi.fn().mockResolvedValue([]) },
    tag: { count: vi.fn().mockResolvedValue(0) },
    $queryRaw: vi.fn().mockResolvedValue([]),
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

  it("повторно проверяет базовую ревизию под блокировкой перед записью", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique
      .mockResolvedValueOnce(translation())
      .mockResolvedValueOnce(translation({ revisions: [{ id: "revision-10" }] }))

    const extensions = await extensionsOf(
      saveTranslation(context(prisma), {
        id: "translation-1",
        baseRevisionId: "revision-9",
        patch: { title: "Устаревшая правка" },
        kind: "manual"
      })
    )

    expect(extensions).toMatchObject({
      code: "CONFLICT",
      entity: "revision",
      expected: "revision-10",
      actual: "revision-9"
    })
    expect(prisma.$queryRaw).toHaveBeenCalled()
    expect(prisma.articleRevision.create).not.toHaveBeenCalled()
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
  it("не пропускает первую подачу с выданным, но не подтверждённым хэндлом", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(
      translation({}, { author: { name: "Пётр Соколов", handle: "petr", handleConfirmed: false } })
    )

    const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "profile", rule: "required" })
    expect(prisma.articleTranslation.update).not.toHaveBeenCalled()
  })

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

  it("подача с архивной рубрикой отклоняется", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(
      translation({}, { section: { id: "section-1", slug: "culture", name: "Культура", status: "archived" } })
    )

    const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "sectionId", rule: "active" })
  })

  it("подача без текста отклоняется", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(translation({ body: body("   ") }))

    const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "body", rule: "required" })
  })

  it("подача без заголовка отклоняется", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(translation({ title: "  " }))

    const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "title", rule: "required" })
  })

  it("первая подача без публичного имени отклоняется", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(
      translation({}, { author: { name: "", handle: "petr", handleConfirmed: true } })
    )

    const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "profile", rule: "required" })
  })

  it("для редакционного материала проверяет профиль автора, а не редактора", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(
      translation({}, { isEditorial: true, author: { name: "", handle: "" } })
    )
    const editor = { ...author, id: "editor-1", name: "Редактор", handle: "editor", role: "editor" }

    const extensions = await extensionsOf(submitTranslation(context(prisma, editor), "translation-1"))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "profile", rule: "required" })
    expect(prisma.job.create).not.toHaveBeenCalled()
  })

  it("редакционный материал не требует от сотрудника подтверждённого хэндла", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(
      translation({}, { isEditorial: true, author: { name: "Редакция", handle: "editor", handleConfirmed: false } })
    )
    const editor = { ...author, id: "editor-1", name: "Редактор", handle: "editor", role: "editor" }

    const result = await submitTranslation(context(prisma, editor), "translation-1")

    expect(result.status).toBe("ai_check")
  })

  it("первая подача атомарно переводит версию в ai_check и ставит задание", async () => {
    const prisma = prismaDouble()

    const result = await submitTranslation(context(prisma), "translation-1")

    expect(result.status).toBe("ai_check")
    expect(result.currentRevisionId).toBe("revision-9")
    expect(prisma.articleTranslation.updateMany).toHaveBeenCalledWith({
      where: { id: "translation-1", status: "draft", rejected: false },
      data: { status: "ai_check" }
    })
    expect(prisma.article.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ai_check" }) })
    )
    expect(prisma.job.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "ai.check", objectId: "translation-1" }) })
    )
    expect(prisma.aiProcess.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revisionId: "revision-9" }) })
    )
    const locks = prisma.$queryRaw.mock.calls.map(([query]) => (query as { strings: string[] }).strings.join(" "))
    expect(locks.some((query) => query.includes('FROM "article_translations"') && query.includes("FOR UPDATE"))).toBe(
      true
    )
    expect(locks.some((query) => query.includes('FROM "users"') && query.includes("FOR UPDATE"))).toBe(true)
  })

  it("после сохранённого отказа AI повторная подача идёт в review без нового задания", async () => {
    const prisma = prismaDouble()
    prisma.aiProcess.findFirst.mockResolvedValue({ id: "ai-process-rejected" })

    const result = await submitTranslation(context(prisma), "translation-1")

    expect(result.status).toBe("review")
    expect(prisma.articleTranslation.updateMany).toHaveBeenCalledWith({
      where: { id: "translation-1", status: "draft", rejected: false },
      data: { status: "review" }
    })
    expect(prisma.job.create).not.toHaveBeenCalled()
    expect(prisma.aiProcess.create).not.toHaveBeenCalled()
  })

  it("повторная подача после ручной доработки остаётся в ветке review", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(translation({ status: "rework" }))

    const result = await submitTranslation(context(prisma), "translation-1")

    expect(result.status).toBe("review")
    expect(prisma.job.create).not.toHaveBeenCalled()
  })

  it("подача с изображением без атрибуции отклоняется до задания", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(translation({ body: bodyWithImage() }))
    prisma.mediaAsset.findMany.mockResolvedValue([
      readyCover,
      { id: BODY_ASSET_ID, attribution: "", license: "cc_by", deletedAt: null, processingStatus: "ready" }
    ])

    const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "images", rule: "license" })
    expect(prisma.job.create).not.toHaveBeenCalled()
  })

  it("чужая версия отвечает FORBIDDEN до любого перехода", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(translation({}, { authorId: "author-2" }))

    const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "translation.submit" })
    expect(prisma.articleTranslation.updateMany).not.toHaveBeenCalled()
  })

  it.each(["ai_check", "review"])("подача из статуса %s отвечает CONFLICT", async (status) => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(translation({ status }))

    const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "CONFLICT", entity: "translation", actual: status })
    expect(prisma.job.create).not.toHaveBeenCalled()
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
    expect(prisma.articleTranslation.updateMany).toHaveBeenCalledWith({
      where: { id: "translation-1", status: "review", rejected: false },
      data: { status: "draft" }
    })
  })

  it("повторная подача отозванной AI-проверки создаёт новую ревизию и новое задание", async () => {
    const prisma = prismaDouble()
    prisma.aiProcess.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "ai-process-withdrawn" })

    const result = await submitTranslation(context(prisma), "translation-1")

    expect(result.status).toBe("ai_check")
    expect(result.currentRevisionId).toBe("revision-10")
    expect(prisma.articleRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ translationId: "translation-1", kind: "manual" }) })
    )
    expect(prisma.aiProcess.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revisionId: "revision-10" }) })
    )
  })

  it.each(["draft", "rework"])("отзыв из статуса %s отвечает CONFLICT", async (status) => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(translation({ status }))

    const extensions = await extensionsOf(withdrawTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "CONFLICT", entity: "translation", actual: status })
    expect(prisma.articleTranslation.updateMany).not.toHaveBeenCalled()
  })
})

describe("T-044 перередактирование после автопубликации", () => {
  const publishedAt = new Date("2026-09-29T10:00:00.000Z")
  const reeditUntil = new Date("2026-09-29T11:00:00.000Z")
  const published = (overrides: Record<string, unknown> = {}) =>
    translation({ status: "published", publishedAt, reeditUntil, reeditedAt: null, ...overrides })

  it("в открытом окне снимает версию в draft, ставит reeditedAt и пишет аудит с withinWindowSec", async () => {
    const prisma = prismaDouble()
    const now = new Date("2026-09-29T10:30:00.000Z")
    prisma.articleTranslation.findUnique.mockResolvedValue(published())
    const ctx = context(prisma)

    const result = await reeditTranslation(ctx, "translation-1", now)

    expect(result.status).toBe("draft")
    expect(result.reeditUntil).toBeNull()
    expect(prisma.articleTranslation.updateMany).toHaveBeenCalledWith({
      where: { id: "translation-1", status: "published", reeditedAt: null },
      data: { status: "draft", publishedAt: null, reeditUntil: null, reeditedAt: now }
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "translation.reedit",
          diff: { translationId: "translation-1", withinWindowSec: 1800 }
        })
      })
    )
    expect((ctx as unknown as { cache: { delByTags: ReturnType<typeof vi.fn> } }).cache.delByTags).toHaveBeenCalled()
  })

  it("критерий 1: второе перередактирование той же версии отвечает FORBIDDEN", async () => {
    const prisma = prismaDouble()
    // Первое перередактирование уже отмечено `reeditedAt`: право не возвращается.
    prisma.articleTranslation.findUnique.mockResolvedValue(
      published({ reeditedAt: new Date("2026-09-29T10:05:00.000Z") })
    )

    const extensions = await extensionsOf(
      reeditTranslation(context(prisma), "translation-1", new Date("2026-09-29T10:10:00.000Z"))
    )

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "translation.reedit" })
    expect(prisma.articleTranslation.updateMany).not.toHaveBeenCalled()
  })

  it("критерий 2: по истечении часового окна действие недоступно — FORBIDDEN", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(published())

    const extensions = await extensionsOf(
      reeditTranslation(context(prisma), "translation-1", new Date("2026-09-29T11:00:01.000Z"))
    )

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "translation.reedit" })
    expect(prisma.articleTranslation.updateMany).not.toHaveBeenCalled()
  })

  it.each(["draft", "ai_check", "review", "rework", "archived"])(
    "версия в статусе %s отвечает FORBIDDEN, а не снимается с публикации",
    async (status) => {
      const prisma = prismaDouble()
      prisma.articleTranslation.findUnique.mockResolvedValue(published({ status }))

      const extensions = await extensionsOf(reeditTranslation(context(prisma), "translation-1"))

      expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "translation.reedit" })
      expect(prisma.articleTranslation.updateMany).not.toHaveBeenCalled()
    }
  )

  it("чужая версия отвечает FORBIDDEN до любого перехода", async () => {
    const prisma = prismaDouble()
    prisma.articleTranslation.findUnique.mockResolvedValue(published({}, { authorId: "author-2" }))

    const extensions = await extensionsOf(reeditTranslation(context(prisma), "translation-1"))

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "translation.reedit" })
    expect(prisma.articleTranslation.updateMany).not.toHaveBeenCalled()
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

describe("T-122 правка опубликованной статьи через проверку", () => {
  const editRevisionBody = body("Исправленный текст")
  const activeEdit = (overrides: Record<string, unknown> = {}) => ({
    id: "edit-1",
    translationId: "translation-1",
    latestRevisionId: "edit-revision-1",
    status: "draft",
    latestRevision: { title: "Исправленный заголовок", dek: "Лид", excerpt: null, body: editRevisionBody },
    ...overrides
  })
  const published = (articleOverrides: Record<string, unknown> = {}) =>
    translation({ status: "published", publishedAt: new Date("2026-09-20T10:00:00.000Z") }, articleOverrides)

  describe("saveTranslationPublished", () => {
    it("критерий 1: первое сохранение заводит копию от текущей ревизии публичного снимка", async () => {
      const prisma = prismaDouble()
      prisma.articleTranslation.findUnique.mockResolvedValue(published())

      const result = await saveTranslationPublished(context(prisma), {
        id: "translation-1",
        baseRevisionId: "revision-9",
        patch: { title: "Новый заголовок" }
      })

      expect(result).toEqual({ revisionId: "revision-10", savedAt: "2026-09-28T10:05:00.000Z" })
      expect(prisma.articleRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ translationId: "translation-1", title: "Новый заголовок", kind: "manual" })
        })
      )
      expect(prisma.publishedArticleEdit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            articleId: "article-1",
            translationId: "translation-1",
            latestRevisionId: "revision-10",
            status: "draft",
            createdById: "author-1"
          })
        })
      )
      // Публичная строка не меняется: редактор пишет только в ревизию и в `PublishedArticleEdit`.
      expect(prisma.articleTranslation.update).not.toHaveBeenCalled()
    })

    it("устаревшая база (ревизия копии сменилась) отвечает CONFLICT", async () => {
      const prisma = prismaDouble()
      prisma.articleTranslation.findUnique.mockResolvedValue(published())
      prisma.publishedArticleEdit.findUnique.mockResolvedValue(activeEdit())

      const extensions = await extensionsOf(
        saveTranslationPublished(context(prisma), {
          id: "translation-1",
          baseRevisionId: "revision-9",
          patch: { title: "Ещё правка" }
        })
      )

      expect(extensions).toMatchObject({ code: "CONFLICT", entity: "revision", expected: "edit-revision-1" })
      expect(prisma.articleRevision.create).not.toHaveBeenCalled()
    })

    it("критерий 3: другая языковая версия статьи уже на проверке отвечает CONFLICT", async () => {
      const prisma = prismaDouble()
      prisma.articleTranslation.findUnique.mockResolvedValue(published())
      prisma.publishedArticleEdit.findUnique.mockResolvedValue(activeEdit({ translationId: "translation-en-1" }))

      const extensions = await extensionsOf(
        saveTranslationPublished(context(prisma), {
          id: "translation-1",
          baseRevisionId: "revision-9",
          patch: { title: "Ещё правка" }
        })
      )

      expect(extensions).toMatchObject({ code: "CONFLICT", entity: "publishedArticleEdit", actual: "otherTranslation" })
      expect(prisma.articleRevision.create).not.toHaveBeenCalled()
    })

    it("критерий 3: копия этой же версии уже на AI-проверке отвечает FORBIDDEN", async () => {
      const prisma = prismaDouble()
      prisma.articleTranslation.findUnique.mockResolvedValue(published())
      prisma.publishedArticleEdit.findUnique.mockResolvedValue(activeEdit({ status: "ai_check" }))

      const extensions = await extensionsOf(
        saveTranslationPublished(context(prisma), {
          id: "translation-1",
          baseRevisionId: "edit-revision-1",
          patch: { title: "Ещё правка" }
        })
      )

      expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "translation.save.published" })
    })

    it("черновик (не published) отвечает FORBIDDEN", async () => {
      const prisma = prismaDouble()

      const extensions = await extensionsOf(
        saveTranslationPublished(context(prisma), {
          id: "translation-1",
          baseRevisionId: "revision-9",
          patch: { title: "Ещё правка" }
        })
      )

      expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "translation.save.published" })
    })
  })

  describe("подача и отзыв копии", () => {
    it("без активной копии подача отвечает CONFLICT", async () => {
      const prisma = prismaDouble()
      prisma.articleTranslation.findUnique.mockResolvedValue(published())

      const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

      expect(extensions).toMatchObject({ code: "CONFLICT", entity: "publishedArticleEdit", actual: "none" })
    })

    it("критерий 2 (ветка AI): первая подача копии переводит её в ai_check и ставит задание", async () => {
      const prisma = prismaDouble()
      prisma.articleTranslation.findUnique.mockResolvedValue(published())
      prisma.publishedArticleEdit.findUnique.mockResolvedValue(activeEdit())
      prisma.articleRevision.findUnique.mockResolvedValue({
        id: "edit-revision-1",
        title: "Исправленный заголовок",
        dek: "Лид",
        excerpt: null,
        body: editRevisionBody
      })

      const result = await submitTranslation(context(prisma), "translation-1")

      // Публичная версия остаётся `published`: читатель видит прежний текст, пока копия на проверке.
      expect(result.status).toBe("published")
      expect(result.readOnlyReason).toBe("ai_check")
      expect(prisma.articleTranslation.updateMany).not.toHaveBeenCalled()
      expect(prisma.publishedArticleEdit.updateMany).toHaveBeenCalledWith({
        where: { id: "edit-1", status: "draft" },
        data: { status: "ai_check" }
      })
      expect(prisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kind: "ai.check", objectId: "translation-1" }) })
      )
    })

    it("критерий 2 (ветка AI): пишет событие #92 translation.edit.published с веткой ai", async () => {
      const prisma = prismaDouble()
      prisma.articleTranslation.findUnique.mockResolvedValue(published())
      prisma.publishedArticleEdit.findUnique.mockResolvedValue(activeEdit())
      prisma.articleRevision.findUnique.mockResolvedValue({
        id: "edit-revision-1",
        title: "Исправленный заголовок",
        dek: "Лид",
        excerpt: null,
        body: editRevisionBody
      })
      const log = vi.fn()
      const ctx = { ...context(prisma), logger: { log } } as never

      await submitTranslation(ctx, "translation-1")

      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "translation.edit.published",
          data: expect.objectContaining({ translationId: "translation-1", branch: "ai" })
        })
      )
    })

    it("критерий 2 (ручная ветка): после отказа AI повторная подача копии идёт в review без нового задания", async () => {
      const prisma = prismaDouble()
      prisma.articleTranslation.findUnique.mockResolvedValue(published())
      prisma.publishedArticleEdit.findUnique.mockResolvedValue(activeEdit({ status: "rework" }))
      prisma.articleRevision.findUnique.mockResolvedValue({
        id: "edit-revision-1",
        title: "Исправленный заголовок",
        dek: "Лид",
        excerpt: null,
        body: editRevisionBody
      })

      const result = await submitTranslation(context(prisma), "translation-1")

      expect(result.status).toBe("published")
      expect(result.readOnlyReason).toBe("in_review")
      expect(prisma.publishedArticleEdit.updateMany).toHaveBeenCalledWith({
        where: { id: "edit-1", status: "rework" },
        data: { status: "review" }
      })
      expect(prisma.job.create).not.toHaveBeenCalled()
    })

    it("критерий 3: вторая подача, пока первая копия уже review, отвечает CONFLICT", async () => {
      const prisma = prismaDouble()
      prisma.articleTranslation.findUnique.mockResolvedValue(published())
      prisma.publishedArticleEdit.findUnique.mockResolvedValue(activeEdit({ status: "review" }))

      const extensions = await extensionsOf(submitTranslation(context(prisma), "translation-1"))

      expect(extensions).toMatchObject({ code: "CONFLICT", entity: "publishedArticleEdit", actual: "review" })
      expect(prisma.job.create).not.toHaveBeenCalled()
    })

    it("отзыв копии с проверки возвращает её в draft, публичная строка не меняется", async () => {
      const prisma = prismaDouble()
      prisma.articleTranslation.findUnique.mockResolvedValue(published())
      prisma.publishedArticleEdit.findUnique.mockResolvedValue(activeEdit({ status: "ai_check" }))

      const result = await withdrawTranslation(context(prisma), "translation-1")

      expect(result.status).toBe("published")
      expect(prisma.articleTranslation.updateMany).not.toHaveBeenCalled()
      expect(prisma.publishedArticleEdit.updateMany).toHaveBeenCalledWith({
        where: { articleId: "article-1", translationId: "translation-1", status: { in: ["ai_check", "review"] } },
        data: { status: "draft" }
      })
    })
  })

  describe("редактор показывает копию поверх публичного снимка", () => {
    it("с активной копией readOnlyReason и содержимое берутся от копии", async () => {
      const prisma = prismaDouble()
      prisma.articleTranslation.findUnique.mockResolvedValue(
        published({ publishedEdit: activeEdit({ status: "ai_check" }) })
      )

      const result = await getEditorTranslation(context(prisma), "translation-1")

      expect(result.readOnlyReason).toBe("ai_check")
      expect(result.status).toBe("published")
      expect(result.title).toBe("Исправленный заголовок")
      expect(result.currentRevisionId).toBe("edit-revision-1")
    })

    it("без активной копии версия остаётся обычным read-only published", async () => {
      const prisma = prismaDouble()
      prisma.articleTranslation.findUnique.mockResolvedValue(published())

      const result = await getEditorTranslation(context(prisma), "translation-1")

      expect(result.readOnlyReason).toBe("published")
      expect(result.title).toBe("Заголовок")
      expect(result.currentRevisionId).toBe("revision-9")
    })

    it("копия другой языковой версии не влияет на эту версию", async () => {
      const prisma = prismaDouble()
      prisma.articleTranslation.findUnique.mockResolvedValue(
        published({ publishedEdit: activeEdit({ translationId: "translation-en-1", status: "ai_check" }) })
      )

      const result = await getEditorTranslation(context(prisma), "translation-1")

      expect(result.readOnlyReason).toBe("published")
      expect(result.title).toBe("Заголовок")
    })
  })
})
