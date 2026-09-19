import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import articleResolver from "../src/graphql/article/resolver"

const activeAuthor = {
  id: "author-1",
  role: "author",
  archivedAt: null,
  planTier: "standard",
  planUntil: new Date("2099-01-01T00:00:00.000Z"),
  locale: "ru"
}

const context = (prisma: unknown, currentUser: object = activeAuthor) =>
  ({
    prisma,
    currentUser,
    requestId: "request-1",
    logger: { log: vi.fn() },
    cache: { delByTags: vi.fn() }
  }) as never

describe("article draft-first flow", () => {
  it("creates an empty draft without a section and its initial revision", async () => {
    const created = { id: "article-1", status: "draft", section: null, translations: [{ id: "translation-1" }] }
    const create = vi.fn().mockResolvedValue(created)
    const transaction = vi.fn(async (operation: (client: unknown) => Promise<unknown>) =>
      operation({ article: { create } })
    )

    await expect(
      articleResolver.Mutation.createArticle(
        null,
        { input: {} },
        context({ article: { create }, $transaction: transaction })
      )
    ).resolves.toEqual(created)

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authorId: "author-1",
        body: "",
        isEditorial: false,
        sectionId: null,
        sourceLocale: "ru",
        status: "draft",
        title: "",
        translations: {
          create: expect.objectContaining({
            body: [],
            locale: "ru",
            revisions: {
              create: expect.objectContaining({ body: [], createdById: "author-1", kind: "manual", title: "" })
            },
            status: "draft",
            title: ""
          })
        }
      }),
      include: { author: true, section: true, tags: true, translations: true }
    })
  })

  it("rejects review submission when the draft has no section", async () => {
    const update = vi.fn()
    const prisma = {
      article: {
        findUnique: vi.fn().mockResolvedValue({
          id: "article-1",
          authorId: "author-1",
          sectionId: null,
          status: "draft",
          tags: []
        }),
        update
      }
    }

    await expect(
      articleResolver.Mutation.requestReview(null, { id: "article-1" }, context(prisma))
    ).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "VALIDATION_ERROR", field: "sectionId", rule: "required" }
    })
    expect(update).not.toHaveBeenCalled()
  })

  it("ignores an unavailable preselected section and still creates the draft", async () => {
    const create = vi.fn().mockResolvedValue({ id: "article-1", status: "draft", section: null })
    const findFirst = vi.fn().mockResolvedValue(null)
    const transaction = vi.fn(async (operation: (client: unknown) => Promise<unknown>) =>
      operation({ article: { create }, section: { findFirst } })
    )

    await articleResolver.Mutation.createArticle(
      null,
      { input: { sectionId: "archived-section" } },
      context({ $transaction: transaction })
    )

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "archived-section", status: "active" },
      select: { id: true }
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sectionId: null }) }))
  })
})

const serviceUser = (role: string) => ({ ...activeAuthor, id: `${role}-1`, role, planTier: null, planUntil: null })

const draftTransaction = () => {
  const create = vi.fn().mockResolvedValue({ id: "article-1", status: "draft" })
  const $transaction = vi.fn(async (operation: (client: unknown) => Promise<unknown>) =>
    operation({ article: { create }, section: { findFirst: vi.fn() } })
  )
  return { create, $transaction }
}

describe("article draft-first roles", () => {
  it("marks an editor's draft as editorial so it appears in the editor's materials", async () => {
    const { create, $transaction } = draftTransaction()

    await articleResolver.Mutation.createArticle(null, { input: {} }, context({ $transaction }, serviceUser("editor")))

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ authorId: "editor-1", isEditorial: true }) })
    )
  })

  it.each(["owner", "admin", "moderator", "analyst"])(
    "forbids the %s service role from creating drafts",
    async (role) => {
      const { create, $transaction } = draftTransaction()

      await expect(
        articleResolver.Mutation.createArticle(null, { input: {} }, context({ $transaction }, serviceUser(role)))
      ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "FORBIDDEN" } })
      expect(create).not.toHaveBeenCalled()
    }
  )
})

describe("section required before review and publication", () => {
  const draft = (section: { status: string } | null) => ({
    id: "article-1",
    authorId: "author-1",
    status: "draft",
    publishedAt: null,
    sectionId: section ? "section-1" : null,
    section: section ? { id: "section-1", slug: "culture", ...section } : null,
    tags: []
  })

  it("rejects review submission when the draft section is archived", async () => {
    const update = vi.fn()
    const prisma = { article: { findUnique: vi.fn().mockResolvedValue(draft({ status: "archived" })), update } }

    await expect(
      articleResolver.Mutation.requestReview(null, { id: "article-1" }, context(prisma))
    ).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "VALIDATION_ERROR", field: "sectionId", rule: "active" }
    })
    expect(update).not.toHaveBeenCalled()
  })

  it("submits a draft with an active section", async () => {
    const update = vi.fn().mockResolvedValue({ id: "article-1", status: "review" })
    const prisma = { article: { findUnique: vi.fn().mockResolvedValue(draft({ status: "active" })), update } }

    await articleResolver.Mutation.requestReview(null, { id: "article-1" }, context(prisma))

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "review" } }))
  })

  it.each([
    ["published", null, "required"],
    ["published", { status: "archived" }, "active"],
    ["review", null, "required"]
  ])("does not let an admin set %s on a draft with section %j", async (status, section, rule) => {
    const update = vi.fn()
    const prisma = { article: { findUnique: vi.fn().mockResolvedValue(draft(section)), update } }

    await expect(
      articleResolver.Mutation.setArticleStatus(
        null,
        { id: "article-1", status },
        context(prisma, serviceUser("admin"))
      )
    ).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "VALIDATION_ERROR", field: "sectionId", rule }
    })
    expect(update).not.toHaveBeenCalled()
  })

  it("still lets an admin move a sectionless article to draft or archive", async () => {
    const update = vi.fn().mockResolvedValue({ id: "article-1", status: "archived" })
    const prisma = { article: { findUnique: vi.fn().mockResolvedValue(draft(null)), update } }

    await articleResolver.Mutation.setArticleStatus(
      null,
      { id: "article-1", status: "archived" },
      context(prisma, serviceUser("admin"))
    )

    expect(update).toHaveBeenCalled()
  })

  it("rejects a bulk publication that includes a sectionless article", async () => {
    const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]
    const updateMany = vi.fn()
    const prisma = {
      article: {
        findMany: vi.fn().mockResolvedValue([
          { ...draft({ status: "active" }), id: ids[0] },
          { ...draft(null), id: ids[1] }
        ]),
        updateMany
      }
    }

    await expect(
      articleResolver.Mutation.bulkUpdateArticleStatus(
        null,
        { ids, status: "published" },
        context(prisma, serviceUser("admin"))
      )
    ).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "VALIDATION_ERROR", field: "sectionId", rule: "required" }
    })
    expect(updateMany).not.toHaveBeenCalled()
  })
})
