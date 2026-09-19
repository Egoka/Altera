import { randomUUID } from "node:crypto"
import { PrismaClient } from "../src/generated/prisma"
import { describe, expect, it } from "vitest"
import { applyBaselineMigrations, applyMigration } from "./helpers/migration-database"

const testDatabaseUrl = process.env.T017_TEST_DATABASE_URL
const targetMigration = "20260916190000_bookmarks_base_authorship"

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient =>
  new PrismaClient({
    datasources: { db: { url } }
  })

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

const seedUser = async (
  prisma: PrismaClient,
  user: { id: string; role: "reader" | "author" | "editor"; service?: boolean }
): Promise<void> => {
  const handle = `${user.id}-handle`
  await prisma.$executeRawUnsafe(`INSERT INTO "handle_history" ("handle", "userId") VALUES ('${handle}', NULL)`)
  await prisma.$executeRawUnsafe(
    `INSERT INTO "users" ("id", "name", "email", "role", "handle", "isServiceAccount", "updatedAt")
     VALUES ('${user.id}', '${user.id}', '${user.id}@example.test', '${user.role}', '${handle}', ${user.service ?? false}, NOW())`
  )
  await prisma.$executeRawUnsafe(`UPDATE "handle_history" SET "userId" = '${user.id}' WHERE "handle" = '${handle}'`)
}

describe.skipIf(!testDatabaseUrl)("T-017 bookmark and base authorship migration", () => {
  it("backfills existing authors with a lifelong standard grant without changing other users", async () => {
    await withDatabase("t017_grants", async (url) => {
      applyBaselineMigrations(targetMigration, url)
      const before = prismaFor(url)
      await seedUser(before, { id: "reader-1", role: "reader" })
      await seedUser(before, { id: "author-1", role: "author" })
      await before.$disconnect()

      const migration = applyMigration(targetMigration, url)
      expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)

      const after = prismaFor(url)
      try {
        const users = await after.$queryRawUnsafe<Array<{ id: string; planTier: string; planUntil: Date | null }>>(
          `SELECT "id", "planTier", "planUntil" FROM "users" ORDER BY "id"`
        )
        expect(users).toEqual([
          { id: "author-1", planTier: "standard", planUntil: null },
          { id: "reader-1", planTier: "free", planUntil: null }
        ])

        const grants = await after.$queryRawUnsafe<
          Array<{ userId: string; tier: string; endsAt: Date | null; grantedById: string | null; reason: string }>
        >(`SELECT "userId", "tier", "endsAt", "grantedById", "reason" FROM "plan_grants"`)
        expect(grants).toEqual([
          {
            userId: "author-1",
            tier: "standard",
            endsAt: null,
            grantedById: null,
            reason: "import: base authorship"
          }
        ])

        await expect(
          after.$executeRawUnsafe(
            `INSERT INTO "plan_grants" ("id", "userId", "tier", "reason")
             VALUES ('free-grant', 'reader-1', 'free', 'invalid')`
          )
        ).rejects.toMatchObject({ meta: { code: "23514" } })
        await expect(
          after.$executeRawUnsafe(
            `INSERT INTO "plan_grants" ("id", "userId", "tier", "reason")
             VALUES ('lifelong-pro', 'reader-1', 'pro', 'invalid')`
          )
        ).rejects.toMatchObject({ meta: { code: "23514" } })
      } finally {
        await after.$disconnect()
      }
    })
  }, 30_000)

  it("keeps bookmarks private to ordinary readers and authors at the database boundary", async () => {
    await withDatabase("t017_bookmarks", async (url) => {
      applyBaselineMigrations(targetMigration, url)
      const before = prismaFor(url)
      await seedUser(before, { id: "reader-1", role: "reader" })
      await seedUser(before, { id: "author-1", role: "author" })
      await seedUser(before, { id: "service-reader-1", role: "reader", service: true })
      await seedUser(before, { id: "editor-1", role: "editor", service: true })
      await before.$executeRawUnsafe(
        `INSERT INTO "articles" ("id", "title", "slug", "body", "status", "authorId", "updatedAt")
         VALUES ('article-1', 'Article', 'article', 'Body', 'published', 'editor-1', NOW())`
      )
      await before.$disconnect()

      const migration = applyMigration(targetMigration, url)
      expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)

      const after = prismaFor(url)
      try {
        await expect(
          after.$executeRawUnsafe(`INSERT INTO "bookmarks" ("userId", "articleId") VALUES ('reader-1', 'article-1')`)
        ).resolves.toBe(1)
        await expect(
          after.$executeRawUnsafe(`INSERT INTO "bookmarks" ("userId", "articleId") VALUES ('author-1', 'article-1')`)
        ).resolves.toBe(1)
        await expect(
          after.$executeRawUnsafe(`INSERT INTO "bookmarks" ("userId", "articleId") VALUES ('reader-1', 'article-1')`)
        ).rejects.toMatchObject({ meta: { code: "23505" } })
        await expect(
          after.$executeRawUnsafe(`INSERT INTO "bookmarks" ("userId", "articleId") VALUES ('editor-1', 'article-1')`)
        ).rejects.toMatchObject({ meta: { code: "23514" } })
        await expect(
          after.$executeRawUnsafe(
            `INSERT INTO "bookmarks" ("userId", "articleId") VALUES ('service-reader-1', 'article-1')`
          )
        ).rejects.toMatchObject({ meta: { code: "23514" } })
        await expect(
          after.$executeRawUnsafe(`UPDATE "users" SET "role" = 'editor' WHERE "id" = 'reader-1'`)
        ).rejects.toMatchObject({ meta: { code: "23514" } })

        await after.$executeRawUnsafe(`DELETE FROM "articles" WHERE "id" = 'article-1'`)
        const bookmarks = await after.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS "count" FROM "bookmarks"`
        )
        expect(bookmarks).toEqual([{ count: 0n }])
      } finally {
        await after.$disconnect()
      }
    })
  }, 30_000)

  it("serializes bookmark creation against conversion to a service role", async () => {
    await withDatabase("t017_bookmark_race", async (url) => {
      applyBaselineMigrations(targetMigration, url)
      const before = prismaFor(url)
      await seedUser(before, { id: "reader-1", role: "reader" })
      await seedUser(before, { id: "editor-1", role: "editor", service: true })
      await before.$executeRawUnsafe(
        `INSERT INTO "articles" ("id", "title", "slug", "body", "status", "authorId", "updatedAt")
         VALUES ('article-1', 'Article', 'article', 'Body', 'published', 'editor-1', NOW())`
      )
      await before.$disconnect()

      const migration = applyMigration(targetMigration, url)
      expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)

      const bookmarkClient = prismaFor(url)
      const roleClient = prismaFor(url)
      let markBookmarkInserted!: () => void
      let allowBookmarkCommit!: () => void
      const bookmarkInserted = new Promise<void>((resolve) => {
        markBookmarkInserted = resolve
      })
      const bookmarkMayCommit = new Promise<void>((resolve) => {
        allowBookmarkCommit = resolve
      })

      try {
        const createBookmark = bookmarkClient.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe(
            `INSERT INTO "bookmarks" ("userId", "articleId") VALUES ('reader-1', 'article-1')`
          )
          markBookmarkInserted()
          await bookmarkMayCommit
        })

        await bookmarkInserted
        const convertToServiceRole = roleClient.$executeRawUnsafe(
          `UPDATE "users" SET "role" = 'editor', "isServiceAccount" = true WHERE "id" = 'reader-1'`
        )

        await new Promise((resolve) => setTimeout(resolve, 50))
        allowBookmarkCommit()
        await createBookmark
        await expect(convertToServiceRole).rejects.toMatchObject({ meta: { code: "23514" } })
      } finally {
        allowBookmarkCommit()
        await bookmarkClient.$disconnect()
        await roleClient.$disconnect()
      }
    })
  }, 30_000)
})
