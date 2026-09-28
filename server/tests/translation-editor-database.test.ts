import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { PrismaClient } from "../src/generated/prisma"
import { applyAllMigrations } from "./helpers/migration-database"

/**
 * T-040: редактор пишет от языковой версии, а не от наследной строки `articles`.
 *
 * Trigger `t015_sync_legacy_article` синхронизирует версию из `articles` и сам заводит ревизию.
 * Миграция `20260929130000_translation_first_editor` даёт писателю «от языковой версии»
 * выключить его параметром сеанса `altera.legacy_sync`. Поведение живёт в базе, поэтому
 * проверяется на настоящем PostgreSQL: двойник Prisma trigger не исполняет.
 */

const testDatabaseUrl = process.env.T040_TEST_DATABASE_URL

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (prefix: string, run: (prisma: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `${prefix}_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    applyAllMigrations(url)
    const prisma = prismaFor(url)
    try {
      await run(prisma)
    } finally {
      await prisma.$disconnect()
    }
  } finally {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`
    )
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`)
    await admin.$disconnect()
  }
}

const AUTHOR_ID = "author-t040"

/** Автор и черновик с языковой версией — их заводит trigger при вставке наследной строки. */
const seed = async (prisma: PrismaClient): Promise<string> => {
  await prisma.$executeRawUnsafe(`INSERT INTO "handle_history" ("handle") VALUES ('t040-author')`)
  await prisma.$executeRawUnsafe(
    `INSERT INTO "users" ("id", "name", "email", "role", "handle", "updatedAt")
     VALUES ('${AUTHOR_ID}', 'Автор', 't040@example.test', 'author', 't040-author', NOW())`
  )
  await prisma.$executeRawUnsafe(`UPDATE "handle_history" SET "userId" = '${AUTHOR_ID}' WHERE "handle" = 't040-author'`)
  await prisma.$executeRawUnsafe(
    `INSERT INTO "articles" ("id", "title", "slug", "body", "status", "authorId", "updatedAt")
     VALUES ('article-1', 'Наследный заголовок', 'article-1', 'Наследный текст', 'draft', '${AUTHOR_ID}', NOW())`
  )
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "article_translations" WHERE "articleId" = 'article-1'`
  )
  return rows[0]!.id
}

const translationTitle = async (prisma: PrismaClient, id: string): Promise<string> => {
  const rows = await prisma.$queryRawUnsafe<Array<{ title: string }>>(
    `SELECT "title" FROM "article_translations" WHERE "id" = $1`,
    id
  )
  return rows[0]!.title
}

const revisionCount = async (prisma: PrismaClient, id: string): Promise<number> => {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS "count" FROM "article_revisions" WHERE "translationId" = $1`,
    id
  )
  return Number(rows[0]!.count)
}

describe.skipIf(!testDatabaseUrl)("T-040 наследная синхронизация языковой версии", () => {
  it("по умолчанию trigger переписывает версию из наследной строки", async () => {
    await withDatabase("t040_sync_on", async (prisma) => {
      const translationId = await seed(prisma)
      await prisma.$executeRawUnsafe(
        `UPDATE "article_translations" SET "title" = 'Заголовок автора' WHERE "id" = $1`,
        translationId
      )
      const before = await revisionCount(prisma, translationId)

      await prisma.$executeRawUnsafe(`UPDATE "articles" SET "status" = 'review' WHERE "id" = 'article-1'`)

      // Это и есть причина опции: правка статуса наследной строки стирает текст автора.
      expect(await translationTitle(prisma, translationId)).toBe("Наследный заголовок")
      expect(await revisionCount(prisma, translationId)).toBe(before)
    })
  })

  it("с выключенной синхронизацией наследная правка версию не трогает", async () => {
    await withDatabase("t040_sync_off", async (prisma) => {
      const translationId = await seed(prisma)
      await prisma.$executeRawUnsafe(
        `UPDATE "article_translations" SET "title" = 'Заголовок автора' WHERE "id" = $1`,
        translationId
      )
      const before = await revisionCount(prisma, translationId)

      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL "altera.legacy_sync" = 'off'`)
        await tx.$executeRawUnsafe(
          `UPDATE "articles" SET "status" = 'review', "title" = 'Заголовок автора' WHERE "id" = 'article-1'`
        )
      })

      expect(await translationTitle(prisma, translationId)).toBe("Заголовок автора")
      // Ревизию редактор заводит сам: вторая, от trigger, историю бы задвоила.
      expect(await revisionCount(prisma, translationId)).toBe(before)
    })
  })

  it("параметр действует только внутри своей транзакции", async () => {
    await withDatabase("t040_sync_scope", async (prisma) => {
      const translationId = await seed(prisma)

      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL "altera.legacy_sync" = 'off'`)
        await tx.$executeRawUnsafe(`UPDATE "articles" SET "title" = 'Тихая правка' WHERE "id" = 'article-1'`)
      })
      await prisma.$executeRawUnsafe(
        `UPDATE "article_translations" SET "title" = 'Заголовок автора' WHERE "id" = $1`,
        translationId
      )

      await prisma.$executeRawUnsafe(`UPDATE "articles" SET "title" = 'Следующая правка' WHERE "id" = 'article-1'`)

      expect(await translationTitle(prisma, translationId)).toBe("Следующая правка")
    })
  })
})
