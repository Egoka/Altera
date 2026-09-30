import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import { getAdminArticle, getAdminArticleFilterOptions, listAdminArticles } from "../src/admin/articles"

const now = new Date("2026-09-29T12:00:00.000Z")

const actor = (role: "editor" | "moderator" | "admin" | "owner") => ({
  id: `${role}-1`,
  role,
  archivedAt: null,
  isServiceAccount: true,
  planTier: "free",
  planUntil: null,
  permissionExceptions: []
})

const translation = (overrides: Record<string, unknown> = {}) => ({
  id: "translation-1",
  articleId: "article-1",
  locale: "ru",
  slug: "light",
  title: "Как устроен свет",
  dek: "Лид материала",
  excerpt: "Краткое описание",
  featuredImage: null,
  body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Свет" }] }] },
  status: "published",
  rejected: false,
  publishedAt: now,
  readCount: 137,
  createdAt: now,
  updatedAt: now,
  article: {
    id: "article-1",
    slug: "light",
    status: "published",
    sourceLocale: "ru",
    isEditorial: false,
    firstPublishedAt: now,
    archivedAt: null,
    archivedByActorId: null,
    archivedByRole: null,
    archiveReason: null,
    author: { id: "author-1", name: "Вера Орлова", handle: "vera" },
    section: { id: "section-1", name: "Наука", slug: "science" },
    format: { id: "format-1", name: "Статья", slug: "article" },
    tags: [{ id: "tag-1", name: "Физика", slug: "physics" }],
    coverAsset: { id: "cover-1", alt: "Луч света", variants: [{ width: 960, url: "/media/light.webp" }] },
    translations: [
      { id: "translation-1", locale: "ru", title: "Как устроен свет", slug: "light", status: "published" },
      { id: "translation-2", locale: "en", title: "How light works", slug: "light-en", status: "draft" }
    ]
  },
  revisions: [
    {
      id: "revision-1",
      title: "Как устроен свет",
      body: { type: "doc", content: [] },
      kind: "manual",
      note: null,
      createdAt: now,
      createdBy: { id: "author-1", name: "Вера Орлова", handle: "vera", role: "author" }
    }
  ],
  reviewMessages: [
    {
      id: "decision-1",
      kind: "manual_publish",
      text: "Проверено",
      recommendations: null,
      byRole: "moderator",
      createdAt: now,
      replies: []
    }
  ],
  ...overrides
})

const context = (role: "editor" | "moderator" | "admin" | "owner" = "admin", row = translation()) => {
  const prisma = {
    articleTranslation: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [structuredClone(row)]),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === row.id ? structuredClone(row) : null
      )
    },
    section: {
      findMany: vi.fn(async () => [{ id: "section-1", name: "Наука", slug: "science" }])
    },
    format: {
      findMany: vi.fn(async () => [{ id: "format-1", name: "Статья", slug: "article" }])
    },
    tag: {
      findMany: vi.fn(async () => [{ id: "tag-1", name: "Физика", slug: "physics" }])
    }
  }
  return {
    ctx: {
      currentUser: actor(role),
      requestId: "req-admin-articles",
      prisma,
      logger: { log: vi.fn() }
    },
    prisma
  }
}

const errorExtensions = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(GraphQLError)
    return (error as GraphQLError).extensions
  }
  throw new Error("Expected rejection")
}

describe("admin articles read model", () => {
  it("returns versions with exact stored reads and no author e-mail", async () => {
    const { ctx, prisma } = context()

    const page = await listAdminArticles(ctx as never, { pagination: { page: 1, limit: 20 } })

    expect(page.items[0]).toMatchObject({
      id: "translation-1",
      status: "published",
      readCount: 137,
      author: { id: "author-1", name: "Вера Орлова", handle: "vera" }
    })
    expect(page.items[0]?.author).not.toHaveProperty("email")
    expect(page.pagination).toMatchObject({ currentPage: 1, totalItems: 1, itemsPerPage: 20 })
    expect(prisma.articleTranslation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          rejected: false,
          article: expect.objectContaining({ status: { not: "archived" } })
        })
      })
    )
  })

  it("combines URL filters and sorts by exact read count", async () => {
    const { ctx, prisma } = context()

    await listAdminArticles(ctx as never, {
      filters: {
        status: "review",
        locale: "ru",
        sectionId: "section-1",
        formatId: "format-1",
        tagId: "tag-1",
        author: "vera",
        archiveRole: "admin",
        publishedFrom: "2026-09-01",
        publishedTo: "2026-09-30",
        search: "light"
      },
      pagination: { page: 2, limit: 20 },
      sort: "reads"
    })

    expect(prisma.articleTranslation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ readCount: "desc" }, { id: "asc" }],
        skip: 20,
        take: 20
      })
    )
  })

  it("returns active and archived taxonomy choices to every article reader role", async () => {
    const { ctx, prisma } = context("editor")

    const options = await getAdminArticleFilterOptions(ctx as never)

    expect(options).toEqual({
      sections: [{ id: "section-1", name: "Наука", slug: "science" }],
      formats: [{ id: "format-1", name: "Статья", slug: "article" }],
      tags: [{ id: "tag-1", name: "Физика", slug: "physics" }]
    })
    expect(prisma.section.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
    expect(prisma.format.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
    expect(prisma.tag.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
  })

  it("rejects searches shorter than three characters", async () => {
    const { ctx } = context()

    const extensions = await errorExtensions(listAdminArticles(ctx as never, { filters: { search: "ab" } }))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "filters.search", rule: "minLength:3" })
  })

  it("narrows the editor list to editorial articles", async () => {
    const { ctx, prisma } = context("editor")

    await listAdminArticles(ctx as never)

    expect(prisma.articleTranslation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ article: expect.objectContaining({ isEditorial: true }) })
      })
    )
  })

  it("returns 404 when editor opens a non-editorial version directly", async () => {
    const { ctx } = context("editor")

    const extensions = await errorExtensions(getAdminArticle(ctx as never, "translation-1"))

    expect(extensions).toMatchObject({ code: "NOT_FOUND", entity: "translation" })
  })

  it("returns a read-only card with revision history, decisions and sibling version", async () => {
    const archived = translation({
      article: {
        ...translation().article,
        status: "archived",
        archivedAt: now,
        archivedByActorId: "admin-1",
        archivedByRole: "admin",
        archiveReason: "Нарушение правил"
      }
    })
    const { ctx } = context("owner", archived)

    const card = await getAdminArticle(ctx as never, "translation-1")

    expect(card).toMatchObject({
      status: "archived",
      archive: { actorId: "admin-1", role: "admin", reason: "Нарушение правил" },
      revisions: [{ id: "revision-1", author: { handle: "vera" } }],
      decisions: [{ id: "decision-1", kind: "manual_publish" }],
      siblings: [{ id: "translation-2", locale: "en" }]
    })
    expect(card.revisions[0]?.size).toBe(JSON.stringify({ type: "doc", content: [] }).length)
  })
})
