import { randomUUID } from "node:crypto"
import sharp from "sharp"
import { describe, expect, it, vi } from "vitest"
import { PrismaClient } from "../src/generated/prisma"
import { jobHandlers } from "../src/jobs/job-handlers"
import { createJobWorker } from "../src/jobs/job-worker"
import { createPrismaJobStore } from "../src/jobs/prisma-job-store"
import { createMediaProcessingQueue, registerMediaProcessingJob, MEDIA_PROCESS_JOB_KIND } from "../src/media"
import { createSharpImageProcessor } from "../src/media/sharp-processor"
import { readVariantSet } from "../src/media/variants"
import { createPrismaMediaAssetStore, createPrismaTranslationLookup } from "../src/media/store"
import { acceptMediaUpload } from "../src/media/upload"
import { parseStorageKey } from "../src/storage/keys"
import { applyAllMigrations } from "./helpers/migration-database"
import { createMemoryStorage, uploadSourceOf } from "./helpers/media-memory"

// T-063 на настоящем PostgreSQL: статусы конвейера, уникальность ключа и связь с очередью T-047
// держатся на схеме и транзакциях базы, а не на двойнике порта.

const testDatabaseUrl = process.env.T063_TEST_DATABASE_URL

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (run: (database: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `t063_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    applyAllMigrations(url)
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

/** Автор с версией материала: `article_translations` создаёт триггер синхронизации legacy-полей. */
async function seedAuthorWithTranslation(database: PrismaClient) {
  await database.handleHistory.create({ data: { handle: "author-one" } })
  const author = await database.user.create({
    data: {
      name: "Иван Петров",
      email: "author@example.test",
      role: "author",
      handle: "author-one",
      planTier: "standard"
    }
  })
  await database.handleHistory.update({ where: { handle: "author-one" }, data: { userId: author.id } })
  const article = await database.article.create({
    data: {
      title: "Материал с медиа",
      slug: `material-${randomUUID().slice(0, 8)}`,
      body: "Текст материала",
      authorId: author.id
    }
  })
  const translation = await database.articleTranslation.findFirstOrThrow({ where: { articleId: article.id } })
  return { author, article, translation }
}

const photo = () =>
  sharp({ create: { width: 320, height: 240, channels: 3, background: "#336699" } })
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "55/1 45/1 3000/100" } })
    .jpeg()
    .toBuffer()

describe.skipIf(!testDatabaseUrl)("T-063 конвейер загрузки на PostgreSQL 17", () => {
  it("проводит запись через очередь заданий до готового мастера без EXIF", async () => {
    await withDatabase(async (database) => {
      const { author } = await seedAuthorWithTranslation(database)
      const store = createPrismaMediaAssetStore(database)
      const jobStore = createPrismaJobStore(database)
      const storage = createMemoryStorage()
      registerMediaProcessingJob({ store, storage, processor: createSharpImageProcessor() })
      const bytes = await photo()

      const accepted = await acceptMediaUpload(
        {
          ownerId: author.id,
          file: uploadSourceOf(bytes),
          license: "own",
          attribution: "Иван Петров",
          requestId: "request-db"
        },
        { store, storage, queue: createMediaProcessingQueue(jobStore) }
      )

      expect(accepted.processingStatus).toBe("queued")
      expect(parseStorageKey(accepted.storageKey)?.kind).toBe("quarantine")
      const job = await database.job.findFirstOrThrow({ where: { kind: MEDIA_PROCESS_JOB_KIND } })
      expect(job).toMatchObject({ status: "queued", objectType: "mediaAsset", objectId: accepted.id })
      expect(job.originRequestId).toBe("request-db")

      const worker = createJobWorker({ store: jobStore, handlers: jobHandlers, logger: { log: vi.fn() } })
      expect(await worker.processNext()).toBe(true)

      const processed = await database.mediaAsset.findUniqueOrThrow({ where: { id: accepted.id } })
      expect(processed.processingStatus).toBe("ready")
      expect(parseStorageKey(processed.storageKey)?.kind).toBe("master")
      // Ориентация применена: стороны поменялись местами относительно загрузки.
      expect([processed.width, processed.height]).toEqual([240, 320])
      expect((await sharp(storage.objects.get(processed.storageKey)!.body).metadata()).exif).toBeUndefined()
      // T-064: набор вариантов доезжает до JSONB-колонки, а не остаётся в памяти процесса.
      const variants = readVariantSet(processed.variants)
      expect(variants.items.map((item) => `${item.format}:${item.width}`)).toEqual(["avif:240", "webp:240"])
      expect(variants.placeholder).toMatch(/^data:image\/webp;base64,/)
      expect(variants.items.every((item) => storage.objects.has(item.key))).toBe(true)
      expect(await database.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "completed" })
    })
  }, 60_000)

  it("дедупликация по sha256 владельца не создаёт вторую запись и второй объект", async () => {
    await withDatabase(async (database) => {
      const { author } = await seedAuthorWithTranslation(database)
      const store = createPrismaMediaAssetStore(database)
      const jobStore = createPrismaJobStore(database)
      const storage = createMemoryStorage()
      const deps = { store, storage, queue: createMediaProcessingQueue(jobStore) }
      const bytes = await photo()
      const input = {
        ownerId: author.id,
        file: uploadSourceOf(bytes),
        license: "own" as const,
        attribution: "Иван Петров",
        requestId: "request-db"
      }

      const first = await acceptMediaUpload(input, deps)
      const second = await acceptMediaUpload(input, deps)

      expect(second.id).toBe(first.id)
      expect(await database.mediaAsset.count()).toBe(1)
      expect(await database.job.count({ where: { kind: MEDIA_PROCESS_JOB_KIND } })).toBe(1)
      expect(storage.objects.size).toBe(1)
    })
  }, 60_000)

  it("отдаёт владельца версии и признак редакционного материала", async () => {
    await withDatabase(async (database) => {
      const { author, article, translation } = await seedAuthorWithTranslation(database)
      const lookup = createPrismaTranslationLookup(database)

      await expect(lookup.findTranslationOwner(translation.id)).resolves.toEqual({
        translationId: translation.id,
        authorId: author.id,
        isEditorial: false
      })
      await expect(lookup.findTranslationOwner(randomUUID())).resolves.toBeNull()

      await database.article.update({ where: { id: article.id }, data: { isEditorial: true } })
      await expect(lookup.findTranslationOwner(translation.id)).resolves.toMatchObject({ isEditorial: true })
    })
  }, 60_000)
})
