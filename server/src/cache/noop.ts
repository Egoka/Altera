import type { Cache, CacheSetOptions } from "./types"

export class NoopCache implements Cache {
  readonly mode = "noop" as const

  async isReady(): Promise<boolean> {
    return false
  }

  async get<T>(key: string): Promise<T | null> {
    void key
    return null
  }

  async set<T>(key: string, value: T, options: CacheSetOptions): Promise<void> {
    void key
    void value
    void options
  }

  async del(key: string): Promise<void> {
    void key
  }

  async delByTags(tags: readonly string[]): Promise<void> {
    void tags
  }

  async close(): Promise<void> {}
}
