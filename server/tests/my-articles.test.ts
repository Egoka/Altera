import { describe, expect, it, vi } from "vitest"
import articleResolver from "../src/graphql/article/resolver"

const now = new Date("2026-09-17T12:00:00.000Z")

const ownArticles = [
  {
    id: "article-draft",
    status: "draft",
    archivedByActorId: null,
    updatedAt: now,
    section: null,
    format: null,
    tags: [],
    translations: [
      {
        id: "translation-draft",
        locale: "ru",
        slug: "draft",
        title: "Черновик",
        status: "draft",
        rejected: false,
        publishedAt: null,
        updatedAt: now,
        reeditUntil: null,
        reviewMessages: []
      }
    ]
  },
  {
    id: "article-rejected",
    status: "review",
    archivedByActorId: null,
    updatedAt: new Date("2026-09-16T12:00:00.000Z"),
    section: null,
    format: null,
    tags: [],
    translations: [
      {
        id: "translation-rejected",
        locale: "ru",
        slug: "rejected",
        title: "Отклонённый материал",
        status: "review",
        rejected: true,
        publishedAt: null,
        updatedAt: new Date("2026-09-16T12:00:00.000Z"),
        reeditUntil: null,
        reviewMessages: [
          {
            createdAt: new Date("2026-09-16T13:00:00.000Z"),
            readAt: null
          }
        ]
      }
    ]
  },
  {
    id: "article-archived",
    status: "archived",
    archivedByActorId: "editor-1",
    updatedAt: new Date("2026-09-15T12:00:00.000Z"),
    section: null,
    format: null,
    tags: [],
    translations: [
      {
        id: "translation-archived",
        locale: "en",
        slug: "archived",
        title: "Archived article",
        status: "published",
        rejected: false,
        publishedAt: new Date("2026-09-01T12:00:00.000Z"),
        updatedAt: new Date("2026-09-15T12:00:00.000Z"),
        reeditUntil: null,
        reviewMessages: []
      }
    ]
  }
]

const createContext = () => ({
  currentUser: { id: "author-1", role: "author", isServiceAccount: false },
  requestId: "req-my-articles",
  prisma: {
    article: {
      findMany: vi.fn(async ({ where }: { where: { authorId?: string } }) =>
        where.authorId === "author-1" ? ownArticles : []
      )
    }
  }
})

describe("myArticles", () => {
  it("returns the authenticated author's lifecycle states and archive actor", async () => {
    expect("myArticles" in articleResolver.Query).toBe(true)
    if (!("myArticles" in articleResolver.Query)) return

    const result = await articleResolver.Query.myArticles({}, { limit: 20 }, createContext() as never)

    expect(result).toEqual({
      items: [
        expect.objectContaining({ id: "article-draft", status: "draft", archivedBy: null }),
        expect.objectContaining({
          id: "article-rejected",
          status: "review",
          archivedBy: null,
          translations: [
            expect.objectContaining({
              id: "translation-rejected",
              rejected: true,
              lastReviewMessageAt: "2026-09-16T13:00:00.000Z",
              unread: true
            })
          ]
        }),
        expect.objectContaining({ id: "article-archived", status: "archived", archivedBy: "staff" })
      ],
      counts: {
        total: 3,
        draft: 1,
        ai_check: 0,
        review: 0,
        rework: 0,
        published: 0,
        rejected: 1,
        archived: 1
      },
      pageInfo: { endCursor: null, hasNextPage: false }
    })
  })

  it("treats rejected as a translation flag instead of an ArticleStatus value", async () => {
    expect("myArticles" in articleResolver.Query).toBe(true)
    if (!("myArticles" in articleResolver.Query)) return

    const result = await articleResolver.Query.myArticles(
      {},
      { status: ["rejected"], limit: 20 },
      createContext() as never
    )

    expect(result.items.map(({ id }: { id: string }) => id)).toEqual(["article-rejected"])
    expect(result.items[0]?.translations).toEqual([expect.objectContaining({ status: "review", rejected: true })])
  })
})
