import { Prisma } from "../generated/prisma"
import type { RateLimitCounterStore, RateLimitWindow } from "./counter-store"

/**
 * Счётчики в PostgreSQL — режим без Redis (`rate-limits.md` §2 п. 13, ADR-0019). База уже
 * обязательная зависимость API (`/health` без неё отвечает 503), поэтому этот режим работает
 * всегда и служит также запасным для Redis.
 */
export interface RateLimitDatabaseClient {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>
  $executeRaw(query: Prisma.Sql): Promise<number>
}

interface CounterRow {
  hits: number | bigint
  expiresAt: Date
}

const toNumber = (value: number | bigint): number => (typeof value === "bigint" ? Number(value) : value)

export class DatabaseRateLimitStore implements RateLimitCounterStore {
  readonly mode = "database" as const

  constructor(private readonly client: RateLimitDatabaseClient) {}

  /**
   * Одно выражение: `INSERT ... ON CONFLICT DO UPDATE` считает попадание атомарно, поэтому
   * параллельные запросы одного ключа не теряют инкремент и не соревнуются за чтение перед
   * записью. Истёкшее окно тем же выражением начинается заново — отдельная очистка для
   * правильности счёта не нужна, она только освобождает место (`pruneExpired`).
   */
  async consume(bucket: string, key: string, windowSeconds: number, now: Date): Promise<RateLimitWindow> {
    const expiresAt = new Date(now.getTime() + windowSeconds * 1000)
    const rows = await this.client.$queryRaw<CounterRow[]>(Prisma.sql`
      INSERT INTO "rate_limit_counters" ("bucket", "key", "hits", "expiresAt")
      VALUES (${bucket}, ${key}, 1, ${expiresAt})
      ON CONFLICT ("bucket", "key") DO UPDATE SET
        "hits" = CASE WHEN "rate_limit_counters"."expiresAt" <= ${now} THEN 1 ELSE "rate_limit_counters"."hits" + 1 END,
        "expiresAt" = CASE WHEN "rate_limit_counters"."expiresAt" <= ${now} THEN ${expiresAt} ELSE "rate_limit_counters"."expiresAt" END
      RETURNING "hits", "expiresAt"
    `)

    const row = rows[0]
    if (!row) throw new Error("Rate limit counter did not return a row")

    return { hits: toNumber(row.hits), resetAt: row.expiresAt }
  }

  /** Удаляет закрытые окна. Вызывается по расписанию: на решение о лимите не влияет. */
  async pruneExpired(now: Date): Promise<number> {
    return this.client.$executeRaw(Prisma.sql`DELETE FROM "rate_limit_counters" WHERE "expiresAt" <= ${now}`)
  }
}
