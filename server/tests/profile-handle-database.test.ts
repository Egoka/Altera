import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readdirSync } from "node:fs"
import path from "node:path"
import { PrismaClient } from "../src/generated/prisma"
import { changeUserHandle, createUserWithReservedHandle } from "../src/auth/handle"
import { describe, expect, it } from "vitest"

const testDatabaseUrl = process.env.T013_TEST_DATABASE_URL
const serverRoot = path.resolve(__dirname, "..")
const migrationsRoot = path.join(serverRoot, "prisma/migrations")
const targetMigration = "20260915170000_user_profile_handle_locale"

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
  const command = args[0] === "db" ? [...args, "--schema", path.join(serverRoot, "prisma/schema.prisma")] : args
  execFileSync("pnpm", ["exec", "prisma", ...command], {
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
  const adminUrl = databaseUrl("postgres")
  const admin = prismaFor(adminUrl)
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

describe.skipIf(!testDatabaseUrl)("profile handle migration on PostgreSQL 16", () => {
  it("keeps every released handle reserved after change, archive, and deletion", async () => {
    await withDatabase("t013_reservation", async (url) => {
      runPrisma(["migrate", "deploy"], url)
      const prisma = prismaFor(url)

      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "handle_history" ("handle", "userId") VALUES ('first-handle', NULL)`
        )
        await prisma.$executeRawUnsafe(
          `INSERT INTO "users" ("id", "name", "email", "role", "handle", "updatedAt") VALUES ('user-1', 'Reader', 'reader@example.test', 'reader', 'first-handle', NOW())`
        )
        await prisma.$executeRawUnsafe(
          `UPDATE "handle_history" SET "userId" = 'user-1' WHERE "handle" = 'first-handle'`
        )
        await changeUserHandle(prisma, {
          userId: "user-1",
          handle: "SECOND-HANDLE",
          requestId: "db-test"
        })
        await expect(
          changeUserHandle(prisma, {
            userId: "user-1",
            handle: "first-handle",
            requestId: "db-test"
          })
        ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } })
        await prisma.user.update({ where: { id: "user-1" }, data: { archivedAt: new Date() } })
        await prisma.$executeRawUnsafe(`DELETE FROM "users" WHERE "id" = 'user-1'`)

        await expect(
          prisma.$executeRawUnsafe(`INSERT INTO "handle_history" ("handle") VALUES ('first-handle')`)
        ).rejects.toThrow(/already exists|unique constraint|duplicate key|handle_history_pkey/i)

        const rows = await prisma.$queryRawUnsafe<Array<{ handle: string; userId: string | null }>>(
          `SELECT "handle", "userId" FROM "handle_history" ORDER BY "handle"`
        )
        expect(rows).toEqual([
          { handle: "first-handle", userId: null },
          { handle: "second-handle", userId: null }
        ])
      } finally {
        await prisma.$disconnect()
      }
    })
  }, 30_000)

  it("rolls back a random handle reservation when user creation conflicts", async () => {
    await withDatabase("t013_allocator_rollback", async (url) => {
      runPrisma(["migrate", "deploy"], url)
      const prisma = prismaFor(url)

      try {
        await prisma.handleHistory.create({ data: { handle: "existing-user" } })
        const existing = await prisma.user.create({
          data: { id: "user-existing", email: "reader@example.test", name: "Reader", handle: "existing-user" }
        })
        await prisma.handleHistory.update({ where: { handle: existing.handle }, data: { userId: existing.id } })

        await expect(
          createUserWithReservedHandle(prisma, {
            email: existing.email,
            name: "Concurrent reader",
            locale: "ru"
          })
        ).rejects.toMatchObject({ code: "P2002" })

        await expect(prisma.handleHistory.count()).resolves.toBe(1)
      } finally {
        await prisma.$disconnect()
      }
    })
  }, 30_000)

  it("backfills random current handles while preserving legacy slugs", async () => {
    await withDatabase("t013_backfill", async (url) => {
      applyBaselineMigrations(url)
      const before = prismaFor(url)
      await before.$executeRawUnsafe(
        `INSERT INTO "users" ("id", "name", "email", "role", "slug", "updatedAt") VALUES
          ('user-1', 'First', 'first@example.test', 'reader', 'First-Legacy', NOW()),
          ('user-2', 'Second', 'second@example.test', 'author', 'second-legacy', NOW())`
      )
      await before.$disconnect()

      const migration = applyTargetMigration(url)
      expect(migration.status, migration.stderr).toBe(0)

      const after = prismaFor(url)
      try {
        const users = await after.$queryRawUnsafe<
          Array<{ email: string; handle: string; locale: string; nameCheckStatus: string; avatarCheckStatus: string }>
        >(
          `SELECT "email", "handle", "locale"::text, "nameCheckStatus"::text, "avatarCheckStatus"::text FROM "users" ORDER BY "email"`
        )
        expect(users).toEqual([
          expect.objectContaining({
            email: "first@example.test",
            locale: "ru",
            nameCheckStatus: "ok",
            avatarCheckStatus: "ok"
          }),
          expect.objectContaining({
            email: "second@example.test",
            locale: "ru",
            nameCheckStatus: "ok",
            avatarCheckStatus: "ok"
          })
        ])
        expect(users.map(({ handle }) => handle)).toEqual([
          expect.stringMatching(/^u-[0-9a-f]{8}$/),
          expect.stringMatching(/^u-[0-9a-f]{8}$/)
        ])
        expect(users.every(({ email, handle }) => !email.startsWith(handle))).toBe(true)

        const history = await after.$queryRawUnsafe<Array<{ handle: string }>>(
          `SELECT "handle" FROM "handle_history" ORDER BY "handle"`
        )
        expect(history.map(({ handle }) => handle)).toEqual(
          expect.arrayContaining(["first-legacy", "second-legacy", users[0].handle, users[1].handle])
        )
      } finally {
        await after.$disconnect()
      }
    })
  }, 30_000)

  it("aborts before changing data when legacy slugs collide case-insensitively", async () => {
    await withDatabase("t013_preflight", async (url) => {
      applyBaselineMigrations(url)
      const before = prismaFor(url)
      await before.$executeRawUnsafe(
        `INSERT INTO "users" ("id", "name", "email", "role", "slug", "updatedAt") VALUES
          ('user-1', 'First', 'first@example.test', 'reader', 'Ivan', NOW()),
          ('user-2', 'Second', 'second@example.test', 'reader', 'ivan', NOW())`
      )
      await before.$disconnect()

      const migration = applyTargetMigration(url)
      expect(migration.status).not.toBe(0)
      expect(`${migration.stdout}\n${migration.stderr}`).toMatch(/P2002|case-insensitive legacy slug conflicts: 1/i)

      const after = prismaFor(url)
      try {
        const columns = await after.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*)::bigint AS count FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'handle'`
        )
        const users = await after.$queryRawUnsafe<Array<{ slug: string }>>(`SELECT "slug" FROM "users" ORDER BY "slug"`)
        expect(columns[0].count).toBe(0n)
        expect(users).toEqual([{ slug: "Ivan" }, { slug: "ivan" }])
      } finally {
        await after.$disconnect()
      }
    })
  }, 30_000)
})
