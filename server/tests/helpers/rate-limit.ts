import {
  createRateLimiter,
  type RateLimitCounterStore,
  type RateLimiter,
  type RateLimitWindow
} from "../../src/rate-limits"
import type { AppLogger } from "../../src/observability/logger"
import type { PiiHasher } from "../../src/observability/privacy"

/**
 * Счётчики в памяти одного процесса — двойник для тестов. Семантика та же, что у Redis и
 * таблицы: окно фиксированное и начинается с первого попадания в корзину.
 */
export function createMemoryRateLimitStore(): RateLimitCounterStore {
  const windows = new Map<string, { hits: number; resetAt: Date }>()

  return {
    mode: "database",
    async consume(bucket, key, windowSeconds, now, cost = 1): Promise<RateLimitWindow> {
      const id = `${bucket}\u0000${key}`
      const hits = Math.max(1, Math.floor(cost))
      const current = windows.get(id)
      if (!current || current.resetAt.getTime() <= now.getTime()) {
        const fresh = { hits, resetAt: new Date(now.getTime() + windowSeconds * 1000) }
        windows.set(id, fresh)
        return { hits: fresh.hits, resetAt: fresh.resetAt }
      }

      current.hits += hits
      return { hits: current.hits, resetAt: current.resetAt }
    },

    async peek(bucket, key, now): Promise<RateLimitWindow | null> {
      const current = windows.get(`${bucket}\u0000${key}`)
      if (!current || current.resetAt.getTime() <= now.getTime()) return null

      return { hits: current.hits, resetAt: current.resetAt }
    },

    async reset(bucket, key): Promise<void> {
      windows.delete(`${bucket}\u0000${key}`)
    }
  }
}

const testPiiHasher: PiiHasher = {
  email: (value) => `email(${value})`,
  ip: (value, day) => `ip(${day}:${value})`,
  limitKey: (value) => `limit(${value})`
}

export function createTestRateLimiter(
  options: { logger?: AppLogger; piiHasher?: PiiHasher; store?: RateLimitCounterStore; now?: () => Date } = {}
): RateLimiter {
  return createRateLimiter({
    store: options.store ?? createMemoryRateLimitStore(),
    logger: options.logger ?? { log: () => undefined },
    piiHasher: options.piiHasher ?? testPiiHasher,
    now: options.now
  })
}
