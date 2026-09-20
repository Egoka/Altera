import { describe, expect, it, vi } from "vitest"
import type { Cache, CacheSetOptions } from "../src/cache"
import sitemapResolver, {
  buildSitemap,
  collectLocaleEntries,
  SITEMAP_MAX_URLS,
  SITEMAP_PRIORITY
} from "../src/graphql/sitemap/resolver"

// Карта сайта по локалям: `docs/spec/20-public/feeds-and-sitemap.md` §4, §5.3, §8.

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

const updated = (iso: string) => ({ updatedAt: new Date(iso) })

interface LocaleData {
  newest?: { updatedAt: Date } | null
  articles?: unknown[]
  sections?: unknown[]
  tags?: unknown[]
  authors?: unknown[]
}

/**
 * Выдача разделена по локали запроса: резолвер собирает обе карты, поэтому заглушка читает
 * `sourceLocale` условия и отвечает данными нужного языка.
 */
const prismaStub = (data: Record<string, LocaleData>) => {
  const localeOf = (args: { where?: { sourceLocale?: string; articles?: { some?: { sourceLocale?: string } } } }) =>
    args.where?.sourceLocale ?? args.where?.articles?.some?.sourceLocale ?? "ru"
  const of = (locale: string) => data[locale] ?? {}

  return {
    article: {
      findFirst: vi.fn(async (args: never) => of(localeOf(args)).newest ?? null),
      findMany: vi.fn(async (args: never) => of(localeOf(args)).articles ?? [])
    },
    section: { findMany: vi.fn(async (args: never) => of(localeOf(args)).sections ?? []) },
    tag: { findMany: vi.fn(async (args: never) => of(localeOf(args)).tags ?? []) },
    user: { findMany: vi.fn(async (args: never) => of(localeOf(args)).authors ?? []) }
  }
}

const context = (prisma: unknown) =>
  ({ prisma, cache: new MemoryCache(), requestId: "req-sitemap", currentUser: null }) as never

const callSitemap = (data: Record<string, LocaleData>, locale: "ru" | "en" = "ru") =>
  sitemapResolver.Query.sitemapEntries({}, { locale }, context(prismaStub(data)))

const ruData: LocaleData = {
  newest: updated("2026-09-20T12:00:00.000Z"),
  articles: [
    { slug: "letter", updatedAt: new Date("2026-09-20T12:00:00.000Z"), section: { slug: "culture" } },
    { slug: "essay", updatedAt: new Date("2026-09-19T08:00:00.000Z"), section: { slug: "culture" } }
  ],
  sections: [{ slug: "culture", articles: [updated("2026-09-20T12:00:00.000Z")] }],
  tags: [{ slug: "cinema", articles: [updated("2026-09-19T08:00:00.000Z")] }],
  authors: [{ handle: "ivan", articles: [updated("2026-09-20T12:00:00.000Z")] }]
}

describe("состав карты сайта", () => {
  it("содержит главную, статические страницы, материалы, рубрики, теги и авторов", async () => {
    const entries = await callSitemap({ ru: ruData })
    const paths = entries.map((entry) => entry.path)

    expect(paths).toEqual([
      "/",
      "/sections",
      "/tags",
      "/authors",
      "/pricing",
      "/culture/letter",
      "/culture/essay",
      "/culture",
      "/tags/cinema",
      "/authors/ivan"
    ])
  })

  it("приоритет главной выше материала, материала — выше списка", async () => {
    const entries = await callSitemap({ ru: ruData })
    const priorityOf = (path: string) => entries.find((entry) => entry.path === path)?.priority

    expect(priorityOf("/")).toBe(SITEMAP_PRIORITY.home)
    expect(priorityOf("/culture/letter")).toBe(SITEMAP_PRIORITY.article)
    expect(priorityOf("/culture")).toBe(SITEMAP_PRIORITY.list)
    expect(SITEMAP_PRIORITY.home).toBeGreaterThan(SITEMAP_PRIORITY.article)
    expect(SITEMAP_PRIORITY.article).toBeGreaterThan(SITEMAP_PRIORITY.list)
  })

  it("дата изменения материала и списка приходит из его последней правки", async () => {
    const entries = await callSitemap({ ru: ruData })
    const lastmodOf = (path: string) => entries.find((entry) => entry.path === path)?.lastmod

    expect(lastmodOf("/culture/letter")).toBe("2026-09-20T12:00:00.000Z")
    expect(lastmodOf("/tags/cinema")).toBe("2026-09-19T08:00:00.000Z")
    expect(lastmodOf("/")).toBe("2026-09-20T12:00:00.000Z")
    // У страницы без материалов даты изменения нет — поле необязательное.
    expect(lastmodOf("/pricing")).toBeNull()
  })

  it("отбирает только опубликованные материалы языка оригинала", async () => {
    const prisma = prismaStub({ ru: ruData })
    await sitemapResolver.Query.sitemapEntries({}, { locale: "ru" }, context(prisma))

    const where = prisma.article.findMany.mock.calls[0]![0]!.where
    expect(where).toMatchObject({ status: "published", sourceLocale: "ru", sectionId: { not: null } })
  })

  it("не выводит рубрику и тег без публикаций локали", async () => {
    const entries = await callSitemap({ ru: { ...ruData, sections: [], tags: [], authors: [] } })

    expect(entries.map((entry) => entry.path)).not.toContain("/culture")
    expect(entries.every((entry) => !entry.path.startsWith("/tags/"))).toBe(true)
  })

  it("материал без рубрики в карту не попадает", async () => {
    const entries = await callSitemap({
      ru: { ...ruData, articles: [{ slug: "orphan", updatedAt: new Date(), section: null }] }
    })

    expect(entries.some((entry) => entry.path.includes("orphan"))).toBe(false)
  })

  it("пустая выдача оставляет главную и статические страницы", async () => {
    const entries = await callSitemap({ ru: {} })

    expect(entries.map((entry) => entry.path)).toEqual(["/", "/sections", "/tags", "/authors", "/pricing"])
    expect(entries[0]!.lastmod).toBeNull()
  })

  it("ограничивает выборку материалов потолком адресов файла", async () => {
    const prisma = prismaStub({ ru: ruData })
    await sitemapResolver.Query.sitemapEntries({}, { locale: "ru" }, context(prisma))

    expect(prisma.article.findMany.mock.calls[0]![0]!.take).toBe(SITEMAP_MAX_URLS)
  })
})

describe("языковые версии адреса", () => {
  it("статические страницы публичны в обеих локалях", async () => {
    const entries = await callSitemap({ ru: ruData, en: {} })
    const localesOf = (path: string) => entries.find((entry) => entry.path === path)?.locales

    expect(localesOf("/")).toEqual(["ru", "en"])
    expect(localesOf("/pricing")).toEqual(["ru", "en"])
  })

  it("рубрика получает альтернативу только там, где у неё есть публикации", async () => {
    const withEnglish = await callSitemap({
      ru: ruData,
      en: { sections: [{ slug: "culture", articles: [updated("2026-09-18T00:00:00.000Z")] }] }
    })
    const withoutEnglish = await callSitemap({ ru: ruData, en: {} })

    expect(withEnglish.find((entry) => entry.path === "/culture")?.locales).toEqual(["ru", "en"])
    expect(withoutEnglish.find((entry) => entry.path === "/culture")?.locales).toEqual(["ru"])
  })

  it("материал остаётся одноязычным: слаг уникален, пары версий в модели ещё нет", async () => {
    const entries = await callSitemap({
      ru: ruData,
      en: {
        articles: [{ slug: "english-letter", updatedAt: new Date(), section: { slug: "culture" } }],
        sections: [{ slug: "culture", articles: [updated("2026-09-18T00:00:00.000Z")] }]
      }
    })

    expect(entries.find((entry) => entry.path === "/culture/letter")?.locales).toEqual(["ru"])
    expect(entries.some((entry) => entry.path === "/culture/english-letter")).toBe(false)
  })

  it("сборка карты помечает своей локалью каждый адрес", () => {
    const built = buildSitemap([{ path: "/x", lastmod: null, priority: 0.5 }], new Set(["/x"]), "en")

    expect(built).toEqual([{ path: "/x", lastmod: null, priority: 0.5, locales: ["en", "ru"] }])
  })
})

describe("кеш карты сайта", () => {
  it("второй запрос той же локали читает сохранённое значение", async () => {
    const prisma = prismaStub({ ru: ruData })
    const cache = new MemoryCache()
    const ctx = { prisma, cache, requestId: "req-sitemap", currentUser: null } as never

    await sitemapResolver.Query.sitemapEntries({}, { locale: "ru" }, ctx)
    await sitemapResolver.Query.sitemapEntries({}, { locale: "ru" }, ctx)

    expect(cache.values.size).toBe(1)
    expect(prisma.article.findMany).toHaveBeenCalledTimes(2)
  })
})

describe("адреса личных и служебных разделов", () => {
  it("кабинет, админка, вход и поиск в карту не попадают", async () => {
    const entries = await collectLocaleEntries(context(prismaStub({ ru: ruData })), "ru")
    const paths = entries.map((entry) => entry.path)

    for (const forbidden of ["/me", "/admin", "/auth", "/search", "/preview"]) {
      expect(paths.some((path) => path === forbidden || path.startsWith(`${forbidden}/`))).toBe(false)
    }
    expect(paths.every((path) => !path.includes("?"))).toBe(true)
  })
})
