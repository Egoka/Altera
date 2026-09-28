import type { MediaProcessingStatus } from "../../src/generated/prisma"
import type { CreateMediaAssetInput, MediaAssetRecord, MediaAssetStore, SaveMasterInput } from "../../src/media/types"
import {
  assertStorageKey,
  StorageUnavailableError,
  type ObjectStorage,
  type StoredObject
} from "../../src/storage/types"

/**
 * Записи медиа в памяти одного теста — двойник порта `MediaAssetStore`. Семантика та же, что у
 * Prisma: `storageKey` уникален, статусы и мастер переписывают только свои поля.
 */
export interface MemoryMediaStore extends MediaAssetStore {
  readonly records: Map<string, MediaAssetRecord>
  /** Порядок статусов, через которые прошла запись — для проверки достижимости состояний. */
  statusHistory(id: string): readonly MediaProcessingStatus[]
}

export function createMemoryMediaStore(options: { now?: () => Date } = {}): MemoryMediaStore {
  const now = options.now ?? (() => new Date("2026-09-28T10:00:00.000Z"))
  const records = new Map<string, MediaAssetRecord>()
  const history = new Map<string, MediaProcessingStatus[]>()

  const track = (id: string, status: MediaProcessingStatus): void => {
    history.set(id, [...(history.get(id) ?? []), status])
  }

  const mustFind = (id: string): MediaAssetRecord => {
    const record = records.get(id)
    if (!record) throw new Error(`Media asset not found: ${id}`)
    return record
  }

  return {
    records,

    statusHistory(id) {
      return history.get(id) ?? []
    },

    async findById(id) {
      return records.get(id) ?? null
    },

    async findByChecksum({ ownerId, sha256 }) {
      const found = [...records.values()]
        .filter((record) => record.ownerId === ownerId && record.sha256 === sha256 && !record.deletedAt)
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      return found[0] ?? null
    },

    async create(input: CreateMediaAssetInput) {
      if ([...records.values()].some((record) => record.storageKey === input.storageKey)) {
        throw new Error(`Duplicate storage key: ${input.storageKey}`)
      }
      const record: MediaAssetRecord = {
        id: input.id,
        ownerId: input.ownerId,
        processingStatus: "uploading",
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        width: null,
        height: null,
        sha256: input.sha256,
        attribution: input.attribution,
        license: input.license,
        licenseNote: input.licenseNote,
        alt: null,
        caption: null,
        variants: [],
        deletedAt: null,
        createdAt: now()
      }
      records.set(record.id, record)
      track(record.id, "uploading")
      return record
    },

    async setStatus(id, status) {
      const updated: MediaAssetRecord = { ...mustFind(id), processingStatus: status }
      records.set(id, updated)
      track(id, status)
      return updated
    },

    async saveMaster(id, input: SaveMasterInput) {
      const updated: MediaAssetRecord = { ...mustFind(id), ...input }
      records.set(id, updated)
      return updated
    }
  }
}

export interface MemoryStorageFailures {
  /** Сколько следующих `put` отказывают недоступным провайдером. */
  put?: number
  delete?: number
  get?: number
}

export interface MemoryStorage extends ObjectStorage {
  readonly objects: Map<string, StoredObject>
  /** Следующие вызовы отказывают: так проверяется частичная ошибка конвейера. */
  failNext(failures: MemoryStorageFailures): void
}

export function createMemoryStorage(): MemoryStorage {
  const objects = new Map<string, StoredObject>()
  const failures: MemoryStorageFailures = {}

  const consume = (operation: keyof MemoryStorageFailures): void => {
    const remaining = failures[operation] ?? 0
    if (remaining <= 0) return
    failures[operation] = remaining - 1
    throw new StorageUnavailableError(`Memory storage ${operation} failed`)
  }

  return {
    name: "memory",
    objects,

    failNext(next) {
      Object.assign(failures, next)
    },

    async put(key, body, { contentType }) {
      assertStorageKey(key)
      consume("put")
      objects.set(key, { body: Buffer.from(body), contentType })
    },

    async get(key) {
      assertStorageKey(key)
      consume("get")
      return objects.get(key) ?? null
    },

    async exists(key) {
      assertStorageKey(key)
      return objects.has(key)
    },

    async delete(key) {
      assertStorageKey(key)
      consume("delete")
      objects.delete(key)
    },

    signedGetUrl(key) {
      assertStorageKey(key)
      return `memory://${key}`
    }
  }
}

/** Задания очереди в памяти: постановка и ручной прогон, без исполнителя и без базы. */
export function createMemoryMediaQueue() {
  const jobs: { assetId: string; requestId: string }[] = []
  return {
    jobs,
    queue: {
      async enqueue(input: { assetId: string; requestId: string }) {
        jobs.push(input)
      }
    }
  }
}

export const uploadSourceOf = (bytes: Buffer) => ({
  size: bytes.length,
  bytes: async () => bytes
})
