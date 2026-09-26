import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { resendMail } from "../src/admin/mail"
import { PrismaClient } from "../src/generated/prisma"
import type { GraphQLContext } from "../src/prisma"
import { applyBaselineMigrations, applyMigration } from "./helpers/migration-database"

/**
 * T-134 AC-4: два параллельных повтора одного письма дают одну отправку. Проверяется на настоящем
 * PostgreSQL, потому что вся защита держится на условном `UPDATE ... WHERE "resentAt" IS NULL`:
 * второй запрос ждёт первого и на READ COMMITTED перечитывает условие. Двойник этого не покажет.
 * Здесь же проверяется перенос уже выполненных повторов из аудита в колонку — часть той же миграции.
 * Запускается при заданном `T134_TEST_DATABASE_URL`.
 */
const testDatabaseUrl = process.env.T134_TEST_DATABASE_URL
const targetMigration = "20260926120000_mail_resend_claim"

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

interface MailRow {
  id: string
  template: string
  status: "queued" | "sent" | "bounced" | "failed"
}

const insertMail = (database: PrismaClient, row: MailRow): Promise<number> =>
  database.$executeRawUnsafe(
    `INSERT INTO "mail_messages" ("id", "template", "recipientEmail", "subject", "sanitizedBody", "status",
       "provider", "queuedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, 'reader@example.test', 'T134 письмо', 'T134 содержание без секретов.', $3::"MailDeliveryStatus",
       'smtp', NOW(), NOW(), NOW())`,
    row.id,
    row.template,
    row.status
  )

const insertRetryAudit = (database: PrismaClient, mailId: string): Promise<number> =>
  database.$executeRawUnsafe(
    `INSERT INTO "audit_logs" ("id", "action", "entityType", "entityId", "createdAt")
     VALUES ($1, 'job.retry', 'mailMessage', $2, TIMESTAMP '2026-09-25 10:00:00')`,
    randomUUID(),
    mailId
  )

/** Своя база на прогон: миграции до целевой применяются отдельно, чтобы вставить в неё данные. */
const withDatabase = async (
  run: (database: PrismaClient, beforeTarget: (database: PrismaClient) => Promise<void>) => Promise<void>
): Promise<void> => {
  const name = `t134_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    applyBaselineMigrations(targetMigration, url)
    const database = prismaFor(url)
    try {
      await run(database, async (seeded) => {
        await seeded.$disconnect()
        const migration = applyMigration(targetMigration, url)
        expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)
      })
    } finally {
      await database.$disconnect()
    }
  } finally {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`
    )
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`)
    await admin.$disconnect()
  }
}

const ownerContext = (database: PrismaClient, send: () => Promise<void>): GraphQLContext =>
  ({
    currentUser: {
      id: "t134-owner",
      role: "owner",
      archivedAt: null,
      planTier: "free",
      planUntil: null,
      permissionExceptions: []
    },
    requestId: "req-t134",
    piiHasher: { email: (value: string) => `hash-${value}`, ip: (value: string) => value },
    mail: { send },
    prisma: database
  }) as unknown as GraphQLContext

describe.skipIf(!testDatabaseUrl)("T-134 повтор письма в PostgreSQL", () => {
  it("переносит уже выполненные повторы из аудита в отметку письма", async () => {
    await withDatabase(async (database, applyTarget) => {
      await insertMail(database, { id: "t134-retried", template: "t134_notice", status: "failed" })
      await insertMail(database, { id: "t134-fresh", template: "t134_notice", status: "failed" })
      await insertRetryAudit(database, "t134-retried")

      await applyTarget(database)

      const marks = await database.$queryRaw<
        { id: string; resentAt: Date | null }[]
      >`SELECT "id", "resentAt" FROM "mail_messages" ORDER BY "id"`
      expect(marks.map(({ id }) => id)).toEqual(["t134-fresh", "t134-retried"])
      expect(marks[0]?.resentAt).toBeNull()
      // Отметка берёт время записи аудита: письмо, повторённое до миграции, повторить снова нельзя.
      expect(marks[1]?.resentAt).toBeInstanceOf(Date)
    })
  })

  it("на два параллельных повтора отправляет письмо один раз и отвечает CONFLICT на второй", async () => {
    await withDatabase(async (database, applyTarget) => {
      await insertMail(database, { id: "t134-parallel", template: "t134_notice", status: "failed" })
      await applyTarget(database)

      let sent = 0
      // Отправка держится 50 мс: заявка второго запроса попадает внутрь отправки первого, иначе
      // запросы могли бы не пересечься и гонки в тесте не было бы вовсе.
      const ctx = ownerContext(database, async () => {
        sent += 1
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      const results = await Promise.allSettled([resendMail(ctx, "t134-parallel"), resendMail(ctx, "t134-parallel")])

      expect(sent).toBe(1)
      expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"])
      const rejected = results.find((result) => result.status === "rejected")
      expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({
        extensions: { code: "CONFLICT", entity: "mailMessage", expected: "not-resent", actual: "resent" }
      })

      const [stored] = await database.$queryRaw<
        { resentAt: Date | null }[]
      >`SELECT "resentAt" FROM "mail_messages" WHERE "id" = 't134-parallel'`
      expect(stored?.resentAt).toBeInstanceOf(Date)
      const audits = await database.$queryRaw<
        { entityId: string }[]
      >`SELECT "entityId" FROM "audit_logs" WHERE "action" = 'job.retry'`
      expect(audits).toHaveLength(1)
    })
  })
})
