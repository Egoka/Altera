/**
 * Двойник хранилища шага AI-описания: записи AI-процессов и агрегаты стоимости в памяти.
 *
 * Медиафайлы двойник не дублирует — он читает и пишет ту же карту записей, что и
 * `createMemoryMediaStore`. Так один тест проходит весь путь: загрузка → обработка → описание.
 */

import type { AiAltStore } from "../../src/ai/alt/store"
import type { MediaAssetRecord } from "../../src/media/types"

export interface StoredAltProcess {
  id: string
  jobId: string
  kind: string
  status: string
  objectType: string
  objectId: string
  model: string | null
  promptVersion: string | null
  providerErrorClass: string | null
  startedAt: Date | null
  finishedAt: Date | null
  durationMs: number | null
}

export interface StoredAltCostAggregate {
  bucketStart: Date
  bucketEnd: Date
  kind: string
  totalCostMinor: bigint
  processCount: number
}

export interface AiAltMemoryStore {
  store: AiAltStore
  processes: Map<string, StoredAltProcess>
  aggregates: StoredAltCostAggregate[]
}

interface UpsertArgs {
  where: { bucketStart_bucketEnd_kind: { bucketStart: Date; bucketEnd: Date; kind: string } }
  create: StoredAltCostAggregate
  update: { totalCostMinor: { increment: bigint }; processCount: { increment: number } }
}

export function createAiAltMemoryStore(records: Map<string, MediaAssetRecord>): AiAltMemoryStore {
  const processes = new Map<string, StoredAltProcess>()
  const aggregates: StoredAltCostAggregate[] = []

  function requireProcess(id: string): StoredAltProcess {
    const process = processes.get(id)
    if (!process) throw new Error(`ai process not found: ${id}`)
    return process
  }

  const writer = {
    aiProcess: {
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        Object.assign(requireProcess(where.id), data)
        return { id: where.id }
      }
    },
    aiCostAggregate: {
      async upsert({ where, create, update }: UpsertArgs) {
        const key = where.bucketStart_bucketEnd_kind
        const existing = aggregates.find(
          (row) =>
            row.kind === key.kind &&
            row.bucketStart.getTime() === key.bucketStart.getTime() &&
            row.bucketEnd.getTime() === key.bucketEnd.getTime()
        )
        if (!existing) {
          aggregates.push({ ...create })
          return { id: `aggregate-${aggregates.length}` }
        }
        existing.totalCostMinor += update.totalCostMinor.increment
        existing.processCount += update.processCount.increment
        return { id: "aggregate-existing" }
      }
    },
    mediaAsset: {
      // Условное обновление как в базе: запись с непустым `alt` под `where` не попадает.
      async updateMany({ where, data }: { where: { id: string; alt: null }; data: { alt: string } }) {
        const record = records.get(where.id)
        if (!record || record.alt !== null) return { count: 0 }
        records.set(where.id, { ...record, alt: data.alt })
        return { count: 1 }
      }
    }
  }

  const store = {
    async findAsset(assetId: string) {
      const record = records.get(assetId)
      if (!record) return null
      return {
        id: record.id,
        alt: record.alt,
        storageKey: record.storageKey,
        mimeType: record.mimeType,
        width: record.width,
        height: record.height,
        processingStatus: record.processingStatus,
        deletedAt: record.deletedAt
      }
    },

    async findProcessByJob(jobId: string) {
      for (const process of processes.values()) {
        if (process.jobId === jobId && process.kind === "alt") return { id: process.id, status: process.status }
      }
      return null
    },

    async createProcess(input: { jobId: string; assetId: string }) {
      const process: StoredAltProcess = {
        id: `ai-alt-${processes.size + 1}`,
        jobId: input.jobId,
        kind: "alt",
        status: "created",
        objectType: "mediaAsset",
        objectId: input.assetId,
        model: null,
        promptVersion: null,
        providerErrorClass: null,
        startedAt: null,
        finishedAt: null,
        durationMs: null
      }
      processes.set(process.id, process)
      return { id: process.id, status: process.status }
    },

    async updateProcess(processId: string, data: Record<string, unknown>) {
      Object.assign(requireProcess(processId), data)
    },

    writeResult(run: (target: typeof writer) => Promise<unknown>) {
      return run(writer)
    }
  }

  return { store: store as unknown as AiAltStore, processes, aggregates }
}

/** Задания описания в памяти: постановка и ручной прогон, без исполнителя и без базы. */
export function createMemoryAltQueue() {
  const jobs: { assetId: string; requestId: string | null }[] = []
  return {
    jobs,
    queue: {
      async enqueue(input: { assetId: string; requestId: string | null }) {
        jobs.push(input)
      }
    }
  }
}
