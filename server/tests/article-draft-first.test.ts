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

const context = (prisma: unknown) =>
  ({
    prisma,
    currentUser: activeAuthor,
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
