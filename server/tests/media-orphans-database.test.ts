import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { PrismaClient } from "../src/generated/prisma"
import { runMediaPurge, orphanObjectKeys, type MediaOrphanRecord } from "../src/media/orphans"
import { createPrismaMediaOrphanStore } from "../src/media/store"
import { masterKey, variantKey } from "../src/storage/keys"
import { applyBaselineMigrations } from "./helpers/migration-database"
import { createMemoryStorage } from "./helpers/media-memory"

/**
 * Выборка сирот на настоящем PostgreSQL: условие «нет активных связей» написано на SQL и ищет
 * ссылку `figure.attrs.assetId` внутри JSONB-тела языковой версии и ревизии — двойник такого
 * запроса не проверяет. Здесь же проверяются оба критерия T-068: медиа архивированной статьи в
 * выборку не попадает, а чистка сироты не добавляет ни одного письма в историю.
 * Запускается при заданном `T068_TEST_DATABASE_URL`.
 */
const testDatabaseUrl = process.env.T068_TEST_DATABASE_URL
// Имя старше любого каталога миграций: применяются все миграции по порядку.
const afterAllMigrations = "99999999999999_after_all"

const NOW = new Date("2026-09-28T12:00:00.000Z")
const LONG_AGO = new Date("2026-09-01T00:00:00.000Z")

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (run: (database: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `t068_${randomUUID().replace(/-/g, "")}`
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

/** Документ материала со вставленным изображением — той же формы, что пишет редактор. */
const documentWith = (assetId: string) => ({
  type: "doc",
  attrs: { schemaVersion: 1 },
  content: [{ type: "figure", attrs: { id: randomUUID(), assetId, size: "normal" } }]
})

describe.skipIf(!testDatabaseUrl)("T-068 медиа-сироты на PostgreSQL", () => {
  it("удаляет только медиа без активных связей и не создаёт писем", async () => {
    await withDatabase(async (db) => {
      await db.handleHistory.createMany({ data: [{ handle: "author-1" }, { handle: "author-2" }] })
      const author = await db.user.create({
        data: { email: "author@example.test", name: "Author", handle: "author-1", role: "author" }
      })
      const reader = await db.user.create({
        data: { email: "reader@example.test", name: "Reader", handle: "author-2", role: "reader" }
      })

      const asset = async (options: { deletedAt?: Date; quiet?: boolean } = {}) => {
        const id = randomUUID()
        const timestamps = options.quiet === false ? NOW : LONG_AGO
        return db.mediaAsset.create({
          data: {
            id,
            ownerId: author.id,
            processingStatus: "ready",
            storageKey: masterKey({ assetId: id, createdAt: LONG_AGO, extension: "jpg" }),
            mimeType: "image/jpeg",
            byteSize: 1_000,
            sha256: randomUUID().replace(/-/g, "").repeat(2),
            attribution: "Автор",
            license: "own",
            deletedAt: options.deletedAt ?? null,
            variants: {
              version: 1,
              placeholder: null,
              thumbnailWidth: 480,
              focal: null,
              items: [
                {
                  format: "webp",
                  width: 480,
                  height: 320,
                  key: variantKey({ assetId: id, createdAt: LONG_AGO, width: 480, format: "webp" }),
                  byteSize: 500
                }
              ]
            },
            createdAt: timestamps,
            updatedAt: timestamps
          },
          select: { id: true, storageKey: true, byteSize: true, variants: true }
        })
      }

      // Сироты: ничем не связанное медиа и медиа, отвязанное от материала пометкой `deletedAt`.
      const unused = await asset()
      const unlinked = await asset({ deletedAt: LONG_AGO })
      // Связанное медиа: обложка и узел документа архивированной статьи, ссылка из старой
      // ревизии, текущий и прежний аватар.
      const archivedCover = await asset()
      const archivedBody = await asset()
      const revisionOnly = await asset({ deletedAt: LONG_AGO })
      const currentAvatar = await asset()
      const previousAvatar = await asset()
      // Только что загруженное медиа: связей ещё нет, но окно тишины не прошло.
      const fresh = await asset({ quiet: false })

      // Триггер t015 создаёт при вставке статьи перевод `translation-<id>`; тело переводу
      // задаётся отдельно — редактор пишет документ, а не legacy-строку.
      await db.article.create({
        data: {
          id: "article-archived",
          title: "Архив",
          slug: "article-archived",
          body: "",
          authorId: author.id,
          status: "archived",
          archivedAt: LONG_AGO,
          coverAssetId: archivedCover.id
        }
      })
      await db.articleTranslation.update({
        where: { id: "translation-article-archived" },
        data: { body: documentWith(archivedBody.id) }
      })
      // Медиа, на которое ссылается только хранимая ревизия (`retention-and-orphans.md` §2 п. 7).
      await db.articleRevision.create({
        data: {
          translationId: "translation-article-archived",
          title: "Архив",
          body: documentWith(revisionOnly.id),
          kind: "manual",
          createdById: author.id,
          createdAt: LONG_AGO
        }
      })
      await db.user.update({ where: { id: author.id }, data: { avatarAssetId: currentAvatar.id } })
      await db.user.update({ where: { id: reader.id }, data: { prevAvatarId: previousAvatar.id } })

      // История писем до чистки: уведомления об очистке в ней появиться не должны (§29.8).
      await db.mailMessage.create({
        data: {
          template: "magic-link",
          recipientEmail: "author@example.test",
          subject: "Вход",
          sanitizedBody: "ссылка",
          status: "sent"
        }
      })

      const storage = createMemoryStorage()
      const all = [unused, unlinked, archivedCover, archivedBody, revisionOnly, currentAvatar, previousAvatar, fresh]
      for (const record of all) {
        for (const key of orphanObjectKeys(record as MediaOrphanRecord)) {
          await storage.put(key, Buffer.from("x"), { contentType: "image/jpeg" })
        }
      }

      const result = await runMediaPurge({
        store: createPrismaMediaOrphanStore(db),
        storage,
        now: () => NOW
      })

      expect(result).toEqual({ removed: 2, bytes: 3_000, failed: 0, failure: null })
      const left = (await db.mediaAsset.findMany({ select: { id: true } })).map(({ id }) => id).sort()
      expect(left).toEqual(
        [archivedCover.id, archivedBody.id, revisionOnly.id, currentAvatar.id, previousAvatar.id, fresh.id].sort()
      )
      // Файлы сирот убраны, файлы связанного медиа — на месте.
      for (const key of orphanObjectKeys(unused as MediaOrphanRecord)) expect(storage.objects.has(key)).toBe(false)
      for (const key of orphanObjectKeys(unlinked as MediaOrphanRecord)) expect(storage.objects.has(key)).toBe(false)
      expect(storage.objects.has(archivedCover.storageKey)).toBe(true)
      expect(storage.objects.has(archivedBody.storageKey)).toBe(true)
      expect(storage.objects.has(revisionOnly.storageKey)).toBe(true)

      // История писем не изменилась: чистка сироты автора не уведомляет.
      expect(await db.mailMessage.count()).toBe(1)
      expect(await db.mailMessage.count({ where: { objectType: "mediaAsset" } })).toBe(0)
    })
  }, 120_000)
})
