import type { YogaInitialContext } from "graphql-yoga"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildCacheKey, createCache } from "../src/cache"
import { RedisCache, type CacheRedisClient, type CacheRedisTransaction } from "../src/cache/redis"

class FakeRedisTransaction implements CacheRedisTransaction {
  private readonly operations: Array<() => void> = []

  constructor(private readonly client: FakeRedisClient) {}

  set(key: string, value: string, mode: "EX", ttlSeconds: number): this {
    this.operations.push(() => this.client.writeValue(key, value, mode, ttlSeconds))
    return this
  }

  sadd(key: string, ...members: string[]): this {
    this.operations.push(() => this.client.addMembers(key, members))
    return this
  }

  expire(key: string, ttlSeconds: number): this {
    this.operations.push(() => this.client.writeTtl(key, ttlSeconds))
    return this
  }

  async exec(): Promise<unknown> {
    this.operations.forEach((operation) => operation())
    return []
  }
}

class FakeRedisClient implements CacheRedisClient {
  readonly values = new Map<string, string>()
  readonly sets = new Map<string, Set<string>>()
  readonly ttls = new Map<string, number>()
  fail = false
  closed = false

  on(event: "error", listener: (error: unknown) => void): this {
    void event
    void listener
    return this
  }

  async get(key: string): Promise<string | null> {
    if (this.fail) throw new Error("redis unavailable")
    return this.values.get(key) ?? null
  }

  multi(): CacheRedisTransaction {
    if (this.fail) throw new Error("redis unavailable")
    return new FakeRedisTransaction(this)
  }

  async eval(script: string, keyCount: number, ...args: string[]): Promise<unknown> {
    if (this.fail) throw new Error("redis unavailable")

    const keys = args.slice(0, keyCount)
    const argv = args.slice(keyCount)
    if (script.includes("delete-data-key")) {
      this.deleteDataKey(argv[0], keys[0])
    } else if (script.includes("delete-by-tags")) {
      const dataKeys = new Set(keys.flatMap((key) => [...(this.sets.get(key) ?? [])]))
      dataKeys.forEach((dataKey) => this.deleteDataKey(dataKey, this.reverseKey(dataKey)))
      keys.forEach((key) => this.sets.delete(key))
    } else {
      throw new Error("unknown script")
    }

    return 1
  }

  async quit(): Promise<unknown> {
    this.closed = true
    return "OK"
  }

  writeValue(key: string, value: string, mode: "EX", ttlSeconds: number): void {
    expect(mode).toBe("EX")
    this.values.set(key, value)
    this.ttls.set(key, ttlSeconds)
  }

  addMembers(key: string, members: readonly string[]): void {
    const set = this.sets.get(key) ?? new Set<string>()
    members.forEach((member) => set.add(member))
    this.sets.set(key, set)
  }

  writeTtl(key: string, ttlSeconds: number): void {
    this.ttls.set(key, ttlSeconds)
  }

  private reverseKey(dataKey: string): string {
    return `cache:v3:key-tags:${dataKey.slice(dataKey.lastIndexOf(":") + 1)}`
  }

  private deleteDataKey(dataKey: string, reverseKey: string): void {
    const tagKeys = this.sets.get(reverseKey) ?? new Set<string>()
    tagKeys.forEach((tagKey) => this.sets.get(tagKey)?.delete(dataKey))
    this.values.delete(dataKey)
    this.sets.delete(reverseKey)
  }
}

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
    expect(first).toMatch(/^cache:v3:data:query\.latestArticles:[a-f0-9]{64}$/)
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

describe("GraphQL context cache", () => {
  afterEach(() => {
    vi.resetModules()
  })

  it("импортируется и получает noop cache без REDIS_URL", async () => {
    delete process.env.REDIS_URL
    process.env.JWT_ACCESS_SECRET = "test-access-secret"
    const cache = createCache({})
    const { createContext } = await import("../src/prisma")
    const initialContext = { request: new Request("http://localhost/") } as YogaInitialContext

    const context = await createContext(initialContext, cache)

    expect(context.cache.mode).toBe("noop")
  })
})

describe("RedisCache", () => {
  it("does not read pre-profile-migration article or list payloads", async () => {
    const client = new FakeRedisClient()
    const cache = new RedisCache(client, 3600, () => undefined)
    const legacyAuthor = { id: "user-1", slug: "legacy-author", name: "Reader" }

    for (const [namespace, args] of [
      ["query.article", { slug: "hello" }],
      ["query.latestArticles", { pagination: { page: 1, limit: 20 } }]
    ] as const) {
      const currentKey = buildCacheKey(namespace, args)
      const legacyKey = currentKey.replace("cache:v3:", "cache:v2:")
      client.values.set(legacyKey, JSON.stringify({ author: legacyAuthor }))

      await expect(cache.get(currentKey)).resolves.toBeNull()
    }
  })

  it("записывает значение, tag sets и обратный индекс с ограниченным TTL", async () => {
    const client = new FakeRedisClient()
    const cache = new RedisCache(client, 3600, () => undefined)
    const key = buildCacheKey("query.article", { slug: "hello" })

    await cache.set(key, { id: "a1" }, { ttlSeconds: 300, tags: ["home", "article:hello"] })

    await expect(cache.get<{ id: string }>(key)).resolves.toEqual({ id: "a1" })
    expect([...client.sets.values()].filter((members) => members.has(key))).toHaveLength(2)
    expect([...client.sets.values()].some((members) => members.size === 2 && !members.has(key))).toBe(true)
    expect([...client.ttls.values()]).toContain(300)
    expect([...client.ttls.values()].filter((ttl) => ttl === 3600)).toHaveLength(2)
  })

  it("del удаляет значение и связи со всеми тегами", async () => {
    const client = new FakeRedisClient()
    const cache = new RedisCache(client, 3600, () => undefined)
    const key = buildCacheKey("query.article", { slug: "hello" })
    await cache.set(key, { id: "a1" }, { ttlSeconds: 300, tags: ["home", "article:hello"] })

    await cache.del(key)

    await expect(cache.get(key)).resolves.toBeNull()
    expect([...client.sets.values()].some((members) => members.has(key))).toBe(false)
  })

  it("delByTags удаляет объединение ключей двух тегов", async () => {
    const client = new FakeRedisClient()
    const cache = new RedisCache(client, 3600, () => undefined)
    const first = buildCacheKey("query.article", { slug: "first" })
    const second = buildCacheKey("query.article", { slug: "second" })
    await cache.set(first, { id: "a1" }, { ttlSeconds: 300, tags: ["home", "article:first"] })
    await cache.set(second, { id: "a2" }, { ttlSeconds: 300, tags: ["home", "article:second"] })

    await cache.delByTags(["article:first", "article:second"])

    await expect(cache.get(first)).resolves.toBeNull()
    await expect(cache.get(second)).resolves.toBeNull()
    expect([...client.sets.values()].some((members) => members.has(first) || members.has(second))).toBe(false)
  })

  it("деградирует ошибки Redis в cache miss и best effort", async () => {
    const client = new FakeRedisClient()
    const cache = new RedisCache(client, 3600, () => undefined)
    client.fail = true

    await expect(cache.get("key")).resolves.toBeNull()
    await expect(cache.set("key", { ok: true }, { ttlSeconds: 300, tags: ["home"] })).resolves.toBeUndefined()
    await expect(cache.del("key")).resolves.toBeUndefined()
    await expect(cache.delByTags(["home"])).resolves.toBeUndefined()
  })
})
