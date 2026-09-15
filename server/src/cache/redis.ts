import crypto from "crypto"
import Redis from "ioredis"
import { CACHE_KEY_VERSION } from "./key"
import type { Cache, CacheSetOptions } from "./types"

export interface CacheRedisTransaction {
  set(key: string, value: string, mode: "EX", ttlSeconds: number): this
  sadd(key: string, ...members: string[]): this
  expire(key: string, ttlSeconds: number): this
  exec(): Promise<unknown>
}

export interface CacheRedisClient {
  on(event: "error", listener: (error: unknown) => void): this
  ping(): Promise<string>
  get(key: string): Promise<string | null>
  multi(): CacheRedisTransaction
  eval(script: string, keyCount: number, ...args: string[]): Promise<unknown>
  quit(): Promise<unknown>
}

const DELETE_DATA_KEY_LUA = `
-- delete-data-key
local reverse_key = KEYS[1]
local data_key = ARGV[1]
local tag_keys = redis.call("SMEMBERS", reverse_key)
for _, tag_key in ipairs(tag_keys) do
  redis.call("SREM", tag_key, data_key)
end
redis.call("DEL", data_key, reverse_key)
return 1
`

const DELETE_BY_TAGS_LUA = `
-- delete-by-tags
local data_keys = {}
for _, tag_key in ipairs(KEYS) do
  local members = redis.call("SMEMBERS", tag_key)
  for _, data_key in ipairs(members) do
    data_keys[data_key] = true
  end
end
for data_key, _ in pairs(data_keys) do
  local digest = string.match(data_key, "([0-9a-f]+)$")
  local reverse_key = "cache:${CACHE_KEY_VERSION}:key-tags:" .. digest
  local related_tags = redis.call("SMEMBERS", reverse_key)
  for _, related_tag in ipairs(related_tags) do
    redis.call("SREM", related_tag, data_key)
  end
  redis.call("DEL", data_key, reverse_key)
end
if #KEYS > 0 then
  redis.call("DEL", unpack(KEYS))
end
return 1
`

const digest = (value: string): string => crypto.createHash("sha256").update(value).digest("hex")
const tagKey = (tag: string): string => `cache:${CACHE_KEY_VERSION}:tag:${digest(tag)}`

const reverseKey = (dataKey: string): string => {
  const keyDigest = dataKey.slice(dataKey.lastIndexOf(":") + 1)
  return `cache:${CACHE_KEY_VERSION}:key-tags:${keyDigest}`
}

class IoredisCacheClient implements CacheRedisClient {
  private readonly client: Redis

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1
    })
  }

  on(event: "error", listener: (error: unknown) => void): this {
    this.client.on(event, listener)
    return this
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key)
  }

  ping(): Promise<string> {
    return this.client.ping()
  }

  multi(): CacheRedisTransaction {
    return this.client.multi()
  }

  eval(script: string, keyCount: number, ...args: string[]): Promise<unknown> {
    return this.client.eval(script, keyCount, ...args)
  }

  quit(): Promise<unknown> {
    return this.client.quit()
  }
}

export class RedisCache implements Cache {
  readonly mode = "redis" as const

  constructor(
    private readonly client: CacheRedisClient,
    private readonly maxCacheTtlSeconds: number,
    private readonly warn: (message: string) => void = () => undefined
  ) {
    this.client.on("error", () => this.warn("Redis cache connection error"))
  }

  async isReady(): Promise<boolean> {
    try {
      return (await this.client.ping()) === "PONG"
    } catch {
      return false
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.client.get(key)
      return cached === null ? null : (JSON.parse(cached) as T)
    } catch {
      this.warn("Redis cache read failed")
      return null
    }
  }

  async set<T>(key: string, value: T, options: CacheSetOptions): Promise<void> {
    try {
      const tagKeys = [...new Set(options.tags)].map(tagKey)
      const transaction = this.client.multi().set(key, JSON.stringify(value), "EX", options.ttlSeconds)

      for (const currentTagKey of tagKeys) {
        transaction.sadd(currentTagKey, key).expire(currentTagKey, this.maxCacheTtlSeconds)
      }

      if (tagKeys.length > 0) {
        transaction.sadd(reverseKey(key), ...tagKeys).expire(reverseKey(key), options.ttlSeconds)
      }

      await transaction.exec()
    } catch {
      this.warn("Redis cache write failed")
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.eval(DELETE_DATA_KEY_LUA, 1, reverseKey(key), key)
    } catch {
      this.warn("Redis cache delete failed")
    }
  }

  async delByTags(tags: readonly string[]): Promise<void> {
    if (tags.length === 0) return

    try {
      const tagKeys = [...new Set(tags)].map(tagKey)
      await this.client.eval(DELETE_BY_TAGS_LUA, tagKeys.length, ...tagKeys)
    } catch {
      this.warn("Redis cache tag invalidation failed")
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.quit()
    } catch {
      this.warn("Redis cache close failed")
    }
  }
}

export const createRedisCache = (redisUrl: string, maxCacheTtlSeconds: number): Cache =>
  new RedisCache(new IoredisCacheClient(redisUrl), maxCacheTtlSeconds)
