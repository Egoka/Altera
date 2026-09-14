import { describe, expect, it } from "vitest"
import type { Cache, CacheSetOptions } from "../src/cache"
import { buildCacheKey } from "../src/cache"
import { readThroughPublicCache } from "../src/cache/read-through"
import userResolver from "../src/graphql/user/resolver"

class MemoryCache implements Cache {
  readonly mode = "noop" as const
  readonly values = new Map<string, unknown>()
  writes = 0

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
    void tags
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
