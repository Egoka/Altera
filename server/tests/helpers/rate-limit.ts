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
    async consume(bucket, key, windowSeconds, now): Promise<RateLimitWindow> {
      const id = `${bucket}\u0000${key}`
      const current = windows.get(id)
      if (!current || current.resetAt.getTime() <= now.getTime()) {
        const fresh = { hits: 1, resetAt: new Date(now.getTime() + windowSeconds * 1000) }
        windows.set(id, fresh)
        return { hits: fresh.hits, resetAt: fresh.resetAt }
      }

      current.hits += 1
      return { hits: current.hits, resetAt: current.resetAt }
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
