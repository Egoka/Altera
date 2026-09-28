/**
 * T-067: AI-описание `alt` создаётся один раз после обработки изображения и хранится только в
 * свойствах медиафайла (журнал §29.11, §29.13, `85-media-and-binary/upload-pipeline.md` п. 6а).
 *
 * Здесь проверяются объём задания и адаптера: постановка задания конвейером, однократность
 * описания, запись AI-процесса и агрегата стоимости, недоступность провайдера как повторяемая
 * ошибка задания и выбор реализации по окружению.
 */

import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it } from "vitest"
import { KNOWN_JOB_KINDS } from "../src/admin/jobs"
import { createAiAltAdapterFromEnv } from "../src/ai/alt/config"
import { createFakeAiAltAdapter, type FakeAiAltAdapter } from "../src/ai/alt/adapters/fake"
import { AiAltProviderNotConfiguredError } from "../src/ai/alt/adapters/unavailable"
import { AI_ALT_JOB_KIND, AI_ALT_OBJECT_TYPE, parseAiAltJobParameters } from "../src/ai/alt/queue"
import { createAiAltService } from "../src/ai/alt/service"
import { runMediaProcessing } from "../src/media/pipeline"
import { acceptMediaUpload, type MediaUploadDeps } from "../src/media/upload"
import { LOG_EVENT_CODES } from "../src/observability/log-events"
import type { AppLogger, LogEntry } from "../src/observability/logger"
import { createAiAltMemoryStore, createMemoryAltQueue } from "./helpers/ai-alt-memory-store"
import {
  createFakeImageProcessor,
  createMemoryMediaQueue,
  createMemoryMediaStore,
  createMemoryStorage,
  uploadSourceOf,
  type MemoryMediaStore,
  type MemoryStorage
} from "./helpers/media-memory"

const OWNER = "user-author"
const REQUEST = "request-alt"

const jpegBytes = (marker: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(marker)])

function createLogCollector() {
  const entries: LogEntry[] = []
  const logger: AppLogger = { log: (entry) => void entries.push(entry) }
  return { logger, entries }
}

describe("T-067 AI-описание изображения", () => {
  let store: MemoryMediaStore
  let storage: MemoryStorage
  let processJobs: ReturnType<typeof createMemoryMediaQueue>
  let altJobs: ReturnType<typeof createMemoryAltQueue>
  let uploadDeps: MediaUploadDeps
  let processor: ReturnType<typeof createFakeImageProcessor>
  let adapter: FakeAiAltAdapter
  let altStore: ReturnType<typeof createAiAltMemoryStore>
  let entries: LogEntry[]
  let service: ReturnType<typeof createAiAltService>
  let assetId: string

  beforeEach(() => {
    store = createMemoryMediaStore()
    storage = createMemoryStorage()
    processJobs = createMemoryMediaQueue()
    altJobs = createMemoryAltQueue()
    processor = createFakeImageProcessor()
    adapter = createFakeAiAltAdapter()
    altStore = createAiAltMemoryStore(store.records)
    assetId = randomUUID()
    uploadDeps = { store, storage, queue: processJobs.queue, newAssetId: () => assetId }

    const collector = createLogCollector()
    entries = collector.entries
    let tick = 0
    service = createAiAltService({
      store: altStore.store,
      storage,
      adapter,
      logger: collector.logger,
      // Часы шагают на секунду за вызов: длительность записи становится проверяемой величиной.
      now: () => new Date(Date.UTC(2026, 8, 28, 12, 0, tick++))
    })
  })

  /** Загрузка и обработка до `ready` — состояние, в котором появляется задание описания. */
  const uploadAndProcess = async (marker = "photo") => {
    await acceptMediaUpload(
      {
        ownerId: OWNER,
        file: uploadSourceOf(jpegBytes(marker)),
        license: "own",
        attribution: "Иван Петров",
        requestId: REQUEST
      },
      uploadDeps
    )
    return runMediaProcessing(
      assetId,
      { store, storage, processor: processor.processor, altQueue: altJobs.queue },
      { originRequestId: REQUEST }
    )
  }

  it("вид задания и коды событий уже утверждены реестрами", () => {
    expect(KNOWN_JOB_KINDS).toContain(AI_ALT_JOB_KIND)
    for (const code of ["ai.job.created", "ai.job.started", "ai.job.running", "ai.job.done", "ai.job.failed"]) {
      expect(LOG_EVENT_CODES).toContain(code)
    }
    expect(parseAiAltJobParameters({ assetId: "asset-1" })).toEqual({ assetId: "asset-1" })
    expect(() => parseAiAltJobParameters({})).toThrow()
  })

  it("задание описания ставится после обработки изображения, а не при приёме файла", async () => {
    await acceptMediaUpload(
      {
        ownerId: OWNER,
        file: uploadSourceOf(jpegBytes("photo")),
        license: "own",
        attribution: "Иван Петров",
        requestId: REQUEST
      },
      uploadDeps
    )
    expect(altJobs.jobs).toEqual([])

    const outcome = await runMediaProcessing(
      assetId,
      { store, storage, processor: processor.processor, altQueue: altJobs.queue },
      { originRequestId: REQUEST }
    )

    expect(outcome).toMatchObject({ result: "ready" })
    expect(altJobs.jobs).toEqual([{ assetId, requestId: REQUEST }])
  })

  it("описание сохраняется в `alt` медиафайла с записью процесса и агрегатом стоимости", async () => {
    await uploadAndProcess()
    adapter.setFixture(assetId, { alt: "Река в тумане у деревянного моста" })

    const outcome = await service.describe({ jobId: "job-alt-1", assetId, originRequestId: REQUEST })

    expect(outcome).toEqual({
      aiProcessId: expect.any(String),
      result: "described",
      alt: "Река в тумане у деревянного моста"
    })
    expect(store.records.get(assetId)?.alt).toBe("Река в тумане у деревянного моста")

    const process = altStore.processes.get((outcome as { aiProcessId: string }).aiProcessId)
    expect(process).toMatchObject({
      kind: "alt",
      status: "completed",
      objectType: AI_ALT_OBJECT_TYPE,
      objectId: assetId,
      model: "fake-alt",
      promptVersion: "fake-1"
    })
    expect(process?.durationMs).toBeGreaterThan(0)

    // Стоимость живёт только в агрегате периода: у записи процесса её поля нет (журнал §27.4).
    expect(altStore.aggregates).toEqual([
      {
        bucketStart: new Date("2026-09-28T00:00:00.000Z"),
        bucketEnd: new Date("2026-09-29T00:00:00.000Z"),
        kind: "alt",
        totalCostMinor: 0n,
        processCount: 1
      }
    ])
    expect(process).not.toHaveProperty("costMinor")
  })

  it("модель получает байты мастера, а не исходной загрузки с метаданными", async () => {
    await uploadAndProcess()

    await service.describe({ jobId: "job-alt-1", assetId })

    const record = store.records.get(assetId)!
    expect(adapter.described).toHaveLength(1)
    expect(adapter.described[0]).toMatchObject({ assetId, mimeType: record.mimeType })
    expect(adapter.described[0].body.toString()).toBe("master-bytes")
  })

  it("описание создаётся один раз: у записи с непустым `alt` провайдер не вызывается", async () => {
    await uploadAndProcess()
    await service.describe({ jobId: "job-alt-1", assetId })
    const first = store.records.get(assetId)?.alt

    adapter.setFixture(assetId, { alt: "Другое описание" })
    const second = await service.describe({ jobId: "job-alt-2", assetId })

    expect(second).toMatchObject({ result: "already_described" })
    expect(store.records.get(assetId)?.alt).toBe(first)
    expect(adapter.described).toHaveLength(1)
    expect(altStore.aggregates[0]?.processCount).toBe(1)
  })

  it("повтор того же задания второго описания не создаёт", async () => {
    await uploadAndProcess()
    const first = await service.describe({ jobId: "job-alt-1", assetId })
    const repeat = await service.describe({ jobId: "job-alt-1", assetId })

    expect(repeat).toEqual({ aiProcessId: first.aiProcessId, result: "already_described" })
    expect(altStore.processes.size).toBe(1)
  })

  it("готовая запись без описания получает задание и на повторном проходе конвейера", async () => {
    await uploadAndProcess()
    altJobs.jobs.length = 0

    const outcome = await runMediaProcessing(assetId, {
      store,
      storage,
      processor: processor.processor,
      altQueue: altJobs.queue
    })

    expect(outcome).toEqual({ result: "already_ready" })
    expect(altJobs.jobs).toEqual([{ assetId, requestId: null }])
  })

  it("запись с описанием задания больше не получает", async () => {
    await uploadAndProcess()
    await service.describe({ jobId: "job-alt-1", assetId })
    altJobs.jobs.length = 0

    await runMediaProcessing(assetId, { store, storage, processor: processor.processor, altQueue: altJobs.queue })

    expect(altJobs.jobs).toEqual([])
  })

  it("недоступный провайдер даёт PROVIDER_UNAVAILABLE и оставляет `alt` пустым", async () => {
    await uploadAndProcess()
    adapter.setFixture(assetId, { unavailable: true })

    await expect(service.describe({ jobId: "job-alt-1", assetId, originRequestId: REQUEST })).rejects.toMatchObject({
      extensions: { code: "PROVIDER_UNAVAILABLE", provider: "ai" }
    })

    expect(store.records.get(assetId)?.alt).toBeNull()
    const process = [...altStore.processes.values()][0]
    expect(process).toMatchObject({ status: "failed", providerErrorClass: "FakeAiAltUnavailableError" })
    expect(altStore.aggregates).toEqual([])
    expect(entries.filter((entry) => entry.event === "ai.job.failed")).toHaveLength(1)
  })

  it("удалённую запись задание завершает, а не повторяет бесконечно", async () => {
    await uploadAndProcess()
    const record = store.records.get(assetId)!
    store.records.set(assetId, { ...record, deletedAt: new Date("2026-09-28T11:00:00.000Z") })

    const outcome = await service.describe({ jobId: "job-alt-1", assetId })

    expect(outcome).toMatchObject({ result: "skipped", reason: "deleted" })
    expect(adapter.described).toEqual([])
    expect([...altStore.processes.values()][0]).toMatchObject({ status: "completed" })
  })

  it("необработанный файл не уходит провайдеру: описывается только мастер", async () => {
    await acceptMediaUpload(
      {
        ownerId: OWNER,
        file: uploadSourceOf(jpegBytes("photo")),
        license: "own",
        attribution: "Иван Петров",
        requestId: REQUEST
      },
      uploadDeps
    )

    await expect(service.describe({ jobId: "job-alt-1", assetId })).rejects.toThrow(/not processed/)
    expect(adapter.described).toEqual([])
    expect([...altStore.processes.values()][0]).toMatchObject({
      status: "failed",
      providerErrorClass: "MediaNotProcessedError"
    })
  })

  it("логи задания идут кодами #46 с `kind: alt` и `assetId`", async () => {
    await uploadAndProcess()
    await service.describe({ jobId: "job-alt-1", assetId, originRequestId: REQUEST })

    const events = entries.map((entry) => entry.event)
    expect(events).toEqual(["ai.job.started", "ai.job.running", "ai.job.done"])
    for (const entry of entries) {
      expect(entry.data).toMatchObject({ kind: "alt", assetId })
      expect(entry.originRequestId).toBe(REQUEST)
    }
    expect(entries.at(-1)?.data).toMatchObject({ model: "fake-alt", promptVersion: "fake-1", costMinor: 0 })
  })

  it("реализация выбирается окружением: вне разработки описание не выдумывается", async () => {
    expect(createAiAltAdapterFromEnv({}).name).toBe("fake")
    expect(createAiAltAdapterFromEnv({ NODE_ENV: "production" }).name).toBe("unavailable")
    expect(() => createAiAltAdapterFromEnv({ NODE_ENV: "production", AI_ALT_ADAPTER: "fake" })).toThrow()
    expect(() => createAiAltAdapterFromEnv({ AI_ALT_ADAPTER: "real" })).toThrow(/not implemented/)
    expect(() => createAiAltAdapterFromEnv({ AI_ALT_ADAPTER: "yandex" })).toThrow(/Unknown/)

    const unavailable = createAiAltAdapterFromEnv({ AI_ALT_ADAPTER: "unavailable" })
    await expect(
      unavailable.describe({ assetId, mimeType: "image/jpeg", width: 1, height: 1, body: Buffer.alloc(0) })
    ).rejects.toBeInstanceOf(AiAltProviderNotConfiguredError)
  })

  it("аватар описания не получает: его `alt` нигде не выводится", async () => {
    // Аватар идёт тем же конвейером синхронно и без очереди описания (`media/avatars.ts`).
    await acceptMediaUpload(
      {
        ownerId: OWNER,
        file: uploadSourceOf(jpegBytes("photo")),
        license: "own",
        attribution: "Иван Петров",
        requestId: REQUEST
      },
      uploadDeps
    )
    const outcome = await runMediaProcessing(assetId, { store, storage, processor: processor.processor })

    expect(outcome).toMatchObject({ result: "ready" })
    expect(altJobs.jobs).toEqual([])
  })
})
