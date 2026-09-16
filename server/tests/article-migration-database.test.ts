import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readdirSync } from "node:fs"
import path from "node:path"
import { PrismaClient } from "../src/generated/prisma"
import { describe, expect, it } from "vitest"

const testDatabaseUrl = process.env.T015_TEST_DATABASE_URL
const serverRoot = path.resolve(__dirname, "..")
const migrationsRoot = path.join(serverRoot, "prisma/migrations")
const targetMigration = "20260916120000_article_translations_revisions"

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

interface TranslationSnapshot {
  articleId: string
  locale: string
  slug: string
  title: string
  body: unknown
  status: string
  rejected: boolean
  publishedAt: Date | null
}

interface RevisionSnapshot {
  translationId: string
  title: string
  body: unknown
  kind: string
  createdById: string
}

describe.skipIf(!testDatabaseUrl)("T-015 article migration on PostgreSQL 17", () => {
  it("creates one Russian translation and one revision for every legacy article", async () => {
    await withDatabase("t015_backfill", async (url) => {
      applyBaselineMigrations(url)
      const before = prismaFor(url)

      await before.$executeRawUnsafe(`INSERT INTO "handle_history" ("handle", "userId") VALUES ('author-one', NULL)`)
      await before.$executeRawUnsafe(
        `INSERT INTO "users" ("id", "name", "email", "role", "handle", "updatedAt")
         VALUES ('user-1', 'Author', 'author@example.test', 'author', 'author-one', NOW())`
      )
      await before.$executeRawUnsafe(`UPDATE "handle_history" SET "userId" = 'user-1' WHERE "handle" = 'author-one'`)
      await before.$executeRawUnsafe(`
        INSERT INTO "articles"
          ("id", "title", "slug", "dek", "body", "excerpt", "featuredImage", "status", "publishedAt", "authorId", "updatedAt")
        VALUES
          ('article-draft', 'Draft', 'draft-slug', 'Draft dek', 'Draft body', 'Draft excerpt', NULL, 'draft', NULL, 'user-1', '2026-09-01T10:00:00Z'),
          ('article-published', 'Published', 'published-slug', NULL, 'Published body', NULL, '/cover.jpg', 'published', '2026-09-02T10:00:00Z', 'user-1', '2026-09-02T10:00:00Z'),
          ('article-archived', 'Archived', 'archived-slug', NULL, 'Archived body', NULL, NULL, 'archived', '2026-09-03T10:00:00Z', 'user-1', '2026-09-04T10:00:00Z')
      `)
      await before.$disconnect()

      const migration = applyTargetMigration(url)
      expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)

      const after = prismaFor(url)
      try {
        const translations = await after.$queryRawUnsafe<TranslationSnapshot[]>(`
          SELECT
            "articleId",
            "locale"::text,
            "slug",
            "title",
            "body",
            "status"::text,
            "rejected",
            "publishedAt"
          FROM "article_translations"
          ORDER BY "articleId"
        `)

        expect(translations).toEqual([
          {
            articleId: "article-archived",
            locale: "ru",
            slug: "archived-slug",
            title: "Archived",
            body: "Archived body",
            status: "archived",
            rejected: false,
            publishedAt: new Date("2026-09-03T10:00:00Z")
          },
          {
            articleId: "article-draft",
            locale: "ru",
            slug: "draft-slug",
            title: "Draft",
            body: "Draft body",
            status: "draft",
            rejected: false,
            publishedAt: null
          },
          {
            articleId: "article-published",
            locale: "ru",
            slug: "published-slug",
            title: "Published",
            body: "Published body",
            status: "published",
            rejected: false,
            publishedAt: new Date("2026-09-02T10:00:00Z")
          }
        ])

        const revisions = await after.$queryRawUnsafe<RevisionSnapshot[]>(`
          SELECT r."translationId", r."title", r."body", r."kind"::text, r."createdById"
          FROM "article_revisions" r
          JOIN "article_translations" t ON t."id" = r."translationId"
          ORDER BY t."articleId"
        `)

        expect(revisions).toEqual([
          {
            translationId: "translation-article-archived",
            title: "Archived",
            body: "Archived body",
            kind: "publish",
            createdById: "user-1"
          },
          {
            translationId: "translation-article-draft",
            title: "Draft",
            body: "Draft body",
            kind: "manual",
            createdById: "user-1"
          },
          {
            translationId: "translation-article-published",
            title: "Published",
            body: "Published body",
            kind: "publish",
            createdById: "user-1"
          }
        ])

        const articles = await after.$queryRawUnsafe<
          Array<{
            id: string
            sourceLocale: string
            isEditorial: boolean
            firstPublishedAt: Date | null
            archivedAt: Date | null
            archivedByActorId: string | null
            archivedByRole: string | null
          }>
        >(`
          SELECT
            "id",
            "sourceLocale"::text,
            "isEditorial",
            "firstPublishedAt",
            "archivedAt",
            "archivedByActorId",
            "archivedByRole"::text
          FROM "articles"
          ORDER BY "id"
        `)

        expect(articles).toEqual([
          {
            id: "article-archived",
            sourceLocale: "ru",
            isEditorial: false,
            firstPublishedAt: new Date("2026-09-03T10:00:00Z"),
            archivedAt: new Date("2026-09-04T10:00:00Z"),
            archivedByActorId: null,
            archivedByRole: null
          },
          {
            id: "article-draft",
            sourceLocale: "ru",
            isEditorial: false,
            firstPublishedAt: null,
            archivedAt: null,
            archivedByActorId: null,
            archivedByRole: null
          },
          {
            id: "article-published",
            sourceLocale: "ru",
            isEditorial: false,
            firstPublishedAt: new Date("2026-09-02T10:00:00Z"),
            archivedAt: null,
            archivedByActorId: null,
            archivedByRole: null
          }
        ])
      } finally {
        await after.$disconnect()
      }
    })
  }, 30_000)

  it("enforces one translation per article and locale and one owner per locale slug", async () => {
    await withDatabase("t015_constraints", async (url) => {
      applyBaselineMigrations(url)
      const legacy = prismaFor(url)
      await legacy.$executeRawUnsafe(`INSERT INTO "handle_history" ("handle", "userId") VALUES ('author-one', NULL)`)
      await legacy.$executeRawUnsafe(
        `INSERT INTO "users" ("id", "name", "email", "role", "handle", "updatedAt")
         VALUES ('user-1', 'Author', 'author@example.test', 'author', 'author-one', NOW())`
      )
      await legacy.$executeRawUnsafe(`UPDATE "handle_history" SET "userId" = 'user-1' WHERE "handle" = 'author-one'`)
      await legacy.$executeRawUnsafe(`
        INSERT INTO "articles" ("id", "title", "slug", "body", "status", "authorId", "updatedAt")
        VALUES ('article-1', 'One', 'one', 'Body', 'draft', 'user-1', NOW())
      `)
      await legacy.$disconnect()

      const migration = applyTargetMigration(url)
      expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)

      const after = prismaFor(url)
      try {
        await expect(
          after.$executeRawUnsafe(`
            INSERT INTO "article_translations"
              ("id", "articleId", "locale", "slug", "title", "body", "status", "updatedAt")
            VALUES ('duplicate-locale', 'article-1', 'ru', 'another-slug', 'Duplicate', '"Body"'::jsonb, 'draft', NOW())
          `)
        ).rejects.toMatchObject({ meta: { code: "23505" } })

        await after.$executeRawUnsafe(`
          INSERT INTO "articles" ("id", "title", "slug", "body", "status", "authorId", "updatedAt")
          VALUES ('article-2', 'Two', 'two', 'Body', 'draft', 'user-1', NOW())
        `)
        await expect(
          after.$executeRawUnsafe(`
            INSERT INTO "article_translations"
              ("id", "articleId", "locale", "slug", "title", "body", "status", "updatedAt")
            VALUES ('duplicate-slug', 'article-2', 'ru', 'one', 'Duplicate', '"Body"'::jsonb, 'draft', NOW())
          `)
        ).rejects.toMatchObject({ meta: { code: "23505" } })
      } finally {
        await after.$disconnect()
      }
    })
  }, 30_000)

  it("keeps normalized rows synchronized while legacy article writes remain authoritative", async () => {
    await withDatabase("t015_compatibility", async (url) => {
      applyBaselineMigrations(url)
      const legacy = prismaFor(url)
      await legacy.$executeRawUnsafe(`INSERT INTO "handle_history" ("handle", "userId") VALUES ('author-one', NULL)`)
      await legacy.$executeRawUnsafe(
        `INSERT INTO "users" ("id", "name", "email", "role", "handle", "updatedAt")
         VALUES ('user-1', 'Author', 'author@example.test', 'author', 'author-one', NOW())`
      )
      await legacy.$executeRawUnsafe(`UPDATE "handle_history" SET "userId" = 'user-1' WHERE "handle" = 'author-one'`)
      await legacy.$disconnect()

      const migration = applyTargetMigration(url)
      expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)

      const after = prismaFor(url)
      try {
        const originalBody = '{"type":"doc"}\nЮникод "цитата"'
        await after.$executeRaw`
          INSERT INTO "articles" ("id", "title", "slug", "body", "status", "authorId", "updatedAt")
          VALUES ('article-after', 'After', 'after', ${originalBody}, 'draft', 'user-1', NOW())
        `

        await expect(
          after.$queryRawUnsafe(`
            SELECT
              t."title",
              t."body",
              jsonb_typeof(t."body") AS "bodyType",
              t."status"::text,
              COUNT(r."id")::int AS "revisionCount"
            FROM "article_translations" t
            JOIN "article_revisions" r ON r."translationId" = t."id"
            WHERE t."articleId" = 'article-after'
            GROUP BY t."id"
          `)
        ).resolves.toEqual([
          {
            title: "After",
            body: originalBody,
            bodyType: "string",
            status: "draft",
            revisionCount: 1
          }
        ])

        const updatedBody = "Обновлённое тело\nсо второй строкой"
        await after.$executeRaw`
          UPDATE "articles"
          SET "title" = 'After updated', "body" = ${updatedBody}, "status" = 'review', "updatedAt" = NOW()
          WHERE "id" = 'article-after'
        `

        await expect(
          after.$queryRawUnsafe(`
            SELECT
              t."title",
              t."body",
              jsonb_typeof(t."body") AS "bodyType",
              t."status"::text,
              COUNT(r."id")::int AS "revisionCount"
            FROM "article_translations" t
            JOIN "article_revisions" r ON r."translationId" = t."id"
            WHERE t."articleId" = 'article-after'
            GROUP BY t."id"
          `)
        ).resolves.toEqual([
          {
            title: "After updated",
            body: updatedBody,
            bodyType: "string",
            status: "review",
            revisionCount: 2
          }
        ])
      } finally {
        await after.$disconnect()
      }
    })
  }, 30_000)
})
