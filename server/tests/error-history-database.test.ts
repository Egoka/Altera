import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { PrismaClient } from "../src/generated/prisma"
import {
  createErrorCollector,
  createNoopErrorCollectorAdapter,
  createPrismaErrorHistory,
  type ErrorHistoryClient
} from "../src/error-collector"
import { applyBaselineMigrations, applyMigration } from "./helpers/migration-database"

/**
 * T-089: история `backend.error` на PostgreSQL — группировка `groupBy` по сигнатуре и запрет
 * правки записи триггером (`80-observability/error-collector.md` §2 п. 2–3).
 */

const testDatabaseUrl = process.env.T089_TEST_DATABASE_URL
const targetMigration = "20260921180000_backend_error_events"
const REQUEST_ID = "5f0c2a4e-8b1d-4c3e-9a7f-1b2c3d4e5f60"

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (run: (url: string) => Promise<void>): Promise<void> => {
  const name = `t089_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    await run(databaseUrl(name))
  } finally {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`
    )
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`)
    await admin.$disconnect()
  }
}

describe.skipIf(!testDatabaseUrl)("T-089 backend error history on PostgreSQL 17", () => {
  it("groups occurrences by signature and forbids editing a record", async () => {
    await withDatabase(async (url) => {
      applyBaselineMigrations(targetMigration, url)
      const migration = applyMigration(targetMigration, url)
      expect(migration.status, migration.stderr).toBe(0)

      const database = prismaFor(url)
      try {
        const history = createPrismaErrorHistory(database as unknown as ErrorHistoryClient)
        let clock = new Date("2026-09-21T10:00:00.000Z")
        const collector = createErrorCollector({
          history,
          adapter: createNoopErrorCollectorAdapter(),
          logger: {
            log: (entry) => {
              throw new Error(`unexpected log ${entry.message}`)
            }
          },
          now: () => clock
        })

        await collector.capturePageError({ route: "/feed", code: "500", requestId: REQUEST_ID })
        clock = new Date("2026-09-21T10:05:00.000Z")
        await collector.capturePageError({ route: "/feed", code: "500" })
        await collector.capture({
          event: "error.unhandled",
          service: "api",
          code: "INTERNAL_ERROR",
          route: "graphql:feed",
          requestId: REQUEST_ID,
          error: new Error("boom")
        })

        const since = new Date("2026-09-21T00:00:00.000Z")
        const until = new Date("2026-09-22T00:00:00.000Z")
        const pageGroups = await history.listGroups({ stream: "page", since, until })
        expect(pageGroups).toEqual([
          expect.objectContaining({
            stream: "page",
            service: "web",
            code: "500",
            route: "/feed",
            occurrences: 2,
            firstSeenAt: new Date("2026-09-21T10:00:00.000Z"),
            lastSeenAt: new Date("2026-09-21T10:05:00.000Z")
          })
        ])
        expect(await history.listGroups({ since, until })).toHaveLength(2)
        expect(await history.listGroups({ since: until, until: new Date("2026-09-23T00:00:00.000Z") })).toEqual([])

        await expect(database.$executeRawUnsafe(`UPDATE "backend_error_events" SET "code" = 'edited'`)).rejects.toThrow(
          /immutable/
        )
        const stored = await database.$queryRawUnsafe<{ code: string }[]>(
          `SELECT DISTINCT "code" FROM "backend_error_events" ORDER BY "code"`
        )
        expect(stored.map((row) => row.code)).toEqual(["500", "INTERNAL_ERROR"])
      } finally {
        await database.$disconnect()
      }
    })
  })
})
