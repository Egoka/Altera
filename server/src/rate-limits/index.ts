import { randomUUID } from "node:crypto"
import type { AppLogger } from "../observability/logger"
import type { RateLimitCounterStore } from "./counter-store"
import { DatabaseRateLimitStore, type RateLimitDatabaseClient } from "./database-store"
import { createRedisRateLimitStore } from "./redis-store"

export { resolveRateLimitAddress, UNVERIFIED_ADDRESS_KEY, type RateLimitAddress } from "./client-address"
export {
  retryAfterSeconds,
  type RateLimitCounterStore,
  type RateLimitStoreMode,
  type RateLimitWindow
} from "./counter-store"
export { DatabaseRateLimitStore, type RateLimitDatabaseClient } from "./database-store"
export { createRateLimiter, type RateLimitContext, type RateLimitDecision, type RateLimiter } from "./limiter"
export { createRateLimitPlugin, rootFieldNames, type QueryDocument } from "./plugin"
export {
  middlewareRulesForField,
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_RULES,
  type RateLimitBucket,
  type RateLimitKeyKind,
  type RateLimitRule
} from "./policy"
export { rateLimitRedisKey, RATE_LIMIT_KEY_VERSION } from "./redis-store"

/**
 * Хранилище счётчиков по конфигурации процесса: Redis при заданном `REDIS_URL`, иначе таблица
 * (`rate-limits.md` §2 п. 13, ADR-0019). Таблица остаётся запасной и для режима Redis: сбой
 * кеша лимит не снимает.
 */
export const createRateLimitStore = (options: {
  redisUrl?: string
  client: RateLimitDatabaseClient
  warn?: (message: string) => void
}): RateLimitCounterStore => {
  const database = new DatabaseRateLimitStore(options.client)
  if (options.redisUrl?.trim()) return createRedisRateLimitStore(options.redisUrl, database, options.warn)

  return database
}

const PRUNE_INTERVAL_MS = 10 * 60_000

/**
 * Закрытые окна удаляются по расписанию. На счёт лимита очистка не влияет — истёкшее окно
 * начинается заново тем же выражением, — она только не даёт таблице расти без границы.
 */
export function startRateLimitCounterPrune(
  client: RateLimitDatabaseClient,
  logger: AppLogger,
  intervalMs = PRUNE_INTERVAL_MS
): NodeJS.Timeout {
  const store = new DatabaseRateLimitStore(client)
  const run = async () => {
    const requestId = `rate-limit-prune:${randomUUID()}`
    try {
      await store.pruneExpired(new Date())
    } catch (error) {
      logger.log({
        level: "error",
        event: "error.unhandled",
        requestId,
        message: "Rate limit counter prune failed",
        error
      })
    }
  }
  void run()
  const timer = setInterval(() => void run(), intervalMs)
  timer.unref()
  return timer
}
