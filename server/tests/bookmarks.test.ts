import { describe, expect, it, vi } from "vitest"
import bookmarkResolver from "../src/graphql/bookmark/resolver"
import type { GraphQLContext } from "../src/prisma"

const publishedArticle = {
  id: "article-published",
  title: "Город, который слушает море",
  slug: "gorod-slushaet-more",
  status: "published",
  sourceLocale: "ru",
  featuredImage: "/images/sea.jpg",
  publishedAt: new Date("2026-09-10T12:00:00.000Z"),
  author: { name: "Анна Волкова", handle: "anna-volkova" },
  section: { id: "section-travel", name: "Путешествия", slug: "travel" }
}

const archivedArticle = {
  id: "article-archived",
  title: "Снятый материал",
  slug: "snyatyy-material",
  status: "archived",
  sourceLocale: "ru",
  featuredImage: null,
  publishedAt: null,
  author: { name: "Пётр Ильин", handle: "petr-ilin" },
  section: null
}

const bookmarks = [
  { articleId: archivedArticle.id, createdAt: new Date("2026-09-18T10:00:00.000Z"), article: archivedArticle },
  { articleId: publishedArticle.id, createdAt: new Date("2026-09-17T10:00:00.000Z"), article: publishedArticle }
]

interface ContextOverrides {
  role?: string
  isServiceAccount?: boolean
  archivedAt?: Date | null
  currentUser?: null
}

const createContext = (overrides: ContextOverrides = {}) => {
  const metric = vi.fn()

  const ctx = {
    currentUser:
      overrides.currentUser === null
        ? null
        : {
            id: "reader-1",
            role: overrides.role ?? "reader",
            isServiceAccount: overrides.isServiceAccount ?? false,
            archivedAt: overrides.archivedAt ?? null,
            planTier: "free",
            planUntil: null
          },
    requestId: "req-bookmarks",
    logger: { log: vi.fn(), metric },
    prisma: {
      bookmark: {
        findMany: vi.fn(async ({ where }: { where: { article?: unknown } }) =>
          where.article ? bookmarks.filter((bookmark) => bookmark.article.status !== "published") : bookmarks
        ),
        findUnique: vi.fn(
          async ({ where }: { where: { userId_articleId: { articleId: string } } }) =>
            bookmarks.find((bookmark) => bookmark.articleId === where.userId_articleId.articleId) ?? null
        ),
        count: vi.fn(async ({ where }: { where: { article?: unknown } }) => (where.article ? 1 : bookmarks.length)),
        upsert: vi.fn(async () => ({})),
        deleteMany: vi.fn(async ({ where }: { where: { articleId: string } }) => ({
          count: bookmarks.some((bookmark) => bookmark.articleId === where.articleId) ? 1 : 0
        }))
      },
      article: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            [publishedArticle, archivedArticle].find((article) => article.id === where.id) ?? null
        )
      }
    }
  } as unknown as GraphQLContext

  return { ctx, metric }
}

const expectApiError = async (promise: Promise<unknown>, code: string, fields: Record<string, unknown> = {}) => {
  await expect(promise).rejects.toMatchObject({ extensions: { code, ...fields } })
}

describe("T-033 myBookmarks", () => {
  it("оставляет архивированный материал в списке недоступным", async () => {
    const { ctx } = createContext()

    const result = await bookmarkResolver.Query.myBookmarks({}, {}, ctx)

    expect(result.items.map((item) => [item.article.id, item.article.available])).toEqual([
      ["article-archived", false],
      ["article-published", true]
    ])
    expect(result.counts).toEqual({ total: 2, unavailable: 1 })
    expect(result.pageInfo).toEqual({ endCursor: null, hasNextPage: false })
  })

  it("отдаёт по фильтру только недоступные закладки", async () => {
    const { ctx } = createContext()

    const result = await bookmarkResolver.Query.myBookmarks({}, { unavailable: true }, ctx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.article).toMatchObject({ id: "article-archived", available: false })
  })

  it("сохраняет порядок по дате добавления и переносит поля карточки", async () => {
    const { ctx } = createContext()

    const [first, second] = (await bookmarkResolver.Query.myBookmarks({}, {}, ctx)).items

    expect(first?.bookmarkedAt).toBe("2026-09-18T10:00:00.000Z")
    expect(second?.article).toMatchObject({
      locale: "ru",
      cover: "/images/sea.jpg",
      publishedAt: "2026-09-10T12:00:00.000Z",
      author: { name: "Анна Волкова", handle: "anna-volkova" }
    })
  })

  it("отклоняет неизвестный курсор и лимит вне диапазона", async () => {
    const { ctx } = createContext()

    await expectApiError(
      bookmarkResolver.Query.myBookmarks({}, { cursor: "article-missing" }, ctx),
      "VALIDATION_ERROR",
      {
        field: "cursor"
      }
    )
    await expectApiError(bookmarkResolver.Query.myBookmarks({}, { limit: 0 }, ctx), "VALIDATION_ERROR", {
      field: "limit"
    })
    await expectApiError(bookmarkResolver.Query.myBookmarks({}, { limit: 101 }, ctx), "VALIDATION_ERROR", {
      field: "limit"
    })
  })
})

describe("T-033 доступ к закладкам", () => {
  it("возвращает FORBIDDEN служебной роли на bookmark.add", async () => {
    for (const role of ["editor", "moderator", "analyst", "admin", "owner"]) {
      const { ctx, metric } = createContext({ role, isServiceAccount: true })

      await expectApiError(
        bookmarkResolver.Mutation.addBookmark({}, { articleId: "article-published" }, ctx),
        "FORBIDDEN",
        {
          action: "bookmark.add"
        }
      )
      expect(metric).not.toHaveBeenCalled()
    }
  })

  it("возвращает FORBIDDEN обычному служебному аккаунту с ролью читателя", async () => {
    const { ctx } = createContext({ role: "reader", isServiceAccount: true })

    await expectApiError(
      bookmarkResolver.Mutation.addBookmark({}, { articleId: "article-published" }, ctx),
      "FORBIDDEN",
      {
        action: "bookmark.add"
      }
    )
  })

  it("закрывает список и удаление для служебной роли", async () => {
    const { ctx } = createContext({ role: "admin", isServiceAccount: true })

    await expectApiError(bookmarkResolver.Query.myBookmarks({}, {}, ctx), "FORBIDDEN", { action: "bookmark.list" })
    await expectApiError(
      bookmarkResolver.Mutation.removeBookmark({}, { articleId: "article-published" }, ctx),
      "FORBIDDEN",
      { action: "bookmark.remove" }
    )
  })

  it("закрывает закладки архивированному аккаунту и гостю", async () => {
    const { ctx: archived } = createContext({ archivedAt: new Date("2026-09-01T00:00:00.000Z") })
    await expectApiError(bookmarkResolver.Query.myBookmarks({}, {}, archived), "FORBIDDEN", {
      action: "bookmark.list"
    })

    const { ctx: guest } = createContext({ currentUser: null })
    await expectApiError(bookmarkResolver.Query.myBookmarks({}, {}, guest), "UNAUTHENTICATED")
  })
})

describe("T-033 мутации закладок", () => {
  it("сохраняет опубликованный материал и пишет счётчик bookmark.add", async () => {
    const { ctx, metric } = createContext({ role: "author" })

    const result = await bookmarkResolver.Mutation.addBookmark({}, { articleId: "article-published" }, ctx)

    expect(result).toEqual({ articleId: "article-published", bookmarked: true })
    expect(metric).toHaveBeenCalledWith({
      event: "bookmark.add",
      requestId: "req-bookmarks",
      data: { articleId: "article-published" }
    })
  })

  it("не даёт сохранить снятый или несуществующий материал", async () => {
    const { ctx } = createContext()

    await expectApiError(
      bookmarkResolver.Mutation.addBookmark({}, { articleId: "article-archived" }, ctx),
      "NOT_FOUND",
      {
        entity: "article"
      }
    )
    await expectApiError(
      bookmarkResolver.Mutation.addBookmark({}, { articleId: "article-missing" }, ctx),
      "NOT_FOUND",
      {
        entity: "article"
      }
    )
  })

  it("убирает закладку и сообщает NOT_FOUND, если её не было", async () => {
    const { ctx, metric } = createContext()

    await expect(bookmarkResolver.Mutation.removeBookmark({}, { articleId: "article-archived" }, ctx)).resolves.toEqual(
      {
        articleId: "article-archived",
        bookmarked: false
      }
    )
    expect(metric).toHaveBeenCalledWith({
      event: "bookmark.remove",
      requestId: "req-bookmarks",
      data: { articleId: "article-archived" }
    })

    await expectApiError(
      bookmarkResolver.Mutation.removeBookmark({}, { articleId: "article-missing" }, ctx),
      "NOT_FOUND",
      {
        entity: "bookmark"
      }
    )
  })

  it("отдаёт состояние кнопки на материале", async () => {
    const { ctx } = createContext()

    await expect(bookmarkResolver.Query.myBookmark({}, { articleId: "article-published" }, ctx)).resolves.toEqual({
      articleId: "article-published",
      bookmarked: true
    })
    await expect(bookmarkResolver.Query.myBookmark({}, { articleId: "article-missing" }, ctx)).resolves.toEqual({
      articleId: "article-missing",
      bookmarked: false
    })
  })
})
