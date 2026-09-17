import { describe, expect, it, vi } from "vitest"
import articleResolver from "../src/graphql/article/resolver"
import {
  getPublicArticleVisibility,
  publicArticleInclude,
  publicArticleWhere,
  publicationDatesForStatus
} from "../src/visibility/article"

const requestContext = {
  currentUser: null,
  requestId: "req-article-visibility",
  logger: { log: vi.fn() },
  piiHasher: { email: vi.fn(), ip: vi.fn() }
}

function createCache() {
  return {
    mode: "noop" as const,
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    delByTags: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  }
}

function article(status: "draft" | "archived") {
  return {
    id: `article-${status}`,
    title: `Article ${status}`,
    slug: status,
    dek: null,
    body: "Body",
    excerpt: null,
    featuredImage: null,
    status,
    publishedAt: status === "archived" ? new Date("2026-09-01T00:00:00.000Z") : null,
    firstPublishedAt: status === "archived" ? new Date("2026-09-01T00:00:00.000Z") : null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    authorId: "author-1",
    sectionId: null,
    formatId: null,
    coverAssetId: null,
    sourceLocale: "ru",
    isEditorial: false,
    archivedAt: status === "archived" ? new Date("2026-09-10T00:00:00.000Z") : null,
    archivedByActorId: null,
    archivedByRole: null,
    archiveReason: null,
    author: { id: "author-1", name: "Author", handle: "author" },
    section: null,
    tags: []
  }
}

describe("public article visibility", () => {
  it("adds the published constraint to every public article query", () => {
    expect(publicArticleWhere({ authorId: "author-1" })).toEqual({
      authorId: "author-1",
      status: "published"
    })
  })

  it.each([
    [{ status: "published", firstPublishedAt: new Date("2026-09-01T00:00:00.000Z") }, "visible"],
    [{ status: "draft", firstPublishedAt: null }, "not_found"],
    [{ status: "review", firstPublishedAt: null }, "not_found"],
    [{ status: "archived", firstPublishedAt: null }, "not_found"],
    [{ status: "archived", firstPublishedAt: new Date("2026-09-01T00:00:00.000Z") }, "archived"],
    [{ status: "rework", firstPublishedAt: new Date("2026-09-01T00:00:00.000Z") }, "archived"]
  ] as const)("classifies %s as %s", (record, expected) => {
    expect(getPublicArticleVisibility(record)).toBe(expected)
  })

  it("sets the immutable first publication date only on the first publication", () => {
    const now = new Date("2026-09-17T12:00:00.000Z")

    expect(publicationDatesForStatus("published", null, null, now)).toEqual({
      publishedAt: now,
      firstPublishedAt: now
    })
    expect(publicationDatesForStatus("published", null, new Date("2026-09-01T00:00:00.000Z"), now)).toEqual({
      publishedAt: now,
      firstPublishedAt: new Date("2026-09-01T00:00:00.000Z")
    })
  })

  it("projects only public author fields before an article enters the public cache", () => {
    expect(publicArticleInclude.author).toEqual({
      select: {
        id: true,
        name: true,
        bio: true,
        photoUrl: true,
        handle: true,
        socialLinks: true,
        createdAt: true,
        updatedAt: true
      }
    })
    expect(publicArticleInclude.author.select).not.toHaveProperty("email")
    expect(publicArticleInclude.author.select).not.toHaveProperty("role")
    expect(publicArticleInclude.author.select).not.toHaveProperty("planTier")
  })

  it("returns only safe metadata for a previously published gone article", async () => {
    const goneArticle = { ...article("archived"), section: { slug: "articles", name: "Articles" } }
    const findUnique = vi.fn().mockResolvedValue(goneArticle)

    await expect(
      articleResolver.Query.gone({}, { locale: "ru", sectionSlug: "articles", slug: "archived" }, {
        ...requestContext,
        cache: createCache(),
        prisma: { article: { findUnique } }
      } as never)
    ).resolves.toEqual({
      title: goneArticle.title,
      firstPublishedAt: goneArticle.firstPublishedAt,
      unpublishedAt: goneArticle.archivedAt,
      author: goneArticle.author,
      section: goneArticle.section
    })

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ body: true })
      })
    )
  })

  it("does not return a draft to a guest and reports NOT_FOUND", async () => {
    const cache = createCache()
    const findUnique = vi.fn().mockResolvedValue(article("draft"))

    await expect(
      articleResolver.Query.article({}, { slug: "draft" }, {
        ...requestContext,
        cache,
        prisma: { article: { findUnique } }
      } as never)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND", entity: "article" } })

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ include: publicArticleInclude }))
    expect(cache.set).not.toHaveBeenCalled()
  })

  it("reports ARCHIVED for a previously published archived article", async () => {
    const cache = createCache()
    const findUnique = vi.fn().mockResolvedValue(article("archived"))

    await expect(
      articleResolver.Query.article({}, { slug: "archived" }, {
        ...requestContext,
        cache,
        prisma: { article: { findUnique } }
      } as never)
    ).rejects.toMatchObject({ extensions: { code: "ARCHIVED", entity: "article" } })

    expect(cache.set).not.toHaveBeenCalled()
  })
})
