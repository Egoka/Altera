import { describe, expect, it, vi } from "vitest"
import articleResolver from "../src/graphql/article/resolver"
import { getPublicArticleVisibility, publicArticleWhere } from "../src/visibility/article"

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
    [{ status: "archived", firstPublishedAt: new Date("2026-09-01T00:00:00.000Z") }, "archived"],
    [{ status: "rework", firstPublishedAt: new Date("2026-09-01T00:00:00.000Z") }, "archived"]
  ] as const)("classifies %s as %s", (record, expected) => {
    expect(getPublicArticleVisibility(record)).toBe(expected)
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
