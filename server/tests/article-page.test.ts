import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import articleResolver from "../src/graphql/article/resolver"

const BODY_IMAGE_ID = "22222222-2222-4222-8222-222222222222"
const COVER_IMAGE_ID = "44444444-4444-4444-8444-444444444444"

const body = {
  type: "doc",
  attrs: { schemaVersion: 1 },
  content: [
    {
      type: "paragraph",
      attrs: { id: "11111111-1111-4111-8111-111111111111" },
      content: [{ type: "text", text: "Первый абзац материала." }]
    },
    {
      type: "figure",
      attrs: { id: "33333333-3333-4333-8333-333333333333", assetId: BODY_IMAGE_ID, size: "wide" }
    }
  ]
}

function translation(overrides: Record<string, unknown> = {}) {
  return {
    id: "translation-ru",
    locale: "ru",
    slug: "material",
    title: "Материал",
    dek: "Короткий лид",
    excerpt: "Описание",
    featuredImage: null,
    body,
    status: "published",
    rejected: false,
    publishedAt: new Date("2026-09-20T10:00:00.000Z"),
    reeditUntil: null,
    createdAt: new Date("2026-09-19T10:00:00.000Z"),
    updatedAt: new Date("2026-09-20T11:00:00.000Z"),
    article: {
      id: "article-1",
      status: "published",
      sourceLocale: "ru",
      authorId: "author-1",
      isEditorial: false,
      coverAssetId: COVER_IMAGE_ID,
      firstPublishedAt: new Date("2026-09-20T10:00:00.000Z"),
      author: {
        id: "author-1",
        name: "Автор",
        bio: "О себе",
        photoUrl: null,
        handle: "author",
        socialLinks: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z")
      },
      section: { id: "section-1", slug: "culture", name: "Культура", nameEn: "Culture" },
      format: { id: "format-1", slug: "essay", name: "Эссе", nameEn: "Essay" },
      tags: [{ id: "tag-1", slug: "art", name: "Искусство", nameEn: "Art" }],
      translations: [
        {
          id: "translation-ru",
          locale: "ru",
          slug: "material",
          status: "published",
          rejected: false
        },
        {
          id: "translation-en",
          locale: "en",
          slug: "material-en",
          status: "published",
          rejected: false
        }
      ]
    },
    ...overrides
  }
}

function context(
  options: {
    row?: ReturnType<typeof translation> | null
    user?: { id: string; role: string } | null
    sessionId?: string | null
  } = {}
) {
  const findUnique = vi.fn().mockResolvedValue(options.row === undefined ? translation() : options.row)
  const findMany = vi.fn().mockResolvedValue([
    {
      id: BODY_IMAGE_ID,
      processingStatus: "ready",
      mimeType: "image/webp",
      byteSize: 321,
      width: 1200,
      height: 800,
      alt: "Человек рассматривает картину",
      caption: "В музее",
      attribution: "Фото: Автор",
      license: "own",
      licenseNote: null,
      variants: {
        version: 1,
        placeholder: null,
        thumbnailWidth: 480,
        focal: null,
        items: [
          {
            format: "webp",
            width: 480,
            height: 320,
            byteSize: 123,
            key: `2026/09/${BODY_IMAGE_ID}/w480.webp`
          }
        ]
      },
      createdAt: new Date("2026-09-19T10:00:00.000Z")
    }
  ])
  const findMediaAsset = vi.fn().mockResolvedValue({
    id: COVER_IMAGE_ID,
    processingStatus: "ready",
    mimeType: "image/webp",
    byteSize: 654,
    width: 1600,
    height: 900,
    alt: "Пустой зал музея",
    caption: null,
    attribution: null,
    license: "own",
    licenseNote: null,
    variants: {
      version: 1,
      placeholder: null,
      thumbnailWidth: 480,
      focal: null,
      items: [
        {
          format: "webp",
          width: 960,
          height: 540,
          byteSize: 456,
          key: `2026/09/${COVER_IMAGE_ID}/w960.webp`
        }
      ]
    },
    createdAt: new Date("2026-09-19T10:00:00.000Z")
  })

  return {
    currentUser: options.user ?? null,
    sessionId: options.sessionId ?? null,
    requestId: "req-article-page",
    media: { mediaBaseUrl: "https://media.example.test" },
    prisma: {
      articleTranslation: { findUnique },
      mediaAsset: { findMany, findUnique: findMediaAsset }
    },
    cache: {
      mode: "noop" as const,
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
      delByTags: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    },
    logger: { log: vi.fn() },
    piiHasher: { email: vi.fn(), ip: vi.fn() }
  }
}

describe("article page resolver", () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = "test-access-secret-with-enough-entropy"
  })

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET
  })

  it("returns the published localized document with media alt and only a published sibling", async () => {
    const ctx = context()

    const result = await articleResolver.Query.article(
      {},
      { locale: "ru", sectionSlug: "culture", slug: "material" },
      ctx as never
    )

    expect(result).toMatchObject({
      id: "article-1",
      translationId: "translation-ru",
      locale: "ru",
      title: "Материал",
      body,
      status: null,
      preview: false,
      readingTime: 1,
      sibling: { locale: "en", path: "/en/culture/material-en" },
      bodyAssets: [
        {
          id: BODY_IMAGE_ID,
          alt: "Человек рассматривает картину",
          variants: {
            items: [
              {
                format: "webp",
                width: 480,
                height: 320,
                url: `https://media.example.test/2026/09/${BODY_IMAGE_ID}/w480.webp`
              }
            ]
          }
        }
      ]
    })
  })

  it("resolves the page cover through the public media view", async () => {
    const ctx = context()

    const cover = await articleResolver.ArticlePage.cover({ coverAssetId: COVER_IMAGE_ID }, {}, ctx as never)

    expect(cover).toMatchObject({
      assetId: COVER_IMAGE_ID,
      alt: "Пустой зал музея",
      variants: {
        items: [{ url: `https://media.example.test/2026/09/${COVER_IMAGE_ID}/w960.webp` }]
      }
    })
  })

  it("reports ARCHIVED for a formerly published localized version", async () => {
    const ctx = context({ row: translation({ status: "archived" }) })

    await expect(
      articleResolver.Query.article({}, { locale: "ru", sectionSlug: "culture", slug: "material" }, ctx as never)
    ).rejects.toMatchObject({ extensions: { code: "ARCHIVED", entity: "article" } })
  })

  it("keeps an unpublished sibling at 404 even when the other locale was already published", async () => {
    const ctx = context({ row: translation({ status: "draft", publishedAt: null }) })

    await expect(
      articleResolver.Query.article({}, { locale: "ru", sectionSlug: "culture", slug: "material" }, ctx as never)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND", entity: "article" } })
  })

  it("hides a preview from a guest even when a token-shaped value is supplied", async () => {
    const ctx = context({ row: translation({ status: "draft", publishedAt: null }) })

    await expect(
      articleResolver.Query.article(
        {},
        { locale: "ru", sectionSlug: "culture", slug: "material", preview: "not-a-token" },
        ctx as never
      )
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND", entity: "article" } })
  })

  it("issues a session-bound token and uses it for the author's draft preview", async () => {
    const row = translation({
      status: "draft",
      publishedAt: null,
      reeditUntil: new Date("2026-09-28T20:00:00.000Z")
    })
    const ctx = context({ row, user: { id: "author-1", role: "author" }, sessionId: "session-1" })

    const token = await articleResolver.Query.articlePreviewToken({}, { translationId: "translation-ru" }, ctx as never)
    const result = await articleResolver.Query.article(
      {},
      { locale: "ru", sectionSlug: "culture", slug: "material", preview: token },
      ctx as never
    )

    expect(result).toMatchObject({
      translationId: "translation-ru",
      status: "draft",
      preview: true,
      reeditUntil: "2026-09-28T20:00:00.000Z"
    })
  })

  it("rejects a valid preview token when it is replayed in another session", async () => {
    const row = translation({ status: "draft", publishedAt: null })
    const issuingContext = context({ row, user: { id: "author-1", role: "author" }, sessionId: "session-1" })
    const token = await articleResolver.Query.articlePreviewToken(
      {},
      { translationId: "translation-ru" },
      issuingContext as never
    )
    const replayContext = context({ row, user: { id: "author-1", role: "author" }, sessionId: "session-2" })

    await expect(
      articleResolver.Query.article(
        {},
        { locale: "ru", sectionSlug: "culture", slug: "material", preview: token },
        replayContext as never
      )
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND", entity: "article" } })
  })

  it("does not expose the author's re-edit window in a staff preview", async () => {
    const row = translation({
      status: "review",
      publishedAt: null,
      reeditUntil: new Date("2026-09-28T20:00:00.000Z")
    })
    const ctx = context({ row, user: { id: "moderator-1", role: "moderator" }, sessionId: "session-1" })
    const token = await articleResolver.Query.articlePreviewToken({}, { translationId: "translation-ru" }, ctx as never)

    const result = await articleResolver.Query.article(
      {},
      { locale: "ru", sectionSlug: "culture", slug: "material", preview: token },
      ctx as never
    )

    expect(result.reeditUntil).toBeNull()
  })

  it("does not issue preview tokens to a role outside the visibility matrix", async () => {
    const ctx = context({ user: { id: "analyst-1", role: "analyst" }, sessionId: "session-1" })

    await expect(
      articleResolver.Query.articlePreviewToken({}, { translationId: "translation-ru" }, ctx as never)
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } })
  })

  it("does not treat a reader as an author only because an old article still belongs to them", async () => {
    const ctx = context({ user: { id: "author-1", role: "reader" }, sessionId: "session-1" })

    await expect(
      articleResolver.Query.articlePreviewToken({}, { translationId: "translation-ru" }, ctx as never)
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } })
  })
})
