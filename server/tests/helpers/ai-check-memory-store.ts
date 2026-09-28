/**
 * Двойник хранилища AI-проверки: одна версия статьи, одна ревизия и её медиафайлы в памяти.
 *
 * Двойник повторяет только те вызовы, которые делает сервис проверки (`src/ai/store.ts`),
 * и собирает всё записанное, чтобы тест проверял результат, а не порядок вызовов.
 */

import type { AiCheckStore } from "../../src/ai/store"

export interface StoredAiProcess {
  id: string
  jobId: string
  kind: string
  status: string
  objectType: string
  objectId: string
  revisionId: string | null
  model: string | null
  promptVersion: string | null
  verdict: string | null
  reasons: unknown
  evidence: unknown
  adult: boolean
  manipulationAttempt: boolean
  providerErrorClass: string | null
  startedAt: Date | null
  finishedAt: Date | null
  durationMs: number | null
}

export interface StoredCostAggregate {
  bucketStart: Date
  bucketEnd: Date
  kind: string
  totalCostMinor: bigint
  processCount: number
}

export interface StoredReviewMessage {
  id: string
  translationId: string
  kind: string
  text: string | null
  byRole: string | null
}

export interface StoredAuditEntry {
  action: string
  entityType: string
  entityId: string
  diff: Record<string, unknown>
  requestId: string | null
}

export interface AiCheckMediaFixture {
  id: string
  alt: string | null
  caption: string | null
  attribution: string
  license: string
  licenseNote: string | null
}

/** Данные подачи. Тест меняет поля на месте: ссылку держит и двойник, и сам тест. */
export interface AiCheckStoreFixture {
  translationId: string
  revisionId: string
  locale: "ru" | "en"
  title: string
  dek: string | null
  body: unknown
  sectionSlug: string | null
  tags: string[]
  coverAssetId: string | null
  media: AiCheckMediaFixture[]
}

export interface AiCheckMemoryStore {
  store: AiCheckStore
  fixture: AiCheckStoreFixture
  processes: Map<string, StoredAiProcess>
  aggregates: StoredCostAggregate[]
  reviewMessages: StoredReviewMessage[]
  audit: StoredAuditEntry[]
}

interface UpsertArgs {
  where: { bucketStart_bucketEnd_kind: { bucketStart: Date; bucketEnd: Date; kind: string } }
  create: StoredCostAggregate
  update: { totalCostMinor: { increment: bigint }; processCount: { increment: number } }
}

export function createAiCheckMemoryStore(fixture: AiCheckStoreFixture): AiCheckMemoryStore {
  const processes = new Map<string, StoredAiProcess>()
  const aggregates: StoredCostAggregate[] = []
  const reviewMessages: StoredReviewMessage[] = []
  const audit: StoredAuditEntry[] = []

  function requireProcess(id: string): StoredAiProcess {
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
    reviewMessage: {
      async create({ data }: { data: { translationId: string; kind: string; text?: string; byRole?: string } }) {
        const message: StoredReviewMessage = {
          id: `review-${reviewMessages.length + 1}`,
          translationId: data.translationId,
          kind: data.kind,
          text: data.text ?? null,
          byRole: data.byRole ?? null
        }
        reviewMessages.push(message)
        return { id: message.id }
      }
    },
    auditLog: {
      async create({ data }: { data: Omit<StoredAuditEntry, "requestId"> & { requestId?: string } }) {
        audit.push({ ...data, requestId: data.requestId ?? null })
        return { id: `audit-${audit.length}` }
      }
    }
  }

  const store = {
    articleTranslation: {
      async findUnique({ where }: { where: { id: string } }) {
        if (where.id !== fixture.translationId) return null
        return {
          id: fixture.translationId,
          locale: fixture.locale,
          title: fixture.title,
          dek: fixture.dek,
          article: {
            coverAssetId: fixture.coverAssetId,
            section: fixture.sectionSlug ? { slug: fixture.sectionSlug } : null,
            tags: fixture.tags.map((slug) => ({ slug }))
          }
        }
      }
    },
    articleRevision: {
      async findFirst({ where }: { where: { id: string; translationId: string } }) {
        if (where.id !== fixture.revisionId || where.translationId !== fixture.translationId) return null
        return { id: fixture.revisionId, title: fixture.title, dek: fixture.dek, body: fixture.body }
      }
    },
    mediaAsset: {
      async findMany({ where }: { where: { id: { in: string[] } } }) {
        return fixture.media.filter((asset) => where.id.in.includes(asset.id))
      }
    },

    async findProcessByJob(jobId: string) {
      for (const process of processes.values()) {
        if (process.jobId === jobId && process.kind === "check") return { id: process.id, status: process.status }
      }
      return null
    },

    async createProcess(input: { jobId: string; translationId: string; revisionId: string }) {
      const process: StoredAiProcess = {
        id: `ai-${processes.size + 1}`,
        jobId: input.jobId,
        kind: "check",
        status: "created",
        objectType: "ArticleTranslation",
        objectId: input.translationId,
        revisionId: input.revisionId,
        model: null,
        promptVersion: null,
        verdict: null,
        reasons: null,
        evidence: null,
        adult: false,
        manipulationAttempt: false,
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

  return { store: store as unknown as AiCheckStore, fixture, processes, aggregates, reviewMessages, audit }
}
