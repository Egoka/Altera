import { describe, expect, it, vi } from "vitest"
import type { Cache, CacheSetOptions } from "../src/cache"
import catalogResolver, {
  AUTHOR_CATALOG_PAGE_SIZE,
  firstSentence,
  lettersOf,
  paginate,
  TAG_CATALOG_PAGE_SIZE
} from "../src/graphql/catalog/resolver"

// Каталоги рубрик, тегов и авторов: `sections-index.md` §8, `tags-index.md` §8,
// `authors-index.md` §8.

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

const context = (prisma: unknown) =>
  ({ cache: new MemoryCache(), prisma, requestId: "req-catalog", currentUser: null }) as never

const tagRow = (slug: string, name: string, articles: number, nameEn = name) => ({
  slug,
  name,
  nameEn,
  _count: { articles }
})

const userRow = (handle: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id: `id-${handle}`,
  handle,
  name,
  bio: null,
  photoUrl: null,
  planTier: "standard",
  isServiceAccount: false,
  _count: { articles: 2 },
  articles: [
    {
      title: `Материал ${handle}`,
      slug: `slug-${handle}`,
      author: { name },
      section: { slug: "culture" },
      firstPublishedAt: new Date("2026-09-18T10:00:00.000Z")
    }
  ],
  ...overrides
})

describe("вспомогательные правила каталогов", () => {
  it("страница за последней — «не найдено»", () => {
    expect(() => paginate([1, 2], 2, 10, "req")).toThrowError(/Entity not found/)
  })

  it("пустой каталог даёт ноль страниц и не падает", () => {
    expect(paginate([], 1, 10, "req").pageInfo).toEqual({ page: 1, totalPages: 0, totalCount: 0, hasNext: false })
  })

  it("указатель собирает первые буквы без повторов", () => {
    expect(lettersOf(["Анна", "антон", "Борис", " "])).toEqual(["А", "Б"])
  })

  it("«о себе» сокращается до первого предложения", () => {
    expect(firstSentence("Пишет о городе. Живёт в Москве.")).toBe("Пишет о городе.")
    expect(firstSentence("Одна строка без точки")).toBe("Одна строка без точки")
    expect(firstSentence("   ")).toBeNull()
    expect(firstSentence(null)).toBeNull()
  })
})

describe("каталог рубрик", () => {
  const prisma = (sections: unknown[]) => ({ section: { findMany: vi.fn().mockResolvedValue(sections) } })

  it("отдаёт рубрики в ручном порядке со счётчиком и превью", async () => {
    const client = prisma([
      {
        slug: "culture",
        name: "Культура",
        nameEn: "Culture",
        description: "Описание",
        descriptionEn: "Description",
        order: 1,
        _count: { articles: 7 },
        articles: [{ title: "Материал", slug: "slug-1", author: { name: "Автор" }, section: { slug: "culture" } }]
      }
    ])

    const catalog = await catalogResolver.Query.sectionCatalog({}, { locale: "ru" } as never, context(client))

    expect(catalog).toEqual([
      {
        slug: "culture",
        name: "Культура",
        description: "Описание",
        cover: null,
        order: 1,
        articleCount: 7,
        preview: [{ title: "Материал", path: "/culture/slug-1", author: "Автор" }]
      }
    ])
  })

  it("просит у базы только активные рубрики с публикациями локали", async () => {
    const client = prisma([])
    await catalogResolver.Query.sectionCatalog({}, { locale: "en" } as never, context(client))

    expect(client.section.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "active", articles: { some: { status: "published", sourceLocale: "en" } } },
        orderBy: { order: "asc" }
      })
    )
  })

  it("пустой каталог — пустой список, а не отказ", async () => {
    expect(await catalogResolver.Query.sectionCatalog({}, { locale: "ru" } as never, context(prisma([])))).toEqual([])
  })
})

describe("каталог тегов", () => {
  const prisma = (tags: unknown[]) => ({ tag: { findMany: vi.fn().mockResolvedValue(tags) } })
  const call = (client: unknown, args: Record<string, unknown> = {}) =>
    catalogResolver.Query.tagCatalog({}, { locale: "ru", sort: "popular", page: 1, ...args } as never, context(client))

  it("порядок «популярные» — по числу материалов локали", async () => {
    const catalog = await call(prisma([tagRow("ai", "ИИ", 2), tagRow("city", "Город", 9)]))

    expect(catalog.items.map((tag) => tag.slug)).toEqual(["city", "ai"])
  })

  it("порядок «по имени» — по алфавиту", async () => {
    const catalog = await call(prisma([tagRow("ai", "ИИ", 9), tagRow("city", "Город", 2)]), { sort: "name" })

    expect(catalog.items.map((tag) => tag.slug)).toEqual(["city", "ai"])
  })

  it("исключает архивированные и слитые теги", async () => {
    const client = prisma([])
    await call(client)

    expect(client.tag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "active",
          mergedIntoId: null,
          articles: { some: { status: "published", sourceLocale: "ru" } }
        }
      })
    )
  })

  it("ищет по началу слова и возвращает пустой список, когда совпадений нет", async () => {
    const client = prisma([tagRow("city", "Город", 3), tagRow("ai", "ИИ", 1)])

    expect((await call(client, { q: "Гор" })).items.map((tag) => tag.slug)).toEqual(["city"])
    expect((await call(client, { q: "Зет" })).items).toEqual([])
  })

  it("поиск короче двух знаков — неверный параметр", async () => {
    await expect(call(prisma([]), { q: "Г" })).rejects.toThrowError(/Validation failed/)
  })

  it("буква указателя — ровно один знак", async () => {
    await expect(call(prisma([]), { letter: "Аб" })).rejects.toThrowError(/Validation failed/)
  })

  it("буква фильтрует список, а указатель остаётся полным", async () => {
    const catalog = await call(prisma([tagRow("city", "Город", 3), tagRow("ai", "ИИ", 1)]), { letter: "г" })

    expect(catalog.items.map((tag) => tag.slug)).toEqual(["city"])
    expect(catalog.letters).toEqual(["Г", "И"])
  })

  it("считает страницы по сотне тегов", async () => {
    const tags = Array.from({ length: TAG_CATALOG_PAGE_SIZE + 1 }, (_, index) => tagRow(`t${index}`, `Тег ${index}`, 1))

    expect((await call(prisma(tags))).pageInfo).toEqual({
      page: 1,
      totalPages: 2,
      totalCount: TAG_CATALOG_PAGE_SIZE + 1,
      hasNext: true
    })
  })

  it("облако популярных ограничено верхним пределом", async () => {
    const tags = Array.from({ length: 40 }, (_, index) => tagRow(`t${index}`, `Тег ${index}`, index))
    const cloud = await catalogResolver.Query.popularTags(
      {},
      { locale: "ru", limit: 100 } as never,
      context(prisma(tags))
    )

    expect(cloud).toHaveLength(30)
    expect(cloud[0]!.articleCount).toBe(39)
  })
})

describe("каталог авторов", () => {
  const prisma = (users: unknown[]) => ({ user: { findMany: vi.fn().mockResolvedValue(users) } })
  const call = (client: unknown, args: Record<string, unknown> = {}) =>
    catalogResolver.Query.authorCatalog(
      {},
      { locale: "ru", sort: "recent", page: 1, ...args } as never,
      context(client)
    )

  it("до запуска рейтинга порядок — дата последней публикации", async () => {
    const older = userRow("older", "Борис", {
      articles: [
        {
          title: "Старое",
          slug: "old",
          author: { name: "Борис" },
          section: { slug: "culture" },
          firstPublishedAt: new Date("2026-01-01T00:00:00.000Z")
        }
      ]
    })
    const catalog = await call(prisma([older, userRow("recent", "Анна")]))

    expect(catalog.items.map((author) => author.handle)).toEqual(["recent", "older"])
  })

  it("«Редакция» идёт первой карточкой при любом порядке", async () => {
    const editorial = userRow("editorial", "Редакция", {
      isServiceAccount: true,
      articles: [
        {
          title: "Старое",
          slug: "old",
          author: { name: "Редакция" },
          section: { slug: "culture" },
          firstPublishedAt: new Date("2020-01-01T00:00:00.000Z")
        }
      ]
    })
    const catalog = await call(prisma([userRow("anna", "Анна"), editorial]))

    expect(catalog.items[0]!.handle).toBe("editorial")
  })

  it("не отдаёт плана, срока и e-mail — только публичные поля", async () => {
    const catalog = await call(prisma([userRow("anna", "Анна", { planTier: "pro", bio: "Пишет о городе. И ещё." })]))

    expect(catalog.items[0]).toEqual({
      id: "id-anna",
      handle: "anna",
      name: "Анна",
      avatar: null,
      grade: "pro",
      bioShort: "Пишет о городе.",
      publishedCount: 2,
      lastPublishedAt: "2026-09-18T10:00:00.000Z",
      isEditorial: false,
      recent: [{ title: "Материал anna", path: "/culture/slug-anna", author: "Анна" }]
    })
  })

  it("берёт только не архивированные аккаунты с публикациями рубрики и локали", async () => {
    const client = prisma([])
    await call(client, { locale: "en", section: "culture" })

    expect(client.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          articles: { some: { status: "published", sourceLocale: "en", section: { slug: "culture" } } }
        }
      })
    )
  })

  it("пустой результат фильтра — пустой список, а не отказ", async () => {
    const catalog = await call(prisma([]), { section: "нет-такой" })

    expect(catalog.items).toEqual([])
    expect(catalog.pageInfo.totalPages).toBe(0)
  })

  it("считает страницы по тридцати авторам", async () => {
    const users = Array.from({ length: AUTHOR_CATALOG_PAGE_SIZE + 1 }, (_, index) =>
      userRow(`a${index}`, `Автор ${index}`)
    )

    expect((await call(prisma(users))).pageInfo.totalPages).toBe(2)
  })
})
