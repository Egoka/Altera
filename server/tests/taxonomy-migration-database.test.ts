import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readdirSync } from "node:fs"
import path from "node:path"
import { PrismaClient } from "../src/generated/prisma"
import { describe, expect, it } from "vitest"

const testDatabaseUrl = process.env.T014_TEST_DATABASE_URL
const serverRoot = path.resolve(__dirname, "..")
const migrationsRoot = path.join(serverRoot, "prisma/migrations")
const targetMigration = "20260915180000_taxonomy_section_format_tag"

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

interface TaxonomySnapshot {
  sections: Array<{ id: string; slug: string }>
  tags: Array<{ id: string; slug: string }>
  articleSections: Array<{ id: string; sectionId: string | null }>
  articleTags: Array<{ A: string; B: string }>
}

describe.skipIf(!testDatabaseUrl)("T-014 taxonomy migration on PostgreSQL 16", () => {
  it("preserves every legacy section, tag, article assignment, and M:N pair", async () => {
    await withDatabase("t014_preservation", async (url) => {
      applyBaselineMigrations(url)
      const before = prismaFor(url)

      await before.$executeRawUnsafe(`INSERT INTO "handle_history" ("handle", "userId") VALUES ('author-one', NULL)`)
      await before.$executeRawUnsafe(
        `INSERT INTO "users" ("id", "name", "email", "role", "handle", "updatedAt")
         VALUES ('user-1', 'Author', 'author@example.test', 'author', 'author-one', NOW())`
      )
      await before.$executeRawUnsafe(`UPDATE "handle_history" SET "userId" = 'user-1' WHERE "handle" = 'author-one'`)
      await before.$executeRawUnsafe(`
        INSERT INTO "content_types" ("id", "name", "slug", "description", "order", "status", "updatedAt") VALUES
          ('section-1', 'Culture', 'culture', 'Culture', 1, 'active', NOW()),
          ('section-2', 'Music', 'music', NULL, 2, 'active', NOW())
      `)
      await before.$executeRawUnsafe(`
        INSERT INTO "section_tags" ("id", "name", "slug", "description", "updatedAt") VALUES
          ('tag-1', 'Archive', 'archive', NULL, NOW()),
          ('tag-2', 'Review', 'review', 'Review', NOW())
      `)
      await before.$executeRawUnsafe(`
        INSERT INTO "articles" ("id", "title", "slug", "body", "status", "authorId", "typeId", "updatedAt") VALUES
          ('article-1', 'First', 'first', 'Body', 'draft', 'user-1', 'section-1', NOW()),
          ('article-2', 'Second', 'second', 'Body', 'published', 'user-1', 'section-2', NOW())
      `)
      await before.$executeRawUnsafe(`
        INSERT INTO "_ArticleToSectionTag" ("A", "B") VALUES
          ('article-1', 'tag-1'),
          ('article-1', 'tag-2'),
          ('article-2', 'tag-2')
      `)

      const snapshot: TaxonomySnapshot = {
        sections: await before.$queryRawUnsafe(`SELECT "id", "slug" FROM "content_types" ORDER BY "id"`),
        tags: await before.$queryRawUnsafe(`SELECT "id", "slug" FROM "section_tags" ORDER BY "id"`),
        articleSections: await before.$queryRawUnsafe(
          `SELECT "id", "typeId" AS "sectionId" FROM "articles" ORDER BY "id"`
        ),
        articleTags: await before.$queryRawUnsafe(`SELECT "A", "B" FROM "_ArticleToSectionTag" ORDER BY "A", "B"`)
      }
      await before.$disconnect()

      const migration = applyTargetMigration(url)
      expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)

      const after = prismaFor(url)
      try {
        await expect(after.$queryRawUnsafe(`SELECT "id", "slug" FROM "sections" ORDER BY "id"`)).resolves.toEqual(
          snapshot.sections
        )
        await expect(after.$queryRawUnsafe(`SELECT "id", "slug" FROM "tags" ORDER BY "id"`)).resolves.toEqual(
          snapshot.tags
        )
        await expect(after.$queryRawUnsafe(`SELECT "id", "sectionId" FROM "articles" ORDER BY "id"`)).resolves.toEqual(
          snapshot.articleSections
        )
        await expect(after.$queryRawUnsafe(`SELECT "A", "B" FROM "_ArticleToTag" ORDER BY "A", "B"`)).resolves.toEqual(
          snapshot.articleTags
        )

        const registryCounts = await after.$queryRawUnsafe<Array<{ sections: bigint; tags: bigint }>>(`
          SELECT
            (SELECT COUNT(*) FROM "section_slug_history") AS "sections",
            (SELECT COUNT(*) FROM "tag_slug_history") AS "tags"
        `)
        expect(registryCounts).toEqual([{ sections: 2n, tags: 2n }])
      } finally {
        await after.$disconnect()
      }
    })
  }, 30_000)

  it("rejects archived sections without a distinct successor", async () => {
    await withDatabase("t014_archive_constraint", async (url) => {
      applyBaselineMigrations(url)
      const legacy = prismaFor(url)
      await legacy.$executeRawUnsafe(`
        INSERT INTO "content_types" ("id", "name", "slug", "order", "status", "updatedAt") VALUES
          ('section-1', 'Culture', 'culture', 1, 'active', NOW()),
          ('section-2', 'Music', 'music', 2, 'active', NOW())
      `)
      await legacy.$disconnect()

      const migration = applyTargetMigration(url)
      expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)

      const after = prismaFor(url)
      try {
        await expect(
          after.$executeRawUnsafe(`UPDATE "sections" SET "status" = 'archived' WHERE "id" = 'section-1'`)
        ).rejects.toMatchObject({ meta: { code: "23514" } })
        await expect(
          after.$executeRawUnsafe(
            `UPDATE "sections" SET "status" = 'archived', "successorId" = 'section-1' WHERE "id" = 'section-1'`
          )
        ).rejects.toMatchObject({ meta: { code: "23514" } })
      } finally {
        await after.$disconnect()
      }
    })
  }, 30_000)
})
