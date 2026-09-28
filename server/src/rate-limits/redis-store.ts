import Redis from "ioredis"
import type { RateLimitCounterStore, RateLimitWindow } from "./counter-store"

/**
 * Счётчики в Redis — основной режим при заданном `REDIS_URL` (`rate-limits.md` §2 п. 13).
 * Ключи объявлены здесь целиком и версионированы: инкремент и TTL относятся к паре
 * «корзина + обезличенный ключ», кеш эти ключи не трогает.
 */
export const RATE_LIMIT_KEY_VERSION = "v1"

export const rateLimitRedisKey = (bucket: string, key: string): string =>
  `ratelimit:${RATE_LIMIT_KEY_VERSION}:${bucket}:${key}`

export interface RateLimitRedisClient {
  on(event: "error", listener: (error: unknown) => void): unknown
  eval(script: string, keyCount: number, ...args: string[]): Promise<unknown>
  quit(): Promise<unknown>
}

/**
 * Инкремент и срок жизни выставляются одним скриптом: TTL ставится только на первом попадании,
 * поэтому окно считается от него, а не продлевается каждым следующим запросом. `PTTL < 0`
 * означает ключ без срока — такой ключ пережил бы окно, поэтому срок восстанавливается.
 *
 * Стоимость обращения — второй аргумент: документ с алиасами расходует её целиком за один
 * `INCRBY`. Счёт, равный стоимости, означает новый ключ, то есть начало окна.
 */
const CONSUME_LUA = `
-- rate-limit-consume
local cost = tonumber(ARGV[2])
local hits = redis.call("INCRBY", KEYS[1], cost)
local ttl = redis.call("PTTL", KEYS[1])
if hits <= cost or ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {hits, ttl}
`

/** Чтение без расхода: счёт и остаток окна одним обращением, ключ не создаётся. */
const PEEK_LUA = `
-- rate-limit-peek
local hits = redis.call("GET", KEYS[1])
if not hits then
  return {0, -2}
end
return {tonumber(hits), redis.call("PTTL", KEYS[1])}
`

const RESET_LUA = `
-- rate-limit-reset
return redis.call("DEL", KEYS[1])
`

class IoredisRateLimitClient implements RateLimitRedisClient {
  private readonly client: Redis

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 })
  }

  on(event: "error", listener: (error: unknown) => void): unknown {
    return this.client.on(event, listener)
  }

  eval(script: string, keyCount: number, ...args: string[]): Promise<unknown> {
    return this.client.eval(script, keyCount, ...args)
  }

  quit(): Promise<unknown> {
    return this.client.quit()
  }
}

export class RedisRateLimitStore implements RateLimitCounterStore {
  readonly mode = "redis" as const

  constructor(
    private readonly client: RateLimitRedisClient,
    /**
     * Недоступный Redis не снимает лимит: счёт продолжается в таблице. Открывать защиту при
     * сбое кеша было бы худшим исходом — перебор адресов входа как раз и идёт в момент
     * нагрузки (`rate-limits.md` §1).
     */
    private readonly fallback: RateLimitCounterStore,
    private readonly warn: (message: string) => void = () => undefined
  ) {
    this.client.on("error", () => this.warn("Redis rate limit connection error"))
  }

  async consume(bucket: string, key: string, windowSeconds: number, now: Date, cost = 1): Promise<RateLimitWindow> {
    const hits = Math.max(1, Math.floor(cost))
    try {
      const result = await this.client.eval(
        CONSUME_LUA,
        1,
        rateLimitRedisKey(bucket, key),
        String(windowSeconds * 1000),
        String(hits)
      )
      const [total, ttlMs] = result as [number, number]
      if (typeof total !== "number" || typeof ttlMs !== "number") {
        throw new Error("Unexpected rate limit script result")
      }

      return { hits: total, resetAt: new Date(now.getTime() + Math.max(0, ttlMs)) }
    } catch {
      this.warn("Redis rate limit counter failed")
      return this.fallback.consume(bucket, key, windowSeconds, now, hits)
    }
  }

  async peek(bucket: string, key: string, now: Date): Promise<RateLimitWindow | null> {
    try {
      const result = await this.client.eval(PEEK_LUA, 1, rateLimitRedisKey(bucket, key))
      const [hits, ttlMs] = result as [number, number]
      if (typeof hits !== "number" || typeof ttlMs !== "number") throw new Error("Unexpected rate limit script result")
      if (hits === 0 || ttlMs < 0) return null

      return { hits, resetAt: new Date(now.getTime() + ttlMs) }
    } catch {
      this.warn("Redis rate limit peek failed")
      return this.fallback.peek(bucket, key, now)
    }
  }

  /**
   * Счёт снимается в обоих хранилищах: во время сбоя Redis попадания уходили в таблицу, и
   * очистка только кеша оставила бы успешному входу чужое окно из запасного счётчика.
   */
  async reset(bucket: string, key: string): Promise<void> {
    try {
      await this.client.eval(RESET_LUA, 1, rateLimitRedisKey(bucket, key))
    } catch {
      this.warn("Redis rate limit reset failed")
    }
    await this.fallback.reset(bucket, key)
  }

  async close(): Promise<void> {
    try {
      await this.client.quit()
    } catch {
      this.warn("Redis rate limit close failed")
    }
  }
}

export const createRedisRateLimitStore = (
  redisUrl: string,
  fallback: RateLimitCounterStore,
  warn?: (message: string) => void
): RedisRateLimitStore => new RedisRateLimitStore(new IoredisRateLimitClient(redisUrl), fallback, warn)
