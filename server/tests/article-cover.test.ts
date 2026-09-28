import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import articleResolver from "../src/graphql/article/resolver"
import { articleCoverView, setArticleCover } from "../src/article/cover"

// T-066: обложка материала (`docs/spec/85-media-and-binary/article-covers.md`, журнал §29.1).
// Критерий 1 — подача без обложки отвечает `VALIDATION_ERROR`.

const MEDIA_BASE = "https://media.example/altera"
/** Ключ варианта содержит UUID записи: раскладка хранилища проверяется при сборке адреса. */
const ASSET_KEY_ID = "0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a7b"

const author = {
  id: "author-1",
  role: "author",
  archivedAt: null,
  planTier: "standard",
  planUntil: new Date("2099-01-01T00:00:00.000Z"),
  locale: "ru"
}

/** Готовая запись обложки с собранным кадром карточки. */
const readyAsset = (overrides: Record<string, unknown> = {}) => ({
  id: "cover-1",
  ownerId: "author-1",
  processingStatus: "ready",
  deletedAt: null,
  alt: "Вид на залив",
  focalX: 0.5,
  focalY: 0.5,
  variants: {
    version: 1,
    placeholder: "data:image/webp;base64,AA==",
    thumbnailWidth: 480,
    focal: { x: 0.5, y: 0.5 },
    items: [
      {
        format: "webp",
        width: 960,
        height: 640,
        key: "2026/09/0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a7b/w960.webp",
        byteSize: 10
      },
      {
        format: "webp",
        width: 960,
        height: 480,
        key: "2026/09/0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a7b/lede-w960.webp",
        byteSize: 10,
        crop: "lede"
      }
    ]
  },
  ...overrides
})

const draft = (overrides: Record<string, unknown> = {}) => ({
  id: "article-1",
  authorId: "author-1",
  isEditorial: false,
  status: "draft",
  publishedAt: null,
  sectionId: "section-1",
  section: { id: "section-1", slug: "culture", status: "active" },
  coverAssetId: null,
  tags: [],
  ...overrides
})

const context = (prisma: unknown, currentUser: object = author, media: object = {}) =>
  ({
    prisma,
    currentUser,
    requestId: "request-1",
    logger: { log: vi.fn() },
    cache: { delByTags: vi.fn() },
    media: {
      mediaBaseUrl: MEDIA_BASE,
      setCoverFocal: vi.fn().mockResolvedValue(readyAsset()),
      ...media
    }
  }) as never

describe("T-066 подача без обложки", () => {
  it("критерий 1: подача черновика без обложки — VALIDATION_ERROR", async () => {
    const update = vi.fn()
    const prisma = {
      article: { findUnique: vi.fn().mockResolvedValue(draft()), update },
      mediaAsset: { findUnique: vi.fn() }
    }

    await expect(
      articleResolver.Mutation.requestReview(null, { id: "article-1" }, context(prisma))
    ).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "VALIDATION_ERROR", field: "cover", rule: "required" }
    })
    expect(update).not.toHaveBeenCalled()
  })

  it("обложка, чья обработка не закончена, подачу не открывает", async () => {
    const update = vi.fn()
    const prisma = {
      article: { findUnique: vi.fn().mockResolvedValue(draft({ coverAssetId: "cover-1" })), update },
      mediaAsset: { findUnique: vi.fn().mockResolvedValue(readyAsset({ processingStatus: "processing" })) }
    }

    await expect(
      articleResolver.Mutation.requestReview(null, { id: "article-1" }, context(prisma))
    ).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "VALIDATION_ERROR", field: "cover", rule: "processing" }
    })
    expect(update).not.toHaveBeenCalled()
  })

  it("обложка без кадров карточки к публикации не готова", async () => {
    const withoutCrops = readyAsset({
      variants: {
        version: 1,
        placeholder: null,
        thumbnailWidth: 480,
        focal: null,
        items: [
          {
            format: "webp",
            width: 960,
            height: 640,
            key: "2026/09/0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a7b/w960.webp",
            byteSize: 10
          }
        ]
      }
    })
    const prisma = {
      article: { findUnique: vi.fn().mockResolvedValue(draft({ coverAssetId: "cover-1" })), update: vi.fn() },
      mediaAsset: { findUnique: vi.fn().mockResolvedValue(withoutCrops) }
    }

    await expect(
      articleResolver.Mutation.requestReview(null, { id: "article-1" }, context(prisma))
    ).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "VALIDATION_ERROR", field: "cover", rule: "processing" }
    })
  })

  it("удалённая запись обложкой не считается", async () => {
    const prisma = {
      article: { findUnique: vi.fn().mockResolvedValue(draft({ coverAssetId: "cover-1" })), update: vi.fn() },
      mediaAsset: { findUnique: vi.fn().mockResolvedValue(readyAsset({ deletedAt: new Date() })) }
    }

    await expect(
      articleResolver.Mutation.requestReview(null, { id: "article-1" }, context(prisma))
    ).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "VALIDATION_ERROR", field: "cover", rule: "required" }
    })
  })

  it("с готовой обложкой подача проходит", async () => {
    const update = vi.fn().mockResolvedValue({ id: "article-1", status: "review" })
    const prisma = {
      article: { findUnique: vi.fn().mockResolvedValue(draft({ coverAssetId: "cover-1" })), update },
      mediaAsset: { findUnique: vi.fn().mockResolvedValue(readyAsset()) }
    }

    await articleResolver.Mutation.requestReview(null, { id: "article-1" }, context(prisma))

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "review" } }))
  })
})

describe("T-066 выбор обложки", () => {
  it("ставит обложку материалу и кадрирует её по фокусу до ответа", async () => {
    const update = vi.fn().mockResolvedValue({})
    const setCoverFocal = vi.fn().mockResolvedValue(readyAsset())
    const prisma = {
      article: { findUnique: vi.fn().mockResolvedValue(draft()), update },
      mediaAsset: { findUnique: vi.fn().mockResolvedValue(readyAsset()) }
    }

    const view = await setArticleCover(context(prisma, author, { setCoverFocal }), {
      articleId: "article-1",
      assetId: "cover-1",
      focal: { x: 0.25, y: 0.75 }
    })

    expect(setCoverFocal).toHaveBeenCalledWith({ assetId: "cover-1", focal: { x: 0.25, y: 0.75 } })
    expect(update).toHaveBeenCalledWith({ where: { id: "article-1" }, data: { coverAssetId: "cover-1" } })
    expect(view).toMatchObject({ assetId: "cover-1", alt: "Вид на залив" })
    expect(view!.url).toBe(`${MEDIA_BASE}/2026/09/${ASSET_KEY_ID}/w960.webp`)
    expect(view!.variants.items.some((item) => item.crop === "lede")).toBe(true)
  })

  it("обложка одна на материал: связь лежит на статье, а не на языковой версии", async () => {
    // ADR-0002 — общие метаданные пары версий: `setArticleCover` принимает `articleId`,
    // и обеим версиям достаётся одна и та же запись медиа.
    const update = vi.fn().mockResolvedValue({})
    const prisma = {
      article: { findUnique: vi.fn().mockResolvedValue(draft()), update },
      mediaAsset: { findUnique: vi.fn().mockResolvedValue(readyAsset()) }
    }

    await setArticleCover(context(prisma, author), { articleId: "article-1", assetId: "cover-1" })

    expect(update).toHaveBeenCalledWith({ where: { id: "article-1" }, data: { coverAssetId: "cover-1" } })
  })

  it("без фокуса кадрирование идёт по центру изображения", async () => {
    const setCoverFocal = vi.fn().mockResolvedValue(readyAsset())
    const prisma = {
      article: { findUnique: vi.fn().mockResolvedValue(draft()), update: vi.fn().mockResolvedValue({}) },
      mediaAsset: { findUnique: vi.fn().mockResolvedValue(readyAsset()) }
    }

    await setArticleCover(context(prisma, author, { setCoverFocal }), { articleId: "article-1", assetId: "cover-1" })

    expect(setCoverFocal).toHaveBeenCalledWith({ assetId: "cover-1", focal: { x: 0.5, y: 0.5 } })
  })

  it("фокус вне изображения — VALIDATION_ERROR", async () => {
    const prisma = {
      article: { findUnique: vi.fn().mockResolvedValue(draft()), update: vi.fn() },
      mediaAsset: { findUnique: vi.fn() }
    }

    await expect(
      setArticleCover(context(prisma, author), {
        articleId: "article-1",
        assetId: "cover-1",
        focal: { x: 1.5, y: 0.5 }
      })
    ).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "VALIDATION_ERROR", field: "focal", rule: "range" }
    })
  })

  it("`assetId: null` снимает обложку", async () => {
    const update = vi.fn().mockResolvedValue({})
    const prisma = {
      article: { findUnique: vi.fn().mockResolvedValue(draft({ coverAssetId: "cover-1" })), update },
      mediaAsset: { findUnique: vi.fn() }
    }

    await expect(
      setArticleCover(context(prisma, author), { articleId: "article-1", assetId: null })
    ).resolves.toBeNull()
    expect(update).toHaveBeenCalledWith({ where: { id: "article-1" }, data: { coverAssetId: null } })
  })

  it("опубликованный материал обложку так не меняет — CONFLICT", async () => {
    // Правка опубликованной идёт в копии через AI-проверку (журнал §41, T-122); противоречие
    // `article-covers.md` п. 5 с матрицей #19 вынесено из этой задачи (Q-12).
    const prisma = {
      article: { findUnique: vi.fn().mockResolvedValue(draft({ status: "published" })), update: vi.fn() },
      mediaAsset: { findUnique: vi.fn() }
    }

    await expect(
      setArticleCover(context(prisma, author), { articleId: "article-1", assetId: "cover-1" })
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "CONFLICT" } })
  })

  it("чужой материал автору закрыт", async () => {
    const prisma = {
      article: { findUnique: vi.fn().mockResolvedValue(draft({ authorId: "author-2" })), update: vi.fn() },
      mediaAsset: { findUnique: vi.fn() }
    }

    await expect(
      setArticleCover(context(prisma, author), { articleId: "article-1", assetId: "cover-1" })
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "FORBIDDEN" } })
  })

  it("чужой медиафайл обложкой не ставится", async () => {
    const prisma = {
      article: { findUnique: vi.fn().mockResolvedValue(draft()), update: vi.fn() },
      mediaAsset: { findUnique: vi.fn().mockResolvedValue(readyAsset({ ownerId: "author-2" })) }
    }

    await expect(
      setArticleCover(context(prisma, author), { articleId: "article-1", assetId: "cover-1" })
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "FORBIDDEN" } })
  })

  it("незаконченная запись обложкой не ставится", async () => {
    const prisma = {
      article: { findUnique: vi.fn().mockResolvedValue(draft()), update: vi.fn() },
      mediaAsset: { findUnique: vi.fn().mockResolvedValue(readyAsset({ processingStatus: "queued" })) }
    }

    await expect(
      setArticleCover(context(prisma, author), { articleId: "article-1", assetId: "cover-1" })
    ).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "VALIDATION_ERROR", field: "cover", rule: "processing" }
    })
  })
})

describe("T-066 чтение обложки", () => {
  it("материал без обложки отдаёт `null`", async () => {
    const prisma = { mediaAsset: { findUnique: vi.fn() } }

    await expect(articleCoverView(context(prisma), null)).resolves.toBeNull()
    expect(prisma.mediaAsset.findUnique).not.toHaveBeenCalled()
  })

  it("адрес варианта собирается из ключа при чтении", async () => {
    const prisma = { mediaAsset: { findUnique: vi.fn().mockResolvedValue(readyAsset()) } }

    const view = await articleCoverView(context(prisma), "cover-1")

    expect(view!.url).toBe(`${MEDIA_BASE}/2026/09/${ASSET_KEY_ID}/w960.webp`)
    expect(view!.focal).toEqual({ x: 0.5, y: 0.5 })
  })
})
