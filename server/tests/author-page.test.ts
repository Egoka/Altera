import { describe, expect, it, vi } from "vitest"
import type { Cache, CacheSetOptions } from "../src/cache"
import authorResolver, { normalizeHandle, toAuthorLinks } from "../src/graphql/author/resolver"
import feedResolver from "../src/graphql/feed/resolver"

// Страница автора: `docs/spec/20-public/author.md` §1, §3, §4, §8; журнал §20.5, §28.2.

class MemoryCache implements Cache {
  readonly mode = "noop" as const
  readonly values = new Map<string, unknown>()

  async isReady(): Promise<boolean> {
    return true
  }
  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null
  }
  async set<T>(key: string, value: T, _options: CacheSetOptions): Promise<void> {
    void _options
    this.values.set(key, value)
  }
  async del(): Promise<void> {}
  async delByTags(): Promise<void> {}
  async close(): Promise<void> {}
}

const userRow = (overrides: Record<string, unknown> = {}) => ({
  id: "author-1",
  handle: "vera",
  name: "Вера Орлова",
  bio: "Пишет о городе.",
  photoUrl: "https://cdn.example.com/vera.jpg",
  socialLinks: { telegram: "https://t.me/vera" },
  planTier: "pro",
  archivedAt: null,
  ...overrides
})

const articleRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  slug: `slug-${id}`,
  title: `Материал ${id}`,
  dek: null,
  featuredImage: null,
  firstPublishedAt: new Date("2026-09-18T10:00:00.000Z"),
  sourceLocale: "ru",
  author: { name: "Вера Орлова", handle: "vera", planTier: "pro" },
  section: { slug: "culture", name: "Культура", nameEn: "Culture" },
  ...overrides
})

interface AuthorStubs {
  user?: unknown
  history?: unknown
  publishedCount?: number
  localeCount?: number
  firstPublished?: unknown
  articles?: unknown[]
}

const prismaStub = (stubs: AuthorStubs) => {
  const count = vi.fn()
  // Первый счёт — профиль (все языки), второй — лента локали.
  count.mockResolvedValueOnce(stubs.publishedCount ?? 0)
  count.mockResolvedValueOnce(stubs.localeCount ?? stubs.publishedCount ?? 0)
  count.mockResolvedValue(0)

  return {
    count,
    findMany: vi.fn().mockResolvedValue(stubs.articles ?? []),
    prisma: {
      user: { findUnique: vi.fn().mockResolvedValue(stubs.user ?? null) },
      handleHistory: { findUnique: vi.fn().mockResolvedValue(stubs.history ?? null) },
      article: {
        count,
        findFirst: vi.fn().mockResolvedValue(stubs.firstPublished ?? null),
        findMany: vi.fn().mockResolvedValue(stubs.articles ?? [])
      }
    }
  }
}

const context = (prisma: unknown) =>
  ({ cache: new MemoryCache(), prisma, requestId: "req-author", currentUser: null }) as never

const callAuthor = (stubs: AuthorStubs, handle = "vera", stub = prismaStub(stubs)) =>
  authorResolver.Query.author({}, { handle }, context(stub.prisma))

const callAuthorFeed = (stubs: AuthorStubs, args: Record<string, unknown> = {}, stub = prismaStub(stubs)) =>
  feedResolver.Query.feed(
    {},
    { scope: "author", locale: "ru", handle: "vera", page: 1, ...args } as never,
    context(stub.prisma)
  )

describe("хэндл страницы автора", () => {
  it("не учитывает регистр и пробелы по краям", () => {
    expect(normalizeHandle("  Vera  ", "req")).toBe("vera")
  })

  it("отклоняет пустой хэндл", () => {
    expect(() => normalizeHandle("   ", "req")).toThrowError(/Validation failed/)
  })
})

describe("ссылки профиля автора", () => {
  it("собирает пары «вид → адрес» в разобранном виде", () => {
    // Наружу уходит именно разобранный адрес: в разметку не должна попасть строка,
    // которую проверили одним прочтением, а браузер прочитает другим.
    expect(toAuthorLinks({ telegram: "https://t.me/vera", site: "http://vera.example" })).toEqual([
      { kind: "telegram", url: "https://t.me/vera" },
      { kind: "site", url: "http://vera.example/" }
    ])
  })

  it("отбрасывает чужие схемы, пустые и неразбираемые адреса", () => {
    expect(
      toAuthorLinks({
        script: "javascript:alert(1)",
        file: "file:///etc/passwd",
        empty: "  ",
        broken: "не адрес",
        number: 42
      })
    ).toEqual([])
  })

  it("пустой и неверной формы `socialLinks` не ломает профиль", () => {
    expect(toAuthorLinks(null)).toEqual([])
    expect(toAuthorLinks(["https://t.me/vera"])).toEqual([])
  })
})

describe("профиль автора", () => {
  it("отдаёт публичные поля, счёт по всем языкам и дату первой публикации", async () => {
    const profile = await callAuthor({
      user: userRow(),
      publishedCount: 7,
      firstPublished: { firstPublishedAt: new Date("2026-03-04T08:00:00.000Z") }
    })

    expect(profile).toEqual({
      id: "author-1",
      handle: "vera",
      name: "Вера Орлова",
      bio: "Пишет о городе.",
      avatar: "https://cdn.example.com/vera.jpg",
      links: [{ kind: "telegram", url: "https://t.me/vera" }],
      grade: "pro",
      publishedCount: 7,
      firstPublishedAt: "2026-03-04T08:00:00.000Z",
      redirect: null
    })
  })

  it("истёкший план оставляет страницу, но снимает бейдж pro", async () => {
    const profile = await callAuthor({ user: userRow({ planTier: "standard" }), publishedCount: 2 })

    expect(profile.grade).toBe("standard")
    expect(profile.publishedCount).toBe(2)
  })

  it("аккаунт без публикаций публичной страницы не имеет", async () => {
    await expect(callAuthor({ user: userRow(), publishedCount: 0 })).rejects.toThrowError(/Entity not found/)
  })

  it("неизвестный хэндл — «не найдено»", async () => {
    await expect(callAuthor({ user: null, history: null })).rejects.toThrowError(/Entity not found/)
  })

  it("архивированный аккаунт отвечает отказом `ARCHIVED`", async () => {
    await expect(callAuthor({ user: userRow({ archivedAt: new Date() }) })).rejects.toThrowError(/archived/i)
  })

  it("прежний хэндл ведёт на нынешний и отдаёт его профиль", async () => {
    const profile = await callAuthor({ user: null, history: { user: userRow() }, publishedCount: 3 }, "vera-old")

    expect(profile.redirect).toBe("vera")
    expect(profile.handle).toBe("vera")
  })

  it("запись истории без владельца — «не найдено», а не пустая страница", async () => {
    await expect(callAuthor({ user: null, history: { user: null } }, "vera-old")).rejects.toThrowError(
      /Entity not found/
    )
  })

  it("прежний хэндл архивированного аккаунта отвечает `ARCHIVED`", async () => {
    await expect(
      callAuthor({ user: null, history: { user: userRow({ archivedAt: new Date() }) } }, "vera-old")
    ).rejects.toThrowError(/archived/i)
  })
})

describe("лента автора", () => {
  it("отдаёт материалы локали с подписью и пагинацией", async () => {
    const feed = await callAuthorFeed({
      user: userRow(),
      publishedCount: 2,
      localeCount: 2,
      articles: [articleRow("1"), articleRow("2")]
    })

    expect(feed.scope).toBe("author")
    expect(feed.caption).toBe("by_publication_date")
    expect(feed.items.map((item) => item.id)).toEqual(["1", "2"])
    expect(feed.pageInfo).toEqual({ page: 1, totalPages: 1, hasNext: false })
    expect(feed.redirect).toBeNull()
  })

  it("пустая локаль — состояние «пусто», а не отказ", async () => {
    const stub = prismaStub({ user: userRow(), publishedCount: 0, localeCount: 0 })
    const feed = await callAuthorFeed({}, {}, stub)

    expect(feed.items).toEqual([])
    expect(feed.pageInfo).toEqual({ page: 1, totalPages: 0, hasNext: false })
    expect(stub.prisma.article.findMany).not.toHaveBeenCalled()
  })

  it("страница за последней — «не найдено»", async () => {
    await expect(
      callAuthorFeed({ user: userRow(), publishedCount: 2, localeCount: 2 }, { page: 3 })
    ).rejects.toThrowError(/Entity not found/)
  })

  it("прежний хэндл уводит ленту на нынешний", async () => {
    const feed = await callAuthorFeed({ user: null, history: { user: userRow() } }, { handle: "vera-old" })

    expect(feed.redirect).toEqual({ scope: "author", slug: "vera" })
    expect(feed.items).toEqual([])
  })

  it("архивированный аккаунт отвечает отказом `ARCHIVED`", async () => {
    await expect(callAuthorFeed({ user: userRow({ archivedAt: new Date() }) })).rejects.toThrowError(/archived/i)
  })

  it("пустой хэндл — неверный параметр адреса", async () => {
    await expect(callAuthorFeed({ user: userRow() }, { handle: "  " })).rejects.toThrowError(/Validation failed/)
  })
})
