import { createApiError } from "../errors/graphql-error"
import type { AppLogger } from "../observability/logger"
import type { PiiHasher } from "../observability/privacy"
import { retryAfterSeconds, type RateLimitCounterStore, type RateLimitStoreMode } from "./counter-store"
import { RATE_LIMIT_RULES, type RateLimitBucket } from "./policy"

/**
 * Применение единых порогов: `RATE_LIMITED` с `retryAfter` и лог `rate_limit.hit`
 * (`rate-limits.md` §2 п. 1, ADR-0032, реестр событий #44 — поля `bucket` и `ipHash`).
 *
 * Роль вызывающего в подпись не входит: лимит един и не снимается ни для аккаунта, ни для
 * служебной роли, ни для `owner` (журнал #57).
 */
export interface RateLimitContext {
  readonly requestId: string
  /** Адрес для лога попадания; в самом счётчике адрес не хранится в открытом виде. */
  readonly ip?: string | null
}

export interface RateLimitDecision {
  readonly allowed: boolean
  /** Сколько обращений остаётся в текущем окне после учтённого. */
  readonly remaining: number
  /** Секунды до конца окна — значение поля `retryAfter` словаря ошибок. */
  readonly retryAfter: number
}

export interface RateLimiter {
  readonly mode: RateLimitStoreMode
  /**
   * Учитывает обращение и отвечает `RATE_LIMITED`, если порог корзины превышен. Возвращённое
   * решение позволяет вызывающему показать таймер, не повторяя арифметику окна.
   */
  enforce(bucket: RateLimitBucket, keyValue: string, context: RateLimitContext): Promise<RateLimitDecision>
}

interface RateLimiterOptions {
  store: RateLimitCounterStore
  logger: AppLogger
  piiHasher: PiiHasher
  now?: () => Date
}

const dayKey = (now: Date): string => now.toISOString().slice(0, 10)

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? (() => new Date())

  return {
    mode: options.store.mode,

    async enforce(bucket, keyValue, context) {
      const rule = RATE_LIMIT_RULES[bucket]
      // Ключ корзины обезличен: счётчик не хранит ни адрес, ни e-mail (§2 п. 2).
      const key = options.piiHasher.limitKey(`${rule.keyKind}:${keyValue}`)
      const at = now()
      const window = await options.store.consume(bucket, key, rule.windowSeconds, at)
      const retryAfter = retryAfterSeconds(window, at)

      if (window.hits > rule.limit) {
        options.logger.log({
          level: "warn",
          event: "rate_limit.hit",
          requestId: context.requestId,
          message: "Rate limit exceeded",
          data: {
            bucket,
            ipHash: context.ip ? options.piiHasher.ip(context.ip, dayKey(at)) : null
          }
        })
        throw createApiError("RATE_LIMITED", { requestId: context.requestId, retryAfter })
      }

      return { allowed: true, remaining: Math.max(0, rule.limit - window.hits), retryAfter }
    }
  }
}
