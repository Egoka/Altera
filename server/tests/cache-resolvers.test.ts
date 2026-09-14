import { describe, expect, it } from "vitest"
import type { Cache, CacheSetOptions } from "../src/cache"
import { buildCacheKey } from "../src/cache"
import { buildArticleCacheTags } from "../src/cache/key"
import { readThroughPublicCache } from "../src/cache/read-through"
import userResolver from "../src/graphql/user/resolver"
import articleResolver from "../src/graphql/article/resolver"

class MemoryCache implements Cache {
  readonly mode = "noop" as const
  readonly values = new Map<string, unknown>()
  writes = 0
  invalidations: readonly string[][] = []

  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null
  }

  async set<T>(key: string, value: T, options: CacheSetOptions): Promise<void> {
    void options
    this.writes++
    this.values.set(key, value)
  }

  async del(key: string): Promise<void> {
    void key
  }
  async delByTags(tags: readonly string[]): Promise<void> {
    this.invalidations = [...this.invalidations, [...tags]]
  }
  async close(): Promise<void> {}
}

describe("readThroughPublicCache", () => {
  it("повторно возвращает опубликованный результат из кеша", async () => {
    const cache = new MemoryCache()
    const key = buildCacheKey("query.article", { slug: "published" })
    let fetches = 0
    const fetcher = async () => {
      fetches++
      return { slug: "published", status: "published" }
    }
    const options = {
      cache,
      key,
      tags: ["article:published"],
      ttlSeconds: 3600,
      cacheWhen: (article: { status: string }) => article.status === "published"
    }

    await readThroughPublicCache(options, fetcher)
    await readThroughPublicCache(options, fetcher)

    expect(fetches).toBe(1)
    expect(cache.writes).toBe(1)
  })

  it.each(["draft", "review", "archived"])("не записывает статью со статусом %s", async (status) => {
    const cache = new MemoryCache()

    await readThroughPublicCache(
      {
        cache,
        key: buildCacheKey("query.article", { slug: status }),
        tags: [`article:${status}`],
        ttlSeconds: 3600,
        cacheWhen: (article: { status: string }) => article.status === "published"
      },
      async () => ({ slug: status, status })
    )

    expect(cache.writes).toBe(0)
  })
})

describe("private resolver cache policy", () => {
  it("me возвращает пользователя без обращения к общему кешу", async () => {
    const currentUser = { id: "u1", role: "reader" }
    const cache = new Proxy(
      {},
      {
        get: () => {
          throw new Error("private resolver touched cache")
        }
      }
    ) as Cache

    const result = await userResolver.Query.me({}, {}, { currentUser, cache } as never)

    expect(result).toBe(currentUser)
  })
})

describe("domain cache tags", () => {
  it("объединяет старое и новое состояние статьи без дублей", () => {
    const tags = buildArticleCacheTags(
      {
        slug: "old-slug",
        author: { slug: "old-author" },
        contentType: { slug: "essay" },
        sectionTags: [{ slug: "art" }, { slug: "music" }]
      },
      {
        slug: "new-slug",
        author: { slug: "new-author" },
        contentType: { slug: "essay" },
        sectionTags: [{ slug: "music" }, { slug: "travel" }]
      }
    )

    expect(tags).toEqual([
      "article:new-slug",
      "article:old-slug",
      "author:new-author",
      "author:old-author",
      "content-type:essay",
      "home",
      "section-tag:art",
      "section-tag:music",
      "section-tag:travel"
    ])
  })

  it("updateArticle инвалидирует теги старого и нового состояния одним вызовом", async () => {
    const cache = new MemoryCache()
    const previous = {
      id: "a1",
      slug: "old-slug",
      authorId: "u1",
      author: { slug: "old-author" },
      contentType: { slug: "essay" },
      sectionTags: [{ slug: "art" }]
    }
    const updated = {
      ...previous,
      slug: "new-slug",
      author: { slug: "new-author" },
      sectionTags: [{ slug: "travel" }]
    }
    const prisma = {
      article: {
        findUnique: async () => previous,
        update: async () => updated
      }
    }

    await articleResolver.Mutation.updateArticle({}, { id: "a1", input: { slug: "new-slug" } }, {
      currentUser: { id: "u1", role: "author" },
      prisma,
      cache
    } as never)

    expect(cache.invalidations).toEqual([
      [
        "article:new-slug",
        "article:old-slug",
        "author:new-author",
        "author:old-author",
        "content-type:essay",
        "home",
        "section-tag:art",
        "section-tag:travel"
      ]
    ])
  })
})
