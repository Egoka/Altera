export type CacheMode = "redis" | "noop"

export interface CacheSetOptions {
  ttlSeconds: number
  tags: readonly string[]
}

export interface Cache {
  readonly mode: CacheMode
  isReady(): Promise<boolean>
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, options: CacheSetOptions): Promise<void>
  del(key: string): Promise<void>
  delByTags(tags: readonly string[]): Promise<void>
  close(): Promise<void>
}
