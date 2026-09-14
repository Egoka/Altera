import { describe, expect, it } from "vitest"
import { buildCacheKey, createCache } from "../src/cache"

describe("buildCacheKey", () => {
  it("стабилизирует порядок ключей объектов", () => {
    const first = buildCacheKey("query.latestArticles", {
      pagination: { page: 1, limit: 20 },
      filters: { status: ["published"] }
    })
    const second = buildCacheKey("query.latestArticles", {
      filters: { status: ["published"] },
      pagination: { limit: 20, page: 1 }
    })

    expect(first).toBe(second)
    expect(first).toMatch(/^cache:v1:data:query\.latestArticles:[a-f0-9]{64}$/)
  })

  it("различает изменение вложенного аргумента", () => {
    const first = buildCacheKey("query.latestArticles", { filters: { featured: true } })
    const second = buildCacheKey("query.latestArticles", { filters: { featured: false } })

    expect(first).not.toBe(second)
  })

  it("изолирует два разных поисковых запроса", () => {
    const ivan = buildCacheKey("query.search", {
      pagination: { page: 1, limit: 20 },
      sort: { field: "createdAt", direction: "DESC" },
      filters: {},
      search: { query: "иван", fields: ["name"] }
    })
    const petr = buildCacheKey("query.search", {
      pagination: { page: 1, limit: 20 },
      sort: { field: "createdAt", direction: "DESC" },
      filters: {},
      search: { query: "пётр", fields: ["name"] }
    })

    expect(ivan).not.toBe(petr)
  })

  it("сохраняет порядок массивов", () => {
    expect(buildCacheKey("query.feed", { tags: ["art", "music"] })).not.toBe(
      buildCacheKey("query.feed", { tags: ["music", "art"] })
    )
  })

  it("различает отсутствующее поле, null и undefined", () => {
    const missing = buildCacheKey("query.feed", {})
    const nullValue = buildCacheKey("query.feed", { search: null })
    const undefinedValue = buildCacheKey("query.feed", { search: undefined })

    expect(new Set([missing, nullValue, undefinedValue])).toHaveLength(3)
  })
})

describe("createCache", () => {
  it("возвращает безопасный noop без redis URL", async () => {
    const cache = createCache({})

    expect(cache.mode).toBe("noop")
    await expect(cache.get("missing")).resolves.toBeNull()
    await expect(cache.set("key", { value: true }, { ttlSeconds: 300, tags: ["home"] })).resolves.toBeUndefined()
    await expect(cache.del("key")).resolves.toBeUndefined()
    await expect(cache.delByTags(["home"])).resolves.toBeUndefined()
    await expect(cache.close()).resolves.toBeUndefined()
  })
})
