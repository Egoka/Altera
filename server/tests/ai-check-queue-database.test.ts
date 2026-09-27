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
import { applyBaselineMigrations, applyMigration } from "./helpers/migration-database"

const testDatabaseUrl = process.env.T048_TEST_DATABASE_URL
const targetMigration = "20260928150000_ai_check_result"

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
    applyBaselineMigrations(targetMigration, url)
    const migration = applyMigration(targetMigration, url)
    expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)
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
    data: { name: "Автор Материала", email: "author@example.test", handle: "author" }
  })
  const owner = await database.mediaAsset.create({
    data: {
      ownerId: author.id,
      storageKey: `media/${randomUUID()}`,
      mimeType: "image/webp",
      byteSize: 1024,
      sha256: "a".repeat(64),
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

      // Статус версии остаётся прежним: переходы — T-049.
      await expect(
        database.articleTranslation.findUniqueOrThrow({ where: { id: translationId } })
      ).resolves.toMatchObject({ status: "draft" })
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
})
