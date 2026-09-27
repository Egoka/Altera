import { randomUUID } from "node:crypto"
import { CONTENT_SCHEMA_VERSION, nodeText, readDocument, type ContentDocument } from "@altera/content"
import { PrismaClient } from "../src/generated/prisma"
import { describe, expect, it } from "vitest"
import { applyBaselineMigrations, applyMigration } from "./helpers/migration-database"

// T-020: конверсия legacy-тел материалов в документ `content`. Алгоритм написан на SQL
// (`t020_legacy_body_to_document`) и вызывается миграцией, trigger T-015 и скриптом
// `verify:legacy-bodies`, поэтому проверяется на настоящем PostgreSQL; двойник его не проверяет.
//
// Результат каждой конверсии проходит `readDocument` из `@altera/content` — те же
// `migrateDocument` и `validateDocument`, которыми документ читает приложение.

const testDatabaseUrl = process.env.T020_TEST_DATABASE_URL
const targetMigration = "20260928120000_legacy_body_content_document"

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

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

const AUTHOR_ID = "author-t020"

const seedAuthor = async (prisma: PrismaClient): Promise<void> => {
  await prisma.$executeRawUnsafe(`INSERT INTO "handle_history" ("handle", "userId") VALUES ('t020-author', NULL)`)
  await prisma.$executeRawUnsafe(
    `INSERT INTO "users" ("id", "name", "email", "role", "handle", "updatedAt")
     VALUES ('${AUTHOR_ID}', 'Автор', 't020@example.test', 'author', 't020-author', NOW())`
  )
  await prisma.$executeRawUnsafe(`UPDATE "handle_history" SET "userId" = '${AUTHOR_ID}' WHERE "handle" = 't020-author'`)
}

/** Статья с legacy-телом. Тело пишется параметром: в текстах есть кавычки и переводы строк. */
const seedArticle = async (prisma: PrismaClient, id: string, body: string): Promise<void> => {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "articles" ("id", "title", "slug", "body", "status", "authorId", "updatedAt")
     VALUES ($1, $2, $3, $4, 'draft', '${AUTHOR_ID}', NOW())`,
    id,
    `Статья ${id}`,
    `slug-${id}`,
    body
  )
}

const LEGACY_ROOT = JSON.stringify({
  type: "root",
  children: [
    { type: "paragraph", text: "Первый абзац." },
    { type: "heading", level: 2, text: "Заголовок раздела" },
    { type: "quote", text: "Цитата из источника." },
    { type: "paragraph", text: "Последний абзац." }
  ]
})

const READY_DOCUMENT: ContentDocument = {
  type: "doc",
  attrs: { schemaVersion: CONTENT_SCHEMA_VERSION },
  content: [
    {
      type: "paragraph",
      attrs: { id: "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" },
      content: [{ type: "text", text: "Уже документ." }]
    }
  ]
}

interface BodyRow {
  id: string
  body: unknown
}

const translations = (prisma: PrismaClient): Promise<BodyRow[]> =>
  prisma.$queryRawUnsafe<BodyRow[]>(`SELECT "articleId" AS "id", "body" FROM "article_translations" ORDER BY "id"`)

const revisions = (prisma: PrismaClient): Promise<BodyRow[]> =>
  prisma.$queryRawUnsafe<BodyRow[]>(
    `SELECT t."articleId" AS "id", r."body" FROM "article_revisions" r
       JOIN "article_translations" t ON t."id" = r."translationId"
     ORDER BY t."articleId"`
  )

const counts = async (prisma: PrismaClient): Promise<Record<string, number>> => {
  const rows = await prisma.$queryRawUnsafe<Array<{ articles: bigint; translations: bigint; revisions: bigint }>>(
    `SELECT
       (SELECT COUNT(*) FROM "articles") AS "articles",
       (SELECT COUNT(*) FROM "article_translations") AS "translations",
       (SELECT COUNT(*) FROM "article_revisions") AS "revisions"`
  )
  const row = rows[0]!
  return { articles: Number(row.articles), translations: Number(row.translations), revisions: Number(row.revisions) }
}

/** Документ по правилам T-020 — только абзацы, и каждый из них проходит каталог. */
const paragraphTexts = (body: unknown): string[] => {
  const document = readDocument(body)
  expect(document.attrs.schemaVersion).toBe(CONTENT_SCHEMA_VERSION)
  expect(document.content.map((node) => node.type)).toEqual(document.content.map(() => "paragraph"))
  return document.content.map((node) => nodeText(node))
}

describe.skipIf(!testDatabaseUrl)("T-020 конверсия legacy-тел в документ content", () => {
  it("превращает все формы legacy-тела в документ каталога и сохраняет текст", async () => {
    await withDatabase("t020_convert", async (url) => {
      applyBaselineMigrations(targetMigration, url)
      const before = prismaFor(url)
      await seedAuthor(before)

      // Обычный текст — тело статьи до появления редактора.
      await seedArticle(before, "plain", "Обычный текст статьи.")
      // Многострочный текст: пустые строки разделяли абзацы и в исходном тексте.
      await seedArticle(before, "multiline", "Первая строка.\n\nВторая строка.\nТретья строка.")
      // Legacy-JSON прежнего редактора, попавший в TEXT-поле строкой.
      await seedArticle(before, "legacy", LEGACY_ROOT)
      // Пустое тело нового черновика.
      await seedArticle(before, "empty", "")
      // Текст, который сам похож на JSON: это текст статьи, а не документ.
      await seedArticle(before, "jsonish", '{"note": 1}')

      const beforeCounts = await counts(before)
      await before.$disconnect()

      const migration = applyMigration(targetMigration, url)
      expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)

      const after = prismaFor(url)
      try {
        // AC-2: конверсия не создаёт и не удаляет строки.
        expect(await counts(after)).toEqual(beforeCounts)

        const byId = new Map((await translations(after)).map((row) => [row.id, row.body]))

        expect(paragraphTexts(byId.get("plain"))).toEqual(["Обычный текст статьи."])
        expect(paragraphTexts(byId.get("multiline"))).toEqual(["Первая строка.", "Вторая строка.", "Третья строка."])
        // Заголовок и цитата уплощаются в абзацы: каталог блоков (Q-02) вне объёма T-020,
        // текст при этом сохраняется целиком и в исходном порядке.
        expect(paragraphTexts(byId.get("legacy"))).toEqual([
          "Первый абзац.",
          "Заголовок раздела",
          "Цитата из источника.",
          "Последний абзац."
        ])
        expect(paragraphTexts(byId.get("empty"))).toEqual([""])
        expect(paragraphTexts(byId.get("jsonish"))).toEqual(['{"note": 1}'])

        // Ревизии, созданные тем же trigger, конвертированы так же.
        for (const row of await revisions(after)) paragraphTexts(row.body)

        // AC-1: ни одного тела вне каталога не осталось.
        const leftovers = await after.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS "count" FROM (
             SELECT "body" FROM "article_translations" UNION ALL SELECT "body" FROM "article_revisions"
           ) AS bodies WHERE NOT "t020_is_content_document"("body")`
        )
        expect(Number(leftovers[0]!.count)).toBe(0)
      } finally {
        await after.$disconnect()
      }
    })
  }, 120_000)

  it("не меняет готовый документ и остаётся идемпотентной при повторном применении", async () => {
    await withDatabase("t020_idempotent", async (url) => {
      applyBaselineMigrations(targetMigration, url)
      const before = prismaFor(url)
      await seedAuthor(before)
      await seedArticle(before, "ready", "Тело-источник для trigger")
      // Готовый документ в версии — состояние после перехода редактора на пакет `content`.
      await before.$executeRawUnsafe(
        `UPDATE "article_translations" SET "body" = $1::jsonb WHERE "articleId" = 'ready'`,
        JSON.stringify(READY_DOCUMENT)
      )
      await before.$disconnect()

      const first = applyMigration(targetMigration, url)
      expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0)

      const after = prismaFor(url)
      try {
        const [row] = await translations(after)
        // Готовый документ возвращается байт-в-байт: `attrs.id` абзаца стабилен (ADR-0001 п. 3).
        expect(row!.body).toEqual(READY_DOCUMENT)

        const snapshot = await translations(after)
        const second = applyMigration(targetMigration, url)
        expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0)
        // Повторное применение не переписывает уже сконвертированные тела.
        expect(await translations(after)).toEqual(snapshot)
      } finally {
        await after.$disconnect()
      }
    })
  }, 120_000)

  it("после конверсии trigger T-015 пишет в версию документ, а не JSON-строку", async () => {
    await withDatabase("t020_trigger", async (url) => {
      applyBaselineMigrations(targetMigration, url)
      const before = prismaFor(url)
      await seedAuthor(before)
      await before.$disconnect()

      const migration = applyMigration(targetMigration, url)
      expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)

      const after = prismaFor(url)
      try {
        // INSERT в legacy-поле: версию и ревизию создаёт trigger.
        await seedArticle(after, "fresh", "Тело новой статьи.")
        expect(paragraphTexts((await translations(after))[0]!.body)).toEqual(["Тело новой статьи."])

        // UPDATE legacy-поля: та же ветка trigger обновляет версию и добавляет ревизию.
        await after.$executeRawUnsafe(
          `UPDATE "articles" SET "body" = $1 WHERE "id" = 'fresh'`,
          "Правка.\n\nВторой абзац."
        )
        expect(paragraphTexts((await translations(after))[0]!.body)).toEqual(["Правка.", "Второй абзац."])

        for (const row of await revisions(after)) paragraphTexts(row.body)
      } finally {
        await after.$disconnect()
      }
    })
  }, 120_000)
})
