import { beforeEach, describe, expect, it, vi } from "vitest"
import { getAdminArticle, getAdminArticleFilterOptions, listAdminArticles } from "../src/admin/articles"
import resolver from "../src/graphql/admin-articles/resolver"

vi.mock("../src/admin/articles", () => ({
  getAdminArticle: vi.fn(),
  getAdminArticleFilterOptions: vi.fn(),
  listAdminArticles: vi.fn()
}))

const date = new Date("2026-09-29T12:00:00.000Z")
const row = {
  id: "translation-1",
  articleId: "article-1",
  title: "Материал",
  slug: "material",
  locale: "ru",
  status: "published",
  rejected: false,
  readCount: 12,
  publishedAt: date,
  updatedAt: date,
  editorial: false,
  author: { id: "author-1", name: "Автор", handle: "author" },
  section: null,
  format: null,
  tags: [],
  archive: null
}

describe("admin articles GraphQL resolver", () => {
  beforeEach(() => vi.clearAllMocks())

  it("forwards list input and serializes dates", async () => {
    vi.mocked(listAdminArticles).mockResolvedValue({
      items: [row],
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalItems: 1,
        itemsPerPage: 20,
        hasNextPage: false,
        hasPreviousPage: false
      }
    } as never)
    const input = { filters: { status: "published" as const }, pagination: { page: 1, limit: 20 } }

    const result = await resolver.Query.adminArticles(null, input, { requestId: "req-1" } as never)

    expect(listAdminArticles).toHaveBeenCalledWith(expect.anything(), input)
    expect(result.items[0]).toMatchObject({ publishedAt: date.toISOString(), updatedAt: date.toISOString() })
  })

  it("serializes archive, revision and decision dates in the card", async () => {
    vi.mocked(getAdminArticle).mockResolvedValue({
      ...row,
      archive: { at: date, actorId: "admin-1", role: "admin", reason: "Причина" },
      dek: null,
      excerpt: null,
      body: { type: "doc" },
      cover: null,
      siblings: [],
      revisions: [
        {
          id: "revision-1",
          title: "Материал",
          body: { type: "doc" },
          kind: "manual",
          note: null,
          size: 14,
          createdAt: date,
          author: { id: "author-1", name: "Автор", handle: "author", role: "author" }
        }
      ],
      decisions: [
        {
          id: "decision-1",
          kind: "manual_publish",
          text: null,
          recommendations: null,
          byRole: "moderator",
          createdAt: date,
          replies: [{ id: "reply-1", text: "Ответ", byRole: "author", createdAt: date }]
        }
      ]
    } as never)

    const result = await resolver.Query.adminArticle(null, { id: "translation-1" }, { requestId: "req-1" } as never)

    expect(getAdminArticle).toHaveBeenCalledWith(expect.anything(), "translation-1")
    expect(result.archive?.at).toBe(date.toISOString())
    expect(result.revisions[0]?.createdAt).toBe(date.toISOString())
    expect(result.decisions[0]?.replies[0]?.createdAt).toBe(date.toISOString())
  })

  it("forwards filter option reads", async () => {
    vi.mocked(getAdminArticleFilterOptions).mockResolvedValue({ sections: [], formats: [], tags: [] })

    const result = await resolver.Query.adminArticleFilterOptions(null, {}, { requestId: "req-1" } as never)

    expect(getAdminArticleFilterOptions).toHaveBeenCalledWith(expect.anything())
    expect(result).toEqual({ sections: [], formats: [], tags: [] })
  })
})
