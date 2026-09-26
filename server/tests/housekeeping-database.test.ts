import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { PrismaClient } from "../src/generated/prisma"
import { runHousekeeping } from "../src/housekeeping"
import { applyBaselineMigrations } from "./helpers/migration-database"

/**
 * Housekeeping на настоящем PostgreSQL: условие прореживания `autosave` написано на SQL, а
 * защита аудита и истории решений держится на внешних ключах — двойник этого не докажет.
 * Запускается при заданном `T090_TEST_DATABASE_URL`.
 */
const testDatabaseUrl = process.env.T090_TEST_DATABASE_URL
// Имя старше любого каталога миграций: применяются все миграции по порядку.
const afterAllMigrations = "99999999999999_after_all"

const NOW = new Date("2026-09-21T03:00:00.000Z")
const daysBefore = (days: number): Date => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (run: (database: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `t090_${randomUUID().replace(/-/g, "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    applyBaselineMigrations(afterAllMigrations, url)
    const database = prismaFor(url)
    try {
      await run(database)
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

const ids = async (rows: Promise<{ id: string }[]>): Promise<string[]> => (await rows).map(({ id }) => id).sort()

describe.skipIf(!testDatabaseUrl)("T-090 housekeeping на PostgreSQL", () => {
  it("удаляет только истёкшее и не трогает аудит и историю решений", async () => {
    await withDatabase(async (db) => {
      await db.handleHistory.create({ data: { handle: "author-1" } })
      const user = await db.user.create({
        data: { id: "user-1", email: "author@example.test", name: "Author", handle: "author-1", role: "author" }
      })

      // Сессии: истекла больше 30 дней назад — удаляется; истекла недавно и действующая — остаются.
      await db.session.createMany({
        data: [
          { id: "session-old", userId: user.id, tokenHash: "a".repeat(64), expiresAt: daysBefore(31) },
          { id: "session-recent", userId: user.id, tokenHash: "b".repeat(64), expiresAt: daysBefore(29) },
          { id: "session-active", userId: user.id, tokenHash: "c".repeat(64), expiresAt: daysBefore(-10) }
        ]
      })

      // Токены входа и коды: использованные и истёкшие удаляются, действующие остаются.
      await db.magicLinkToken.createMany({
        data: [
          {
            id: "link-used",
            tokenHash: "d".repeat(64),
            email: "used@example.test",
            expiresAt: daysBefore(-1),
            usedAt: NOW
          },
          { id: "link-expired", tokenHash: "e".repeat(64), email: "expired@example.test", expiresAt: daysBefore(1) },
          { id: "link-live", tokenHash: "f".repeat(64), email: "live@example.test", expiresAt: daysBefore(-1) }
        ]
      })
      await db.emailChangeRequest.create({
        data: { userId: user.id, newEmail: "new@example.test", codeHash: "0".repeat(64), expiresAt: daysBefore(1) }
      })

      // Триггер t015 создаёт при вставке статьи перевод `translation-<id>` и ручную ревизию
      // `revision-<id>` с датой `updatedAt` статьи; дата в прошлом делает её самой старой ревизией.
      const article = (id: string) =>
        db.article.create({
          data: {
            id,
            title: "T",
            slug: id,
            body: "",
            authorId: user.id,
            createdAt: daysBefore(100),
            updatedAt: daysBefore(100)
          }
        })

      // Ревизии одного перевода, от старых к новым.
      await article("article-1")
      const revision = (id: string, kind: "autosave" | "manual", days: number, restoredFromId?: string) =>
        db.articleRevision.create({
          data: {
            id,
            translationId: "translation-article-1",
            title: "T",
            body: {},
            kind,
            createdById: user.id,
            createdAt: daysBefore(days),
            restoredFromId
          }
        })
      await revision("autosave-old", "autosave", 60)
      await revision("autosave-noted", "autosave", 59)
      await revision("autosave-source", "autosave", 58)
      await revision("autosave-restored", "autosave", 57)
      await revision("manual-old", "manual", 56, "autosave-restored")
      await revision("autosave-recent", "autosave", 10)
      await db.reviewNote.create({
        data: { revisionId: "autosave-noted", blockId: "b1", text: "note", createdById: user.id }
      })
      await db.articleTranslation.update({
        where: { id: "translation-article-1" },
        data: { sourceRevisionId: "autosave-source" }
      })

      // Второй перевод давно не правился: последняя ревизия — старое автосохранение, она остаётся.
      await article("article-2")
      await db.articleRevision.createMany({
        data: [
          {
            id: "dormant-older",
            translationId: "translation-article-2",
            title: "T",
            body: {},
            kind: "autosave",
            createdById: user.id,
            createdAt: daysBefore(90)
          },
          {
            id: "dormant-latest",
            translationId: "translation-article-2",
            title: "T",
            body: {},
            kind: "autosave",
            createdById: user.id,
            createdAt: daysBefore(80)
          }
        ]
      })

      // Ошибки: старая без решений удаляется; старая с историей статусов и свежая — остаются.
      const backendError = (id: string, days: number) => ({
        id,
        signature: id,
        service: "api" as const,
        code: "INTERNAL_ERROR",
        sanitizedMessage: "failure",
        firstSeenAt: daysBefore(days),
        lastSeenAt: daysBefore(days)
      })
      await db.backendError.createMany({
        data: [backendError("error-old", 91), backendError("error-decided", 120), backendError("error-recent", 10)]
      })
      await db.backendErrorStatusHistory.create({
        data: {
          backendErrorId: "error-decided",
          toStatus: "resolved",
          changedByActorId: user.id,
          changedByActorRole: "admin",
          createdAt: daysBefore(119)
        }
      })

      // Неизменяемая история ошибок (T-089): `page.error` живёт 30 дней, остальные события — 90.
      const errorEvent = (id: string, event: string, stream: "backend" | "page", days: number) => ({
        id,
        event,
        stream,
        service: stream === "page" ? "web" : "api",
        code: "INTERNAL_ERROR",
        signature: id,
        occurredAt: daysBefore(days)
      })
      await db.backendErrorEvent.createMany({
        data: [
          errorEvent("page-old", "page.error", "page", 31),
          errorEvent("page-recent", "page.error", "page", 29),
          errorEvent("backend-old", "backend.error", "backend", 91),
          errorEvent("backend-month", "backend.error", "backend", 31)
        ]
      })

      // Аудит старше любого срока.
      await db.auditLog.createMany({
        data: [
          {
            id: "audit-ancient",
            action: "admin.change",
            entityType: "BackendError",
            entityId: "error-decided",
            createdAt: daysBefore(3650)
          },
          {
            id: "audit-session",
            action: "session.revoke",
            entityType: "Session",
            entityId: "session-old",
            createdAt: daysBefore(400)
          }
        ]
      })

      const result = await runHousekeeping(db, NOW)

      expect(result).toEqual({
        sessions: 1,
        magicLinkTokens: 2,
        emailChangeRequests: 1,
        autosaveRevisions: 2,
        backendErrors: 1,
        errorEvents: 2
      })
      expect(await ids(db.session.findMany({ select: { id: true } }))).toEqual(["session-active", "session-recent"])
      expect(await ids(db.magicLinkToken.findMany({ select: { id: true } }))).toEqual(["link-live"])
      expect(await db.emailChangeRequest.count()).toBe(0)
      expect(await ids(db.articleRevision.findMany({ select: { id: true } }))).toEqual(
        [
          "autosave-noted",
          "autosave-recent",
          "autosave-restored",
          "autosave-source",
          "dormant-latest",
          "manual-old",
          "revision-article-1",
          "revision-article-2"
        ].sort()
      )
      expect(await ids(db.backendError.findMany({ select: { id: true } }))).toEqual(["error-decided", "error-recent"])
      expect(await db.backendErrorStatusHistory.count()).toBe(1)
      expect(await ids(db.backendErrorEvent.findMany({ select: { id: true } }))).toEqual([
        "backend-month",
        "page-recent"
      ])
      expect(await ids(db.auditLog.findMany({ select: { id: true } }))).toEqual(["audit-ancient", "audit-session"])

      // Повторный проход ничего не находит.
      expect(await runHousekeeping(db, NOW)).toEqual({
        sessions: 0,
        magicLinkTokens: 0,
        emailChangeRequests: 0,
        autosaveRevisions: 0,
        backendErrors: 0,
        errorEvents: 0
      })
    })
  }, 60_000)
})
