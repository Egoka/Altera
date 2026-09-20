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
 */
const CONSUME_LUA = `
-- rate-limit-consume
local hits = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if hits == 1 or ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {hits, ttl}
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

  async consume(bucket: string, key: string, windowSeconds: number, now: Date): Promise<RateLimitWindow> {
    try {
      const result = await this.client.eval(
        CONSUME_LUA,
        1,
        rateLimitRedisKey(bucket, key),
        String(windowSeconds * 1000)
      )
      const [hits, ttlMs] = result as [number, number]
      if (typeof hits !== "number" || typeof ttlMs !== "number") {
        throw new Error("Unexpected rate limit script result")
      }

      return { hits, resetAt: new Date(now.getTime() + Math.max(0, ttlMs)) }
    } catch {
      this.warn("Redis rate limit counter failed")
      return this.fallback.consume(bucket, key, windowSeconds, now)
    }
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
