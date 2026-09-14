import { NoopCache } from "./noop"
import { createRedisCache } from "./redis"
import type { Cache } from "./types"

export { buildCacheKey } from "./key"
export type { Cache, CacheMode, CacheSetOptions } from "./types"

export const CACHE_TTL_SECONDS = {
  publicList: 300,
  article: 3600,
  popular: 600,
  max: 3600
} as const

export const createCache = (options: { redisUrl?: string }): Cache => {
  if (options.redisUrl?.trim()) {
    return createRedisCache(options.redisUrl, CACHE_TTL_SECONDS.max)
  }

  return new NoopCache()
}
