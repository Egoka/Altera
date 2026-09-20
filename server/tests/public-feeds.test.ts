import { describe, expect, it, vi } from "vitest"
import type { Cache, CacheSetOptions } from "../src/cache"
import feedResolver, {
  FEED_PAGE_SIZE,
  feedPageInfo,
  LATEST_FEED_MAX_LIMIT,
  requireValidLimit,
  requireValidPage
} from "../src/graphql/feed/resolver"

// Ленты рубрики и тега: `docs/spec/20-public/section-feed.md` §8 и `tag-feed.md` §8.

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

const record = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  slug: `slug-${id}`,
  title: `Материал ${id}`,
  dek: null,
  featuredImage: null,
  firstPublishedAt: new Date("2026-09-18T10:00:00.000Z"),
  sourceLocale: "ru",
  author: { name: "Автор", handle: "author", planTier: "standard" },
  section: { slug: "culture", name: "Культура", nameEn: "Culture" },
  ...overrides
})

interface PrismaStubs {
  section?: Record<string, unknown>
  sections?: unknown[]
  sectionHistory?: unknown
  tag?: Record<string, unknown> | null
  tagHistory?: unknown
  counts?: number[]
  articles?: unknown[]
  tags?: unknown[]
  formatGroups?: unknown[]
  formats?: unknown[]
}

const prismaStub = (stubs: PrismaStubs) => {
  const count = vi.fn()
  for (const value of stubs.counts ?? [1, 1]) count.mockResolvedValueOnce(value)
  count.mockResolvedValue(0)

  return {
    count,
    findMany: vi.fn().mockResolvedValue(stubs.articles ?? []),
    prisma: {
      article: {
        count,
        findMany: vi.fn().mockResolvedValue(stubs.articles ?? []),
        groupBy: vi.fn().mockResolvedValue(stubs.formatGroups ?? [])
      },
      section: {
        findUnique: vi.fn().mockResolvedValue(stubs.section ?? null),
        findMany: vi.fn().mockResolvedValue(stubs.sections ?? [])
      },
      sectionSlugHistory: { findUnique: vi.fn().mockResolvedValue(stubs.sectionHistory ?? null) },
      tag: {
        findUnique: vi.fn().mockResolvedValue(stubs.tag ?? null),
        findMany: vi.fn().mockResolvedValue(stubs.tags ?? [])
      },
      tagSlugHistory: { findUnique: vi.fn().mockResolvedValue(stubs.tagHistory ?? null) },
      format: { findMany: vi.fn().mockResolvedValue(stubs.formats ?? []) }
    }
  }
}

const callFeed = (
  stubs: PrismaStubs,
  args: Record<string, unknown>,
  context: { prisma: unknown } = prismaStub(stubs)
) =>
  feedResolver.Query.feed(
    {},
    { locale: "ru", page: 1, ...args } as never,
    {
      cache: new MemoryCache(),
      prisma: context.prisma,
      requestId: "req-feed",
      currentUser: null
    } as never
  )

const activeSection = {
  name: "Культура",
  nameEn: "Culture",
  description: "Описание рубрики",
  descriptionEn: "Section description",
  status: "active",
  successor: null
}

describe("номер страницы ленты", () => {
  it("принимает целое число от единицы", () => {
    expect(requireValidPage(3, "req")).toBe(3)
  })

  it("отклоняет ноль, отрицательное и дробное значение", () => {
    for (const page of [0, -1, 1.5]) {
      expect(() => requireValidPage(page, "req")).toThrowError(/Validation failed/)
    }
  })

  it("пустая лента даёт ноль страниц и не считается ошибкой", () => {
    expect(feedPageInfo(0, 1, "req")).toEqual({ page: 1, totalPages: 0, hasNext: false })
  })

  it("страница за последней — «не найдено», а не молчаливый откат к первой", () => {
    expect(() => feedPageInfo(FEED_PAGE_SIZE, 2, "req")).toThrowError(/Entity not found/)
  })

  it("считает страницы по размеру страницы ленты", () => {
    expect(feedPageInfo(FEED_PAGE_SIZE + 1, 1, "req")).toEqual({ page: 1, totalPages: 2, hasNext: true })
  })
})

describe("лента рубрики", () => {
  it("архивированная рубрика ведёт на преемника, а не рисует ленту", async () => {
    const feed = await callFeed(
      { section: { ...activeSection, status: "archived", successor: { slug: "society" } } },
      { scope: "section", slug: "culture" }
    )

    expect(feed.redirect).toEqual({ scope: "section", slug: "society" })
    expect(feed.items).toEqual([])
  })

  it("прежний слаг рубрики ведёт на нынешний", async () => {
    const feed = await callFeed(
      { section: null, sectionHistory: { redirectToSection: { slug: "culture" } } },
      { scope: "section", slug: "kultura" }
    )

    expect(feed.redirect).toEqual({ scope: "section", slug: "culture" })
  })

  it("неизвестный слаг — «не найдено»", async () => {
    await expect(callFeed({ section: null }, { scope: "section", slug: "нет-такой" })).rejects.toThrowError(
      /Entity not found/
    )
  })

  it("рубрика без публикаций в локали не публична и отвечает «не найдено»", async () => {
    await expect(
      callFeed({ section: activeSection, counts: [0] }, { scope: "section", slug: "culture" })
    ).rejects.toThrowError(/Entity not found/)
  })

  it("отдаёт страницу материалов, подпись принципа и шапку рубрики", async () => {
    const feed = await callFeed(
      { section: activeSection, counts: [2, 2], articles: [record("1"), record("2")] },
      { scope: "section", slug: "culture" }
    )

    expect(feed.caption).toBe("by_publication_date")
    expect(feed.items.map((item) => item.id)).toEqual(["1", "2"])
    expect(feed.section).toEqual({
      slug: "culture",
      name: "Культура",
      description: "Описание рубрики",
      articleCount: 2
    })
  })

  it("фильтры формата и тега попадают в запрос материалов", async () => {
    const stubs = prismaStub({ section: activeSection, counts: [3, 1], articles: [record("1")] })
    await callFeed({}, { scope: "section", slug: "culture", format: "essay", tag: "ai" }, stubs)

    expect(stubs.prisma.article.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "published",
          sourceLocale: "ru",
          section: { slug: "culture" },
          format: { slug: "essay" },
          tags: { some: { slug: "ai" } }
        })
      })
    )
  })

  it("пустой результат фильтра — состояние «пусто», а не отказ", async () => {
    const feed = await callFeed(
      { section: activeSection, counts: [5, 0] },
      { scope: "section", slug: "culture", tag: "нет-такого" }
    )

    expect(feed.items).toEqual([])
    expect(feed.pageInfo).toEqual({ page: 1, totalPages: 0, hasNext: false })
  })

  it("частые теги рубрики отсортированы по числу материалов", async () => {
    const feed = await callFeed(
      {
        section: activeSection,
        counts: [3, 3],
        articles: [record("1")],
        tags: [
          { slug: "ai", name: "ИИ", nameEn: "AI", _count: { articles: 1 } },
          { slug: "city", name: "Город", nameEn: "City", _count: { articles: 4 } }
        ]
      },
      { scope: "section", slug: "culture" }
    )

    expect(feed.topTags.map((facet) => facet.slug)).toEqual(["city", "ai"])
    expect(feed.topTags[0]).toEqual({ slug: "city", name: "Город", count: 4 })
  })

  it("порядок ленты — новизна, затем идентификатор: страницы не расходятся", async () => {
    const stubs = prismaStub({ section: activeSection, counts: [2, 2], articles: [record("1")] })
    await callFeed({}, { scope: "section", slug: "culture", page: 1 }, stubs)

    expect(stubs.prisma.article.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ firstPublishedAt: "desc" }, { id: "asc" }], take: FEED_PAGE_SIZE })
    )
  })
})

describe("лента тега", () => {
  const activeTag = { name: "ИИ", nameEn: "AI", status: "active", mergedInto: null }

  it("слитый тег ведёт на целевой", async () => {
    const feed = await callFeed(
      { tag: { ...activeTag, mergedInto: { slug: "ai" } } },
      { scope: "tag", slug: "iskusstvennyj-intellekt" }
    )

    expect(feed.redirect).toEqual({ scope: "tag", slug: "ai" })
  })

  it("архивированный тег — «не найдено»", async () => {
    await expect(
      callFeed({ tag: { ...activeTag, status: "archived" } }, { scope: "tag", slug: "ai" })
    ).rejects.toThrowError(/Entity not found/)
  })

  it("неизвестный слаг без истории — «не найдено»", async () => {
    await expect(callFeed({ tag: null }, { scope: "tag", slug: "нет-такого" })).rejects.toThrowError(/Entity not found/)
  })

  it("тег без материалов в локали остаётся страницей с пустым состоянием", async () => {
    const feed = await callFeed({ tag: activeTag, counts: [0] }, { scope: "tag", slug: "ai" })

    expect(feed.items).toEqual([])
    expect(feed.tag).toEqual({ slug: "ai", name: "ИИ", articleCount: 0 })
    expect(feed.pageInfo).toEqual({ page: 1, totalPages: 0, hasNext: false })
  })

  it("отбирает материалы своей локали с этим тегом", async () => {
    const stubs = prismaStub({ tag: activeTag, counts: [1], articles: [record("1")] })
    await callFeed({}, { scope: "tag", slug: "ai", locale: "en" }, stubs)

    expect(stubs.prisma.article.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "published", sourceLocale: "en", tags: { some: { slug: "ai" } } }
      })
    )
  })

  it("лента без слага — неверный запрос, а не пустая страница", async () => {
    await expect(callFeed({}, { scope: "tag", slug: "" })).rejects.toThrowError(/Validation failed/)
  })
})

// Лента `latest` для RSS: `docs/spec/20-public/feeds-and-sitemap.md` §4, §8, §12.
describe("лента последних публикаций", () => {
  it("отдаёт материалы локали в порядке первой публикации", async () => {
    const stubs = prismaStub({ articles: [record("1"), record("2")] })
    const feed = await callFeed({}, { scope: "latest", limit: 50 }, stubs)

    expect(feed.items).toHaveLength(2)
    expect(feed.caption).toBe("by_publication_date")
    expect(stubs.prisma.article.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "published", sourceLocale: "ru", sectionId: { not: null }, firstPublishedAt: { not: null } },
        orderBy: [{ firstPublishedAt: "desc" }, { id: "asc" }],
        take: 50
      })
    )
  })

  it("слаг ленте не нужен: она не привязана к рубрике или тегу", async () => {
    const feed = await callFeed({ articles: [record("1")] }, { scope: "latest" })

    expect(feed.scope).toBe("latest")
    expect(feed.items).toHaveLength(1)
  })

  it("пустая лента — валидный ответ без элементов, а не отказ", async () => {
    const feed = await callFeed({ articles: [] }, { scope: "latest" })

    expect(feed.items).toEqual([])
  })

  it("материал без рубрики в ленту не попадает", async () => {
    const feed = await callFeed({ articles: [record("1", { section: null })] }, { scope: "latest" })

    expect(feed.items).toEqual([])
  })

  it("запрос сверх потолка усекается до пятидесяти элементов", async () => {
    const stubs = prismaStub({ articles: [record("1")] })
    await callFeed({}, { scope: "latest", limit: 500 }, stubs)

    expect(stubs.prisma.article.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: LATEST_FEED_MAX_LIMIT }))
  })

  it("ноль, отрицательное и дробное число элементов — неверный запрос", () => {
    for (const limit of [0, -5, 2.5]) {
      expect(() => requireValidLimit(limit, "req")).toThrowError(/Validation failed/)
    }
    expect(requireValidLimit(10, "req")).toBe(10)
  })
})
