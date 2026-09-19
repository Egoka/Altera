import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import articleResolver from "../src/graphql/article/resolver"

const ARTICLE_ID = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa"
const AUTHOR_ID = "author-1"

const activeAuthor = {
  id: AUTHOR_ID,
  role: "author",
  archivedAt: null,
  planTier: "standard",
  planUntil: new Date("2099-01-01T00:00:00.000Z")
}

const errorCode = async (run: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await run()
  } catch (error) {
    expect(error).toBeInstanceOf(GraphQLError)
    return (error as GraphQLError).extensions.code as string | undefined
  }
}

const context = (article: Record<string, unknown>, currentUser = activeAuthor) => {
  const update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...article, ...data }))
  const auditCreate = vi.fn().mockResolvedValue({ id: "audit-1" })
  const transaction = vi.fn().mockImplementation(async (run) =>
    run({
      article: {
        findUnique: vi.fn().mockResolvedValue(article),
        update
      },
      auditLog: { create: auditCreate }
    })
  )
  const delByTags = vi.fn().mockResolvedValue(undefined)

  return {
    ctx: {
      currentUser,
      requestId: "req-article-lifecycle",
      prisma: { $transaction: transaction },
      cache: { delByTags },
      logger: { log: vi.fn() }
    },
    update,
    auditCreate,
    delByTags
  }
}

describe("author article archive and restore", () => {
  it("архивирует собственную статью с актором и событием аудита", async () => {
    const article = {
      id: ARTICLE_ID,
      slug: "published-article",
      authorId: AUTHOR_ID,
      status: "published",
      firstPublishedAt: new Date("2026-09-01T00:00:00.000Z"),
      author: { handle: "author" },
      section: null,
      tags: []
    }
    const { ctx, update, auditCreate } = context(article)

    const result = await articleResolver.Mutation.archiveArticle({}, { id: ARTICLE_ID }, ctx as never)

    expect(result).toMatchObject({ status: "archived", archivedByActorId: AUTHOR_ID, archivedByRole: "author" })
    expect(update).toHaveBeenCalledWith({
      where: { id: ARTICLE_ID },
      data: {
        status: "archived",
        archivedAt: expect.any(Date),
        archivedByActorId: AUTHOR_ID,
        archivedByRole: "author",
        archiveReason: "author"
      },
      include: { author: true, section: true, tags: true }
    })
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        action: "article.archive",
        actorId: AUTHOR_ID,
        actorRole: "author",
        entityType: "article",
        entityId: ARTICLE_ID,
        diff: { status: { from: "published", to: "archived" } },
        requestId: "req-article-lifecycle"
      }
    })
  })

  it("запрещает автору восстановить статью после архива moderator", async () => {
    const article = {
      id: ARTICLE_ID,
      slug: "moderated-article",
      authorId: AUTHOR_ID,
      status: "archived",
      archivedByActorId: "moderator-1",
      archivedByRole: "moderator",
      firstPublishedAt: new Date("2026-09-01T00:00:00.000Z"),
      author: { handle: "author" },
      section: null,
      tags: []
    }
    const { ctx, update, auditCreate } = context(article)

    const code = await errorCode(() => articleResolver.Mutation.restoreArticle({}, { id: ARTICLE_ID }, ctx as never))

    expect(code).toBe("FORBIDDEN")
    expect(update).not.toHaveBeenCalled()
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it("возвращает самостоятельно архивированную бывшую публичную статью сразу в published", async () => {
    const article = {
      id: ARTICLE_ID,
      slug: "published-article",
      authorId: AUTHOR_ID,
      status: "archived",
      archivedAt: new Date("2026-09-17T00:00:00.000Z"),
      archivedByActorId: AUTHOR_ID,
      archivedByRole: "author",
      archiveReason: "author",
      firstPublishedAt: new Date("2026-09-01T00:00:00.000Z"),
      publishedAt: new Date("2026-09-01T00:00:00.000Z"),
      author: { handle: "author" },
      section: null,
      tags: []
    }
    const { ctx, update, auditCreate, delByTags } = context(article)

    const result = await articleResolver.Mutation.restoreArticle({}, { id: ARTICLE_ID }, ctx as never)

    expect(result).toMatchObject({ status: "published", archivedAt: null, archivedByActorId: null })
    expect(update).toHaveBeenCalledWith({
      where: { id: ARTICLE_ID },
      data: {
        status: "published",
        archivedAt: null,
        archivedByActorId: null,
        archivedByRole: null,
        archiveReason: null
      },
      include: { author: true, section: true, tags: true }
    })
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        action: "article.restore",
        actorId: AUTHOR_ID,
        actorRole: "author",
        entityType: "article",
        entityId: ARTICLE_ID,
        diff: { status: { from: "archived", to: "published" } },
        requestId: "req-article-lifecycle"
      }
    })
    expect(delByTags).toHaveBeenCalledOnce()
  })

  it("возвращает самостоятельно архивированную непубличную статью в draft", async () => {
    const article = {
      id: ARTICLE_ID,
      slug: "draft-article",
      authorId: AUTHOR_ID,
      status: "archived",
      archivedByActorId: AUTHOR_ID,
      archivedByRole: "author",
      firstPublishedAt: null,
      author: { handle: "author" },
      section: null,
      tags: []
    }
    const { ctx, update } = context(article)

    await articleResolver.Mutation.restoreArticle({}, { id: ARTICLE_ID }, ctx as never)

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "draft" }) }))
  })

  it("требует активный план для восстановления", async () => {
    const article = {
      id: ARTICLE_ID,
      slug: "archived-article",
      authorId: AUTHOR_ID,
      status: "archived",
      archivedByActorId: AUTHOR_ID,
      archivedByRole: "author",
      firstPublishedAt: null,
      author: { handle: "author" },
      section: null,
      tags: []
    }
    const { ctx, update } = context(article, { ...activeAuthor, planTier: "free", planUntil: null })

    const code = await errorCode(() => articleResolver.Mutation.restoreArticle({}, { id: ARTICLE_ID }, ctx as never))

    expect(code).toBe("PLAN_LIMIT")
    expect(update).not.toHaveBeenCalled()
  })
})
