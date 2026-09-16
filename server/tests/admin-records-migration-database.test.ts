import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readdirSync } from "node:fs"
import path from "node:path"
import { PrismaClient } from "../src/generated/prisma"
import { describe, expect, it } from "vitest"

const testDatabaseUrl = process.env.T019_TEST_DATABASE_URL
const serverRoot = path.resolve(__dirname, "..")
const migrationsRoot = path.join(serverRoot, "prisma/migrations")
const targetMigration = "20260916120000_admin_operational_records"

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

describe.skipIf(!testDatabaseUrl)("T-019 operational records migration on PostgreSQL", () => {
  it("creates job, AI, mail, backend error, legal text, and consent storage", async () => {
    await withDatabase("t019_schema", async (url) => {
      const prisma = await applyMigration(url)
      try {
        const tables = await prisma.$queryRawUnsafe<Array<{ tableName: string }>>(`
          SELECT table_name AS "tableName"
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN (
              'jobs', 'job_attempts', 'ai_processes', 'ai_cost_aggregates',
              'mail_messages', 'mail_delivery_events', 'backend_errors',
              'backend_error_status_history', 'legal_texts', 'user_legal_consents'
            )
          ORDER BY table_name
        `)

        expect(tables.map(({ tableName }) => tableName)).toEqual([
          "ai_cost_aggregates",
          "ai_processes",
          "backend_error_status_history",
          "backend_errors",
          "job_attempts",
          "jobs",
          "legal_texts",
          "mail_delivery_events",
          "mail_messages",
          "user_legal_consents"
        ])

        await prisma.$executeRawUnsafe(`
          INSERT INTO "jobs" ("id", "kind", "status", "updatedAt")
          VALUES ('job-1', 'mail', 'queued', NOW())
        `)
        await prisma.$executeRawUnsafe(`
          INSERT INTO "job_attempts" ("id", "jobId", "number", "status", "updatedAt")
          VALUES ('attempt-1', 'job-1', 1, 'queued', NOW())
        `)
        await expect(
          prisma.$executeRawUnsafe(`
            INSERT INTO "job_attempts" ("id", "jobId", "number", "status", "updatedAt")
            VALUES ('attempt-2', 'job-1', 1, 'failed', NOW())
          `)
        ).rejects.toMatchObject({ meta: { code: "23505" } })

        await prisma.$executeRawUnsafe(`
          INSERT INTO "handle_history" ("handle", "userId") VALUES ('reader-one', NULL)
        `)
        await prisma.$executeRawUnsafe(`
          INSERT INTO "users" ("id", "name", "email", "handle", "updatedAt")
          VALUES ('user-1', 'Reader', 'reader@example.test', 'reader-one', NOW())
        `)
        await prisma.$executeRawUnsafe(`UPDATE "handle_history" SET "userId" = 'user-1' WHERE "handle" = 'reader-one'`)
        await prisma.$executeRawUnsafe(`
          INSERT INTO "legal_texts" (
            "id", "kind", "locale", "version", "status", "body", "summaryOfChanges", "isMaterial", "updatedAt"
          ) VALUES (
            'legal-1', 'terms', 'ru', 1, 'published', 'Terms v1', 'Initial version', true, NOW()
          )
        `)
        await prisma.$executeRawUnsafe(`
          INSERT INTO "user_legal_consents" ("id", "userId", "legalTextId")
          VALUES ('consent-1', 'user-1', 'legal-1')
        `)
        await expect(
          prisma.$executeRawUnsafe(`
            INSERT INTO "user_legal_consents" ("id", "userId", "legalTextId")
            VALUES ('consent-2', 'user-1', 'legal-1')
          `)
        ).rejects.toMatchObject({ meta: { code: "23505" } })
      } finally {
        await prisma.$disconnect()
      }
    })
  }, 30_000)

  it("keeps secrets out of mail and error records and per-process cost out of AI records", async () => {
    await withDatabase("t019_privacy", async (url) => {
      const prisma = await applyMigration(url)
      try {
        const columns = await prisma.$queryRawUnsafe<Array<{ tableName: string; columnName: string }>>(`
          SELECT table_name AS "tableName", column_name AS "columnName"
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN ('mail_messages', 'backend_errors', 'ai_processes', 'ai_cost_aggregates')
          ORDER BY table_name, ordinal_position
        `)
        const sensitiveNames = /(?:token|secret|password|credential|authorization|cookie)/i

        expect(
          columns
            .filter(({ tableName }) => tableName === "mail_messages" || tableName === "backend_errors")
            .filter(({ columnName }) => sensitiveNames.test(columnName))
        ).toEqual([])
        expect(
          columns.some(({ tableName, columnName }) => tableName === "mail_messages" && columnName === "sanitizedBody")
        ).toBe(true)
        expect(
          columns.filter(({ tableName }) => tableName === "backend_errors").map(({ columnName }) => columnName)
        ).toEqual(expect.arrayContaining(["sanitizedMessage", "sanitizedStack"]))
        expect(
          columns
            .filter(({ tableName }) => tableName === "backend_errors")
            .some(({ columnName }) => ["message", "stack", "context"].includes(columnName))
        ).toBe(false)
        expect(
          columns.some(({ tableName, columnName }) => tableName === "ai_processes" && /cost/i.test(columnName))
        ).toBe(false)
        expect(
          columns.some(
            ({ tableName, columnName }) => tableName === "ai_cost_aggregates" && columnName === "totalCostMinor"
          )
        ).toBe(true)
      } finally {
        await prisma.$disconnect()
      }
    })
  }, 30_000)
})
