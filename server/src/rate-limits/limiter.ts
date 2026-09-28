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
   * Учитывает `cost` обращений (по умолчанию одно) и отвечает `RATE_LIMITED`, если порог корзины
   * превышен. Возвращённое решение позволяет вызывающему показать таймер, не повторяя арифметику
   * окна. Стоимость больше одного расходует документ, назвавший лимитируемое поле несколько раз:
   * превышение отклоняет его целиком.
   */
  enforce(
    bucket: RateLimitBucket,
    keyValue: string,
    context: RateLimitContext,
    cost?: number
  ): Promise<RateLimitDecision>
  /**
   * Отклоняет обращение, если окно корзины уже исчерпано, но само обращение не учитывает.
   * Нужно корзинам неуспешных попыток (RL-14, RL-15): попытка считается только по её исходу,
   * а исход известен после проверки пароля.
   */
  assertWithin(bucket: RateLimitBucket, keyValue: string, context: RateLimitContext): Promise<RateLimitDecision>
  /** Учитывает неуспешную попытку. Сам по себе отказ не бросает: его уже вернул вызывающий. */
  penalize(bucket: RateLimitBucket, keyValue: string, context: RateLimitContext): Promise<RateLimitDecision>
  /** Снимает счёт корзины: успешная проверка пароля очищает окно своего адреса. */
  forget(bucket: RateLimitBucket, keyValue: string): Promise<void>
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
  // Ключ корзины обезличен: счётчик не хранит ни адрес, ни e-mail (§2 п. 2).
  const counterKey = (bucket: RateLimitBucket, keyValue: string): string =>
    options.piiHasher.limitKey(`${RATE_LIMIT_RULES[bucket].keyKind}:${keyValue}`)

  const reject = (bucket: RateLimitBucket, context: RateLimitContext, at: Date, retryAfter: number): never => {
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

  return {
    mode: options.store.mode,

    async enforce(bucket, keyValue, context, cost = 1) {
      const rule = RATE_LIMIT_RULES[bucket]
      const at = now()
      const window = await options.store.consume(
        bucket,
        counterKey(bucket, keyValue),
        rule.windowSeconds,
        at,
        Math.max(1, Math.floor(cost))
      )
      const retryAfter = retryAfterSeconds(window, at)

      if (window.hits > rule.limit) reject(bucket, context, at, retryAfter)

      return { allowed: true, remaining: Math.max(0, rule.limit - window.hits), retryAfter }
    },

    async assertWithin(bucket, keyValue, context) {
      const rule = RATE_LIMIT_RULES[bucket]
      const at = now()
      const window = await options.store.peek(bucket, counterKey(bucket, keyValue), at)
      if (!window) return { allowed: true, remaining: rule.limit, retryAfter: rule.windowSeconds }

      const retryAfter = retryAfterSeconds(window, at)
      // Порог исчерпан именно на `limit` попаданий: `enforce` отклоняет `limit + 1`-е, а здесь
      // уже учтённые попытки — это те самые неуспехи, после которых следующая не даётся.
      if (window.hits >= rule.limit) reject(bucket, context, at, retryAfter)

      return { allowed: true, remaining: Math.max(0, rule.limit - window.hits), retryAfter }
    },

    async penalize(bucket, keyValue, context) {
      const rule = RATE_LIMIT_RULES[bucket]
      const at = now()
      const window = await options.store.consume(bucket, counterKey(bucket, keyValue), rule.windowSeconds, at, 1)
      const retryAfter = retryAfterSeconds(window, at)
      const remaining = Math.max(0, rule.limit - window.hits)

      if (remaining === 0) {
        // Корзина закрылась этим неуспехом: факт попадания в лимит фиксируется здесь, иначе
        // запись появилась бы только на следующей попытке, уже отклонённой.
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
      }

      return { allowed: remaining > 0, remaining, retryAfter }
    },

    async forget(bucket, keyValue) {
      await options.store.reset(bucket, counterKey(bucket, keyValue))
    }
  }
}
