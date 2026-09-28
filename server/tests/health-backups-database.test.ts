import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { PrismaClient } from "../src/generated/prisma"
import { createBackupMonitor, type BackupRunsClient } from "../src/health"
import { applyBaselineMigrations, applyMigration } from "./helpers/migration-database"

// T-088: возраст последней успешной резервной копии читается группировкой по виду и состоянию
// (`src/health/backups.ts`). Группировка и перечисления живут в PostgreSQL, поэтому миграция и
// запрос проверяются на настоящей базе, а не на двойнике клиента.

const testDatabaseUrl = process.env.T088_TEST_DATABASE_URL
const targetMigration = "20260928170000_backup_runs"

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (run: (url: string) => Promise<void>): Promise<void> => {
  const name = `t088_${randomUUID().replaceAll("-", "")}`
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

const NOW = new Date("2026-09-28T12:00:00.000Z")
const hoursAgo = (hours: number): Date => new Date(NOW.getTime() - hours * 60 * 60 * 1000)

describe.skipIf(!testDatabaseUrl)("T-088 отметки резервного копирования на PostgreSQL", () => {
  it("миграция создаёт таблицу, а монитор читает возраст последней успешной копии", async () => {
    await withDatabase(async (url) => {
      applyBaselineMigrations(targetMigration, url)
      const applied = applyMigration(targetMigration, url)
      expect(applied.status, [applied.stdout, applied.stderr].join("\n")).toBe(0)

      const prisma = prismaFor(url)
      try {
        await prisma.backupRun.createMany({
          data: [
            // Последний прогон базы — отказ: он не считается копией.
            { kind: "database", status: "failed", completedAt: hoursAgo(1), source: "pg_dump", detail: "timeout" },
            { kind: "database", status: "succeeded", completedAt: hoursAgo(30), source: "pg_dump" },
            { kind: "database", status: "succeeded", completedAt: hoursAgo(54), source: "managed-postgres" },
            { kind: "media", status: "succeeded", completedAt: hoursAgo(20), source: "bucket-sync" }
          ]
        })

        const monitor = createBackupMonitor({
          client: prisma as unknown as BackupRunsClient,
          now: () => NOW
        })
        const backups = await monitor()

        expect(backups.database).toEqual({
          status: "overdue",
          lastSuccessAt: hoursAgo(30).toISOString(),
          ageSeconds: 108_000,
          maxAgeSeconds: 86_400
        })
        expect(backups.media).toEqual({
          status: "ok",
          lastSuccessAt: hoursAgo(20).toISOString(),
          ageSeconds: 72_000,
          maxAgeSeconds: 604_800
        })
      } finally {
        await prisma.$disconnect()
      }
    })
  }, 120_000)

  it("пустая таблица не даёт подтверждения копий", async () => {
    await withDatabase(async (url) => {
      applyBaselineMigrations(targetMigration, url)
      expect(applyMigration(targetMigration, url).status).toBe(0)

      const prisma = prismaFor(url)
      try {
        const monitor = createBackupMonitor({
          client: prisma as unknown as BackupRunsClient,
          required: true,
          now: () => NOW
        })
        const backups = await monitor()
        expect(backups.database.status).toBe("unknown")
        expect(backups.media.status).toBe("unknown")
      } finally {
        await prisma.$disconnect()
      }
    })
  }, 120_000)
})
