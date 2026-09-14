import { NoopCache } from "./noop"
import type { Cache } from "./types"

export { buildCacheKey } from "./key"
export type { Cache, CacheMode, CacheSetOptions } from "./types"

export const createCache = (options: { redisUrl?: string }): Cache => {
  if (options.redisUrl?.trim()) {
    throw new Error("Redis cache is not implemented")
  }

  return new NoopCache()
}
