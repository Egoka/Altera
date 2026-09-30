/**
 * T-048: связь AI-проверки с очередью на настоящем PostgreSQL.
 *
 * Двойник хранилища не проверяет ни транзакцию постановки задания, ни ограничение «одна проверка
 * на ревизию», ни то, что обработчик очереди действительно дочитывает подачу из базы. Поэтому
 * путь «постановка → задание → вердикт → запись» проверяется на базе, а не на двойнике.
 *
 * Адрес базы берётся из `T048_TEST_DATABASE_URL`; без переменной набор пропускается.
 */

import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { readDocument, toPlainText } from "@altera/content"
import { PrismaClient } from "../src/generated/prisma"
import { createFakeAiCheckAdapter } from "../src/ai/adapters/fake"
import { createAiCheckJobHandler } from "../src/ai"
import { AI_CHECK_JOB_KIND, createPrismaAiCheckQueue } from "../src/ai/queue"
import { createJobWorker } from "../src/jobs/job-worker"
import { createPrismaJobStore } from "../src/jobs/prisma-job-store"
import type { AppLogger } from "../src/observability/logger"
import { submitTranslation, withdrawTranslation } from "../src/translation/editor"
import { applyAllMigrations } from "./helpers/migration-database"

const testDatabaseUrl = process.env.T048_TEST_DATABASE_URL

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (run: (database: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `t048_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    // Тест идёт через Prisma-клиент действующей схемы, поэтому нужны все миграции, а не срез
    // до `20260928150000_ai_check_result`: иначе клиент ждёт колонок более поздних миграций.
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

/**
 * Материал автора. Версию и первую ревизию создаёт trigger `t015_sync_legacy_article`
 * (T-015, переведён на документ `content` в T-020), поэтому тело статьи здесь — legacy-текст.
 */
const createArticle = async (database: PrismaClient, body: string) => {
  await database.handleHistory.create({ data: { handle: "author" } })
  const author = await database.user.create({
    data: {
      name: "Автор Материала",
      email: "author@example.test",
      handle: "author",
      // Первая подача требует явно сохранённого хэндла (T-031).
      handleConfirmed: true,
      role: "author",
      planTier: "standard"
    }
  })
  const sectionSlug = `culture-${randomUUID()}`
  const section = await database.$transaction(async (tx) => {
    await tx.sectionSlugHistory.create({ data: { slug: sectionSlug } })
    const created = await tx.section.create({
      data: { name: "Культура", slug: sectionSlug, order: 1 }
    })
    await tx.sectionSlugHistory.update({
      where: { slug: sectionSlug },
      data: { ownerSectionId: created.id, redirectToSectionId: created.id }
    })
    return created
  })
  const owner = await database.mediaAsset.create({
    data: {
      ownerId: author.id,
      storageKey: `media/${randomUUID()}`,
      mimeType: "image/webp",
      byteSize: 1024,
      sha256: "a".repeat(64),
      processingStatus: "ready",
      variants: {
        version: 1,
        placeholder: null,
        thumbnailWidth: 480,
        focal: { x: 0.5, y: 0.5 },
        items: [
          {
            format: "webp",
            width: 960,
            height: 480,
            key: `media/${randomUUID()}/lede-w960.webp`,
            byteSize: 1024,
            crop: "lede"
          }
        ]
      },
      focalX: 0.5,
      focalY: 0.5,
      attribution: "Фото: пресс-служба музея",
      license: "own",
      caption: "Ока у Каширы",
      alt: "Река в тумане"
    }
  })
  const article = await database.article.create({
    data: {
      title: "Вечер на Оке",
      slug: `vecher-${randomUUID()}`,
      dek: "Как выглядит река в октябре",
      body,
      authorId: author.id,
      sectionId: section.id,
      coverAssetId: owner.id
    }
  })
  return {
    authorId: author.id,
    coverAssetId: owner.id,
    translationId: `translation-${article.id}`,
    revisionId: `revision-${article.id}`
  }
}

const editorContext = async (database: PrismaClient, authorId: string, logger: AppLogger) =>
  ({
    prisma: database,
    currentUser: await database.user.findUniqueOrThrow({
      where: { id: authorId },
      include: { permissionExceptions: { where: { revokedAt: null } } }
    }),
    requestId: "req-submit",
    logger,
    cache: { delByTags: vi.fn() },
    media: { mediaBaseUrl: "https://media.example" }
  }) as never

describe.skipIf(!testDatabaseUrl)("T-048 AI-проверка в очереди заданий", () => {
  it("постановка задания пишет задание и запись процесса одной транзакцией", async () => {
    await withDatabase(async (database) => {
      const { translationId, revisionId } = await createArticle(database, "Первый абзац подачи.")
      const log = vi.fn<AppLogger["log"]>()

      const enqueued = await createPrismaAiCheckQueue(database, { log }).enqueue({
        translationId,
        revisionId,
        requestId: "req-submit"
      })

      await expect(database.job.findUniqueOrThrow({ where: { id: enqueued.jobId } })).resolves.toMatchObject({
        kind: AI_CHECK_JOB_KIND,
        status: "queued",
        objectType: "ArticleTranslation",
        objectId: translationId,
        originRequestId: "req-submit",
        manualRetryAllowed: true,
        parameters: { translationId, revisionId }
      })
      await expect(
        database.aiProcess.findUniqueOrThrow({ where: { id: enqueued.aiProcessId } })
      ).resolves.toMatchObject({
        jobId: enqueued.jobId,
        kind: "check",
        status: "created",
        objectType: "ArticleTranslation",
        objectId: translationId,
        revisionId,
        verdict: null
      })
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ event: "ai.job.created", jobId: enqueued.jobId, originRequestId: "req-submit" })
      )
    })
  })

  it("обработчик очереди доводит отказ до записи, комментария и аудита", async () => {
    await withDatabase(async (database) => {
      const { translationId, revisionId } = await createArticle(database, "ai-check-fixture: reject illegal spam_ads")
      const log = vi.fn<AppLogger["log"]>()
      const logger: AppLogger = { log }
      const adapter = createFakeAiCheckAdapter()
      await database.articleTranslation.update({ where: { id: translationId }, data: { status: "ai_check" } })
      const enqueued = await createPrismaAiCheckQueue(database, logger).enqueue({
        translationId,
        revisionId,
        requestId: "req-submit"
      })
      const worker = createJobWorker({
        store: createPrismaJobStore(database),
        logger,
        handlers: new Map([[AI_CHECK_JOB_KIND, createAiCheckJobHandler({ client: database, adapter, logger })]])
      })

      await expect(worker.processNext()).resolves.toBe(true)

      await expect(database.job.findUniqueOrThrow({ where: { id: enqueued.jobId } })).resolves.toMatchObject({
        status: "completed"
      })
      const process = await database.aiProcess.findUniqueOrThrow({ where: { id: enqueued.aiProcessId } })
      expect(process).toMatchObject({
        status: "completed",
        verdict: "reject",
        model: "fake-check",
        promptVersion: "fake-1",
        adult: false,
        manipulationAttempt: false
      })
      expect(process.reasons).toEqual([
        { category: "illegal", text: expect.any(String) },
        { category: "spam_ads", text: expect.any(String) }
      ])
      expect(process.durationMs).toBeGreaterThanOrEqual(0)

      const comments = await database.reviewMessage.findMany({ where: { translationId } })
      expect(comments).toHaveLength(1)
      expect(comments[0]).toMatchObject({ kind: "ai_decision", byRole: null })
      expect(comments[0].text).toContain("Незаконный контент")

      await expect(database.auditLog.findMany({ where: { action: "ai.decision" } })).resolves.toMatchObject([
        { entityType: "ArticleTranslation", entityId: translationId, requestId: "req-submit", actorId: null }
      ])
      const aggregates = await database.aiCostAggregate.findMany()
      expect(aggregates).toHaveLength(1)
      expect(aggregates[0]).toMatchObject({ kind: "check", processCount: 1, totalCostMinor: 0n })

      // Подача действительно собрана из базы: текст подачи — документ ревизии, а имени и e-mail
      // автора в ней нет (критерий готовности 2).
      const revision = await database.articleRevision.findUniqueOrThrow({ where: { id: revisionId } })
      expect(adapter.submissions).toHaveLength(1)
      expect(adapter.submissions[0].blocks).toBe(toPlainText(readDocument(revision.body)))
      expect(JSON.stringify(adapter.submissions[0])).not.toContain("author@example.test")
      expect(JSON.stringify(adapter.submissions[0])).not.toContain("Автор Материала")
      expect(adapter.submissions[0].images).toMatchObject([{ role: "cover", license: "own" }])

      // Отказ AI переводит ожидающую проверку в ручную ветку вместе с записанными причинами.
      await expect(
        database.articleTranslation.findUniqueOrThrow({ where: { id: translationId } })
      ).resolves.toMatchObject({ status: "review" })
    })
  })

  it("недоступность провайдера оставляет задание в очереди, а повтор доводит его до вердикта", async () => {
    await withDatabase(async (database) => {
      const { translationId, revisionId } = await createArticle(database, "ai-check-fixture: unavailable")
      const log = vi.fn<AppLogger["log"]>()
      const logger: AppLogger = { log }
      const adapter = createFakeAiCheckAdapter()
      const enqueued = await createPrismaAiCheckQueue(database, logger).enqueue({
        translationId,
        revisionId,
        requestId: "req-submit"
      })
      const worker = createJobWorker({
        store: createPrismaJobStore(database),
        logger,
        handlers: new Map([[AI_CHECK_JOB_KIND, createAiCheckJobHandler({ client: database, adapter, logger })]]),
        retryDelayMs: 0
      })

      await worker.processNext()

      await expect(database.job.findUniqueOrThrow({ where: { id: enqueued.jobId } })).resolves.toMatchObject({
        status: "queued",
        attemptCount: 1
      })
      await expect(
        database.aiProcess.findUniqueOrThrow({ where: { id: enqueued.aiProcessId } })
      ).resolves.toMatchObject({ status: "failed", verdict: null, providerErrorClass: "FakeAiCheckUnavailableError" })
      await expect(database.reviewMessage.count({ where: { translationId } })).resolves.toBe(0)
      await expect(database.auditLog.count({ where: { action: "ai.decision" } })).resolves.toBe(0)

      // Провайдер снова отвечает: вердикт выносится по той же записи, вторая не появляется.
      adapter.setFixture(translationId, { verdict: "publish" })
      await worker.processNext()

      await expect(database.job.findUniqueOrThrow({ where: { id: enqueued.jobId } })).resolves.toMatchObject({
        status: "completed"
      })
      await expect(database.aiProcess.count()).resolves.toBe(1)
      await expect(
        database.aiProcess.findUniqueOrThrow({ where: { id: enqueued.aiProcessId } })
      ).resolves.toMatchObject({ status: "completed", verdict: "publish", providerErrorClass: null })
    })
  })

  it("вторая проверка той же ревизии в базу не попадает", async () => {
    await withDatabase(async (database) => {
      const { translationId, revisionId } = await createArticle(database, "Первый абзац подачи.")
      const queue = createPrismaAiCheckQueue(database, { log: vi.fn() })

      await queue.enqueue({ translationId, revisionId, requestId: "req-1" })

      await expect(queue.enqueue({ translationId, revisionId, requestId: "req-2" })).rejects.toMatchObject({
        code: "P2002"
      })
      await expect(database.aiProcess.count()).resolves.toBe(1)
      // Задание второй постановки тоже не осталось: транзакция откатилась целиком.
      await expect(database.job.count()).resolves.toBe(1)
    })
  })

  it("полный путь подачи публикует ожидающую ревизию и открывает часовое окно", async () => {
    await withDatabase(async (database) => {
      const { authorId, translationId } = await createArticle(database, "Первый абзац подачи.")
      const log = vi.fn<AppLogger["log"]>()
      const metric = vi.fn<NonNullable<AppLogger["metric"]>>()
      const logger: AppLogger = { log, metric }
      const delByTags = vi.fn().mockResolvedValue(undefined)
      const adapter = createFakeAiCheckAdapter()
      const ctx = await editorContext(database, authorId, logger)

      await expect(submitTranslation(ctx, translationId)).resolves.toMatchObject({ status: "ai_check" })
      const worker = createJobWorker({
        store: createPrismaJobStore(database),
        logger,
        handlers: new Map([
          [AI_CHECK_JOB_KIND, createAiCheckJobHandler({ client: database, adapter, logger, cache: { delByTags } })]
        ])
      })
      await expect(worker.processNext()).resolves.toBe(true)

      const translation = await database.articleTranslation.findUniqueOrThrow({ where: { id: translationId } })
      expect(translation.status).toBe("published")
      expect(translation.publishedAt).not.toBeNull()
      expect(translation.reeditUntil?.getTime()).toBe(translation.publishedAt!.getTime() + 60 * 60 * 1000)
      await expect(database.article.findUniqueOrThrow({ where: { id: translation.articleId } })).resolves.toMatchObject(
        {
          status: "published",
          firstPublishedAt: translation.publishedAt
        }
      )
      expect(metric).toHaveBeenCalledWith(
        expect.objectContaining({ event: "translation.published", data: { translationId } })
      )
      expect(delByTags).toHaveBeenCalledWith(expect.arrayContaining(["home"]))
    })
  })

  it("отзыв из ai_check позволяет повторно подать неизменённый текст новой ревизией", async () => {
    await withDatabase(async (database) => {
      const { authorId, translationId } = await createArticle(database, "Первый абзац подачи.")
      const logger: AppLogger = { log: vi.fn() }
      const ctx = await editorContext(database, authorId, logger)

      await expect(submitTranslation(ctx, translationId)).resolves.toMatchObject({ status: "ai_check" })
      await expect(withdrawTranslation(ctx, translationId)).resolves.toMatchObject({ status: "draft" })
      await expect(submitTranslation(ctx, translationId)).resolves.toMatchObject({ status: "ai_check" })

      const processes = await database.aiProcess.findMany({
        where: { objectId: translationId },
        orderBy: { createdAt: "asc" }
      })
      expect(processes).toHaveLength(2)
      expect(processes[0]?.revisionId).not.toBe(processes[1]?.revisionId)
      await expect(database.job.count({ where: { kind: AI_CHECK_JOB_KIND } })).resolves.toBe(2)
    })
  })

  it("после отказа AI повторная подача не создаёт второе задание", async () => {
    await withDatabase(async (database) => {
      const { authorId, translationId } = await createArticle(database, "Первый абзац подачи.")
      const logger: AppLogger = { log: vi.fn() }
      const adapter = createFakeAiCheckAdapter()
      adapter.setFixture(translationId, { verdict: "reject", categories: ["topic_rules"] })
      const ctx = await editorContext(database, authorId, logger)

      await submitTranslation(ctx, translationId)
      const worker = createJobWorker({
        store: createPrismaJobStore(database),
        logger,
        handlers: new Map([[AI_CHECK_JOB_KIND, createAiCheckJobHandler({ client: database, adapter, logger })]])
      })
      await worker.processNext()
      await expect(
        database.articleTranslation.findUniqueOrThrow({ where: { id: translationId } })
      ).resolves.toMatchObject({
        status: "review"
      })

      await withdrawTranslation(ctx, translationId)
      await expect(submitTranslation(ctx, translationId)).resolves.toMatchObject({ status: "review" })
      await expect(database.job.count({ where: { kind: AI_CHECK_JOB_KIND } })).resolves.toBe(1)
      await expect(database.aiProcess.count({ where: { objectId: translationId } })).resolves.toBe(1)
    })
  })
})
