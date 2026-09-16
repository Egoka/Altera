import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readdirSync } from "node:fs"
import path from "node:path"
import { PrismaClient } from "../src/generated/prisma"
import { describe, expect, it } from "vitest"

const testDatabaseUrl = process.env.T016_TEST_DATABASE_URL
const serverRoot = path.resolve(__dirname, "..")
const migrationsRoot = path.join(serverRoot, "prisma/migrations")
const targetMigration = "20260916170000_media_assets"

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

const insertAsset = (database: PrismaClient, id: string) =>
  database.$executeRawUnsafe(`
    INSERT INTO "media_assets"
      ("id", "ownerId", "storageKey", "mimeType", "byteSize", "sha256", "attribution", "license", "updatedAt")
    VALUES
      ('${id}', 'user-1', '2026/09/${id}.webp', 'image/webp', 100, '${id}-sha256', 'Author', 'own', NOW())
  `)

describe.skipIf(!testDatabaseUrl)("T-016 media asset migration on PostgreSQL 17", () => {
  it("creates media assets with the processing lifecycle and one canonical alt", async () => {
    await withDatabase("t016_schema", async (url) => {
      applyBaselineMigrations(url)

      const migration = applyTargetMigration(url)
      expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)

      const database = prismaFor(url)
      try {
        await database.$executeRawUnsafe(
          `INSERT INTO "handle_history" ("handle", "userId") VALUES ('author-one', NULL)`
        )
        await database.$executeRawUnsafe(`
          INSERT INTO "users" ("id", "name", "email", "role", "handle", "updatedAt")
          VALUES ('user-1', 'Author', 'author@example.test', 'author', 'author-one', NOW())
        `)
        await database.$executeRawUnsafe(
          `UPDATE "handle_history" SET "userId" = 'user-1' WHERE "handle" = 'author-one'`
        )

        await insertAsset(database, "asset-schema")

        await expect(
          database.$queryRawUnsafe(`
            SELECT
              "kind"::text,
              "processingStatus"::text,
              "variants",
              "alt",
              "license"::text,
              "focalX",
              "focalY"
            FROM "media_assets"
            WHERE "id" = 'asset-schema'
          `)
        ).resolves.toEqual([
          {
            kind: "image",
            processingStatus: "uploading",
            variants: [],
            alt: null,
            license: "own",
            focalX: null,
            focalY: null
          }
        ])

        await expect(
          database.$queryRawUnsafe(`
            SELECT enum_range(NULL::"MediaProcessingStatus")::text AS values
          `)
        ).resolves.toEqual([{ values: "{uploading,queued,processing,ready,failed}" }])

        await expect(
          database.$queryRawUnsafe(`
            SELECT table_name AS "tableName"
            FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'alt'
          `)
        ).resolves.toEqual([{ tableName: "media_assets" }])
      } finally {
        await database.$disconnect()
      }
    })
  }, 30_000)

  it("selects only media assets without an active content, cover, or avatar relation", async () => {
    await withDatabase("t016_orphans", async (url) => {
      applyBaselineMigrations(url)

      const migration = applyTargetMigration(url)
      expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)

      const database = prismaFor(url)
      try {
        await database.$executeRawUnsafe(
          `INSERT INTO "handle_history" ("handle", "userId") VALUES ('author-one', NULL)`
        )
        await database.$executeRawUnsafe(`
          INSERT INTO "users" ("id", "name", "email", "role", "handle", "updatedAt")
          VALUES ('user-1', 'Author', 'author@example.test', 'author', 'author-one', NOW())
        `)
        await database.$executeRawUnsafe(
          `UPDATE "handle_history" SET "userId" = 'user-1' WHERE "handle" = 'author-one'`
        )

        for (const id of ["avatar", "previous-avatar", "cover", "content", "revision", "orphan"]) {
          await insertAsset(database, id)
        }

        await database.$executeRawUnsafe(`
          UPDATE "users"
          SET "avatarAssetId" = 'avatar', "prevAvatarId" = 'previous-avatar'
          WHERE "id" = 'user-1'
        `)
        await database.$executeRawUnsafe(`
          INSERT INTO "articles"
            ("id", "title", "slug", "body", "status", "authorId", "coverAssetId", "updatedAt")
          VALUES
            ('article-1', 'Article', 'article', 'Legacy body', 'draft', 'user-1', 'cover', NOW())
        `)
        await database.$executeRawUnsafe(`
          UPDATE "article_translations"
          SET "body" = '{"type":"doc","content":[{"type":"figure","attrs":{"assetId":"content"}}]}'::jsonb
          WHERE "articleId" = 'article-1'
        `)
        await database.$executeRawUnsafe(`
          UPDATE "article_revisions"
          SET "body" = '{"type":"doc","content":[{"type":"figure","attrs":{"assetId":"revision"}}]}'::jsonb
          WHERE "translationId" = 'translation-article-1'
        `)

        const orphaned = await database.$queryRawUnsafe<Array<{ id: string }>>(`
          SELECT m."id"
          FROM "media_assets" m
          WHERE NOT EXISTS (
            SELECT 1
            FROM "users" u
            WHERE u."avatarAssetId" = m."id" OR u."prevAvatarId" = m."id"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "articles" a
            WHERE a."coverAssetId" = m."id"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "article_translations" t
            CROSS JOIN LATERAL jsonb_path_query(t."body", 'lax $.**.assetId') AS reference(value)
            WHERE reference.value #>> '{}' = m."id"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "article_revisions" r
            CROSS JOIN LATERAL jsonb_path_query(r."body", 'lax $.**.assetId') AS reference(value)
            WHERE reference.value #>> '{}' = m."id"
          )
          ORDER BY m."id"
        `)

        expect(orphaned).toEqual([{ id: "orphan" }])
      } finally {
        await database.$disconnect()
      }
    })
  }, 30_000)
})
