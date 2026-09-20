/**
 * Счётчики корзин. `rate-limits.md` §2 п. 13: счётчики живут в Redis при его наличии, иначе —
 * в таблице с TTL (ADR-0019: Redis необязателен).
 *
 * Окно фиксированное и начинается с первого попадания в корзину, а не по часам сервера: иначе
 * «5 в час» и «1 в сутки» обходились бы двумя запросами по обе стороны границы часа или суток.
 */

export type RateLimitStoreMode = "redis" | "database"

export interface RateLimitWindow {
  /** Число попаданий в корзину внутри текущего окна, включая текущее. */
  readonly hits: number
  /** Когда окно закончится: из него считается `retryAfter`. */
  readonly resetAt: Date
}

export interface RateLimitCounterStore {
  readonly mode: RateLimitStoreMode
  /** Учитывает одно обращение и возвращает состояние окна. Ключ уже обезличен вызывающим. */
  consume(bucket: string, key: string, windowSeconds: number, now: Date): Promise<RateLimitWindow>
}

/** Секунды до конца окна, не меньше одной: `retryAfter` словаря ошибок — целое и положительное. */
export function retryAfterSeconds(window: RateLimitWindow, now: Date): number {
  return Math.max(1, Math.ceil((window.resetAt.getTime() - now.getTime()) / 1000))
}
