import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readdirSync } from "node:fs"
import path from "node:path"
import { PrismaClient } from "../src/generated/prisma"
import { describe, expect, it } from "vitest"

const testDatabaseUrl = process.env.T018_TEST_DATABASE_URL
const serverRoot = path.resolve(__dirname, "..")
const migrationsRoot = path.join(serverRoot, "prisma/migrations")
const targetMigration = "20260916210000_audit_review_thread"

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient =>
  new PrismaClient({
    datasources: { db: { url } }
  })

const runPrisma = (args: string[], url: string): void => {
  execFileSync("pnpm", ["exec", "prisma", ...args, "--schema", path.join(serverRoot, "prisma/schema.prisma")], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
    stdio: "pipe"
  })
}

const applyBaselineMigrations = (url: string): void => {
  const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < targetMigration)
    .map((entry) => entry.name)
    .sort()

  for (const migration of migrations) {
    runPrisma(["db", "execute", "--file", path.join(migrationsRoot, migration, "migration.sql")], url)
  }
}

const applyTargetMigration = (url: string) =>
  spawnSync(
    "pnpm",
    [
      "exec",
      "prisma",
      "db",
      "execute",
      "--file",
      path.join(migrationsRoot, targetMigration, "migration.sql"),
      "--schema",
      path.join(serverRoot, "prisma/schema.prisma")
    ],
    {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
      encoding: "utf8"
    }
  )

const withDatabase = async (prefix: string, run: (url: string) => Promise<void>): Promise<void> => {
  const name = `${prefix}_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    await run(url)
  } finally {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`
    )
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`)
    await admin.$disconnect()
  }
}

const applyMigration = async (url: string): Promise<PrismaClient> => {
  applyBaselineMigrations(url)
  const migration = applyTargetMigration(url)
  expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)
  return prismaFor(url)
}

describe.skipIf(!testDatabaseUrl)("T-018 audit and review thread migration on PostgreSQL", () => {
  it("AC-1: UPDATE and DELETE on audit_logs are rejected by DB trigger", async () => {
    await withDatabase("t018_immutable", async (url) => {
      const prisma = await applyMigration(url)
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "audit_logs" ("id", "action", "entityType", "entityId")
          VALUES ('audit-1', 'admin.change', 'user', 'user-1')
        `)

        await expect(
          prisma.$executeRawUnsafe(`UPDATE "audit_logs" SET "action" = 'tampered' WHERE "id" = 'audit-1'`)
        ).rejects.toThrow()

        await expect(prisma.$executeRawUnsafe(`DELETE FROM "audit_logs" WHERE "id" = 'audit-1'`)).rejects.toThrow()

        const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT "id" FROM "audit_logs" WHERE "id" = 'audit-1'`
        )
        expect(rows).toHaveLength(1)
      } finally {
        await prisma.$disconnect()
      }
    })
  }, 30_000)

  it("AC-2: review_notes has revisionId and blockId columns", async () => {
    await withDatabase("t018_schema", async (url) => {
      const prisma = await applyMigration(url)
      try {
        const columns = await prisma.$queryRawUnsafe<Array<{ columnName: string }>>(`
          SELECT column_name AS "columnName"
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'review_notes'
          ORDER BY ordinal_position
        `)
        const names = columns.map(({ columnName }) => columnName)
        expect(names).toContain("revisionId")
        expect(names).toContain("blockId")
      } finally {
        await prisma.$disconnect()
      }
    })
  }, 30_000)

  it("creates audit_logs, review_messages, and review_notes tables", async () => {
    await withDatabase("t018_tables", async (url) => {
      const prisma = await applyMigration(url)
      try {
        const tables = await prisma.$queryRawUnsafe<Array<{ tableName: string }>>(`
          SELECT table_name AS "tableName"
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('audit_logs', 'review_messages', 'review_notes')
          ORDER BY table_name
        `)
        expect(tables.map(({ tableName }) => tableName)).toEqual(["audit_logs", "review_messages", "review_notes"])
      } finally {
        await prisma.$disconnect()
      }
    })
  }, 30_000)
})
