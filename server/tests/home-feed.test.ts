import { describe, expect, it, vi } from "vitest"
import type { Cache, CacheSetOptions } from "../src/cache"
import { buildCacheKey, CACHE_TTL_SECONDS } from "../src/cache"
import { buildArticleCacheTags } from "../src/cache/key"
import feedResolver, {
  buildHomeSections,
  HOME_NEW_SIZE,
  HOME_NEW_WINDOW_DAYS,
  HOME_TOP_SIZE,
  type FeedArticleRecord
} from "../src/graphql/feed/resolver"

const now = new Date("2026-09-20T12:00:00.000Z")
const DAY_MS = 24 * 60 * 60 * 1000

class MemoryCache implements Cache {
  readonly mode = "noop" as const
  readonly values = new Map<string, unknown>()
  writes: Array<{ key: string; options: CacheSetOptions }> = []

  async isReady(): Promise<boolean> {
    return true
  }
  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null
  }
  async set<T>(key: string, value: T, options: CacheSetOptions): Promise<void> {
    this.writes.push({ key, options })
    this.values.set(key, value)
  }
  async del(): Promise<void> {}
  async delByTags(tags: readonly string[]): Promise<void> {
    for (const [key, value] of [...this.values]) {
      void value
      if (tags.includes("home") && key.includes("query.feed")) this.values.delete(key)
    }
  }
  async close(): Promise<void> {}
}

const article = (overrides: Partial<FeedArticleRecord> & { id: string; daysAgo: number }): FeedArticleRecord => ({
  slug: `slug-${overrides.id}`,
  title: `Материал ${overrides.id}`,
  dek: null,
  featuredImage: null,
  sourceLocale: "ru",
  author: { name: "Автор", handle: "author", planTier: "standard" },
  section: { slug: "culture", name: "Культура", nameEn: "Culture" },
  ...overrides,
  firstPublishedAt: new Date(now.getTime() - overrides.daysAgo * DAY_MS)
})

const candidates = (count: number, daysAgo = 0) =>
  Array.from({ length: count }, (_, index) => article({ id: String(index + 1), daysAgo }))

describe("подборки главной первого этапа", () => {
  it("отдаёт ровно пять материалов в топе и подпись «по дате публикации»", () => {
    const sections = buildHomeSections(candidates(HOME_TOP_SIZE + 3), "ru", now)
    const top = sections.find((section) => section.key === "top")!

    expect(top.items).toHaveLength(HOME_TOP_SIZE)
    expect(sections.map((section) => section.caption)).toEqual(["by_publication_date", "by_publication_date"])
    expect(sections.map((section) => section.key)).toEqual(["top", "new"])
  })

  it("не повторяет материал в двух подборках и добирает освободившееся место", () => {
    const sections = buildHomeSections(candidates(HOME_TOP_SIZE + HOME_NEW_SIZE), "ru", now)
    const top = sections.find((section) => section.key === "top")!
    const fresh = sections.find((section) => section.key === "new")!
    const all = [...top.items, ...fresh.items].map((item) => item.id)

    expect(fresh.items).toHaveLength(HOME_NEW_SIZE)
    expect(new Set(all).size).toBe(all.length)
    expect(fresh.items.map((item) => item.id)).not.toContain(top.items[0]!.id)
  })

  it("оставляет в «Новом» только материалы окна новизны", () => {
    const sections = buildHomeSections(
      [...candidates(HOME_TOP_SIZE, 0), article({ id: "old", daysAgo: HOME_NEW_WINDOW_DAYS + 1 })],
      "ru",
      now
    )

    expect(sections.map((section) => section.key)).toEqual(["top"])
  })

  it("на пустой базе возвращает пустой список подборок без ошибки", () => {
    expect(buildHomeSections([], "ru", now)).toEqual([])
  })

  it("не показывает «Популярное» до контура вовлечённости", () => {
    const sections = buildHomeSections(candidates(HOME_TOP_SIZE + HOME_NEW_SIZE), "ru", now)

    expect(sections.map((section) => section.key)).not.toContain("popular")
  })

  it("берёт название рубрики и уровень автора для локали запроса", () => {
    const proAuthor = article({
      id: "pro",
      daysAgo: 0,
      author: { name: "Про", handle: "pro-author", planTier: "pro" }
    })

    const [item] = buildHomeSections([proAuthor], "en", now)[0]!.items

    expect(item).toMatchObject({
      sectionSlug: "culture",
      sectionName: "Culture",
      author: { handle: "pro-author", grade: "pro" },
      isTranslation: true
    })
  })

  it("не выводит материал без рубрики: путь карточки без неё не собрать", () => {
    const orphan = { ...article({ id: "orphan", daysAgo: 0 }), section: null }

    expect(buildHomeSections([orphan], "ru", now)).toEqual([])
  })
})

describe("резолвер feed", () => {
  const callFeed = async (cache: Cache, findMany: ReturnType<typeof vi.fn>, locale: "ru" | "en" = "ru") =>
    feedResolver.Query.feed({}, { scope: "home", locale }, {
      cache,
      prisma: { article: { findMany } },
      requestId: "req-feed",
      currentUser: null
    } as never)

  it("читает только опубликованные материалы своей локали с рубрикой", async () => {
    const findMany = vi.fn().mockResolvedValue([])

    await callFeed(new MemoryCache(), findMany, "en")

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "published",
          sourceLocale: "en",
          sectionId: { not: null },
          firstPublishedAt: { not: null }
        },
        orderBy: { firstPublishedAt: "desc" },
        take: HOME_TOP_SIZE + HOME_NEW_SIZE
      })
    )
  })

  it("кеширует ответ под общим тегом home и не обращается к базе повторно", async () => {
    const cache = new MemoryCache()
    const findMany = vi.fn().mockResolvedValue(candidates(1))

    const first = await callFeed(cache, findMany)
    const second = await callFeed(cache, findMany)

    expect(findMany).toHaveBeenCalledOnce()
    expect(second).toEqual(first)
    expect(cache.writes).toEqual([
      {
        key: buildCacheKey("query.feed", { scope: "home", locale: "ru" }),
        options: { ttlSeconds: CACHE_TTL_SECONDS.publicList, tags: ["home"] }
      }
    ])
  })

  it("инвалидация статьи сбрасывает подборки: тег home входит в набор публикации", async () => {
    const cache = new MemoryCache()
    const findMany = vi.fn().mockResolvedValue(candidates(1))

    await callFeed(cache, findMany)
    await cache.delByTags(buildArticleCacheTags({ slug: "slug-1", section: { slug: "culture" } }))
    await callFeed(cache, findMany)

    expect(buildArticleCacheTags({ slug: "slug-1" })).toContain("home")
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it("ответ не зависит от сессии: ключ кеша собран только из scope и локали", async () => {
    const cache = new MemoryCache()
    const findMany = vi.fn().mockResolvedValue(candidates(1))

    await callFeed(cache, findMany)

    expect(cache.values.has(buildCacheKey("query.feed", { scope: "home", locale: "ru" }))).toBe(true)
    expect(cache.values.has(buildCacheKey("query.feed", { scope: "home", locale: "en" }))).toBe(false)
  })
})
