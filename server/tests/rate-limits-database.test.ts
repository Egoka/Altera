import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { PrismaClient } from "../src/generated/prisma"
import { DatabaseRateLimitStore, type RateLimitDatabaseClient } from "../src/rate-limits"
import { applyBaselineMigrations, applyMigration } from "./helpers/migration-database"

/**
 * Режим без Redis: счётчики живут в таблице (`rate-limits.md` §2 п. 13, ADR-0019). Проверяется
 * на настоящем PostgreSQL, потому что вся правильность счёта держится на `ON CONFLICT DO UPDATE`
 * — двойник её не докажет. Запускается при заданном `T024_TEST_DATABASE_URL`.
 */
const testDatabaseUrl = process.env.T024_TEST_DATABASE_URL
const targetMigration = "20260921090000_rate_limit_counters"

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (run: (database: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `t024_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    applyBaselineMigrations(targetMigration, url)
    const migration = applyMigration(targetMigration, url)
    expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)
    const database = prismaFor(url)
    try {
      await run(database)
    } finally {
      await database.$disconnect()
    }
  } finally {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`
    )
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`)
    await admin.$disconnect()
  }
}

const HOUR = 3600

describe.skipIf(!testDatabaseUrl)("T-024 счётчики лимитов в таблице", () => {
  it("считает окно, не теряет параллельные попадания и чистит закрытые окна", async () => {
    await withDatabase(async (database) => {
      const store = new DatabaseRateLimitStore(database as unknown as RateLimitDatabaseClient)
      const now = new Date("2026-09-21T10:00:00.000Z")

      const first = await store.consume("auth.link.email", "key-a", HOUR, now)
      expect(first.hits).toBe(1)
      expect(first.resetAt).toEqual(new Date("2026-09-21T11:00:00.000Z"))

      // Параллельные запросы одного ключа: ни один инкремент не теряется.
      const later = new Date("2026-09-21T10:10:00.000Z")
      const parallel = await Promise.all(
        Array.from({ length: 9 }, () => store.consume("auth.link.email", "key-a", HOUR, later))
      )
      expect(parallel.map(({ hits }) => hits).sort((left, right) => left - right)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10])
      // Окно не продлевается следующими попаданиями.
      expect(parallel.every(({ resetAt }) => resetAt.getTime() === first.resetAt.getTime())).toBe(true)

      // Другой ключ — своя корзина.
      expect((await store.consume("auth.link.email", "key-b", HOUR, later)).hits).toBe(1)
      // Другая корзина того же ключа — тоже своя.
      expect((await store.consume("auth.verify.ip", "key-a", HOUR, later)).hits).toBe(1)

      // Истёкшее окно начинается заново тем же выражением, без отдельной очистки.
      const afterWindow = new Date("2026-09-21T11:00:01.000Z")
      const restarted = await store.consume("auth.link.email", "key-a", HOUR, afterWindow)
      expect(restarted.hits).toBe(1)
      expect(restarted.resetAt).toEqual(new Date("2026-09-21T12:00:01.000Z"))

      // Очистка удаляет только закрытые окна.
      const removed = await store.pruneExpired(new Date("2026-09-21T11:30:00.000Z"))
      expect(removed).toBe(2)
      const remaining = await database.$queryRaw<
        { bucket: string; key: string }[]
      >`SELECT "bucket", "key" FROM "rate_limit_counters" ORDER BY "bucket", "key"`
      expect(remaining).toEqual([{ bucket: "auth.link.email", key: "key-a" }])
    })
  })
})
