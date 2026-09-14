import type { Cache } from "./types"

interface ReadThroughOptions<T> {
  cache: Cache
  key: string
  tags: readonly string[]
  ttlSeconds: number
  cacheWhen?: (value: T) => boolean
}

export const readThroughPublicCache = async <T>(
  options: ReadThroughOptions<T>,
  fetcher: () => Promise<T>
): Promise<T> => {
  const cached = await options.cache.get<T>(options.key)
  if (cached !== null) return cached

  const value = await fetcher()
  if (!options.cacheWhen || options.cacheWhen(value)) {
    await options.cache.set(options.key, value, {
      ttlSeconds: options.ttlSeconds,
      tags: options.tags
    })
  }

  return value
}
