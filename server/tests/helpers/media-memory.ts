import type { MediaProcessingStatus } from "../../src/generated/prisma"
import type {
  CreateMediaAssetInput,
  ImageInspection,
  ImageProcessor,
  MasterImage,
  MediaAssetRecord,
  MediaAssetStore,
  MediaVariantSet,
  PlaceholderImage,
  SaveMasterInput,
  VariantImage
} from "../../src/media/types"
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
      // Связей у двойника нет, поэтому аватары исключает тест, а не хранилище: их приём своей
      // дедупликации не делает вовсе (`media/avatars.ts`).
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
    },

    async saveVariants(id, variants: MediaVariantSet) {
      // Как в базе: значение колонки переписывается целиком, без слияния с прежним набором.
      const updated: MediaAssetRecord = { ...mustFind(id), variants: structuredClone(variants) }
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

export interface FakeProcessorOptions {
  width?: number
  height?: number
  frames?: number
  failInspect?: boolean
  /** Сколько вариантов отказывают: так проверяется частичный набор. */
  failVariants?: number
  /** Сколько вариантов успевают получиться до первого отказа. */
  failVariantsAfter?: number
}

/**
 * Двойник обработчика изображений: предсказуемые байты вместо кодирования. Размеры вариантов
 * считаются той же пропорцией, что и у настоящего `sharp`, чтобы тесты матрицы проверяли план,
 * а не реализацию кодека. Настоящие AVIF и WebP проверяет `media-variants-sharp.test.ts`.
 */
export function createFakeImageProcessor(options: FakeProcessorOptions = {}) {
  const calls = { inspect: 0, createMaster: 0, createVariant: 0, createPlaceholder: 0, cropSquare: 0 }
  let lastCrop: SquareCrop | null = null
  /** Размер мастера, из которого считаются стороны вариантов: у аватара он квадратный. */
  let master = { width: 0, height: 0 }
  let remainingVariantFailures = options.failVariants ?? 0
  let successesBeforeFailure = options.failVariantsAfter ?? 0
  const width = options.width ?? 1200
  const height = options.height ?? 800

  const processor: ImageProcessor = {
    name: "fake",

    /**
     * Кадр двойника — отметка в байтах, а не настоящая обрезка: конвейер проверяет, что квадрат
     * дошёл до карантина, а точность обрезки проверяет `sharp` в `media-avatar-sharp.test.ts`.
     */
    async cropSquare(bytes, crop: SquareCrop) {
      calls.cropSquare += 1
      lastCrop = crop
      return Buffer.concat([bytes, Buffer.from(`|crop:${crop.x},${crop.y},${crop.size}`)])
    },

    async inspect(bytes) {
      calls.inspect += 1
      if (options.failInspect) throw new Error("decode failed")
      const inspection: ImageInspection = {
        format: "jpeg",
        width,
        height,
        frames: options.frames ?? 1,
        hasMetadata: bytes.includes(Buffer.from("exif"))
      }
      return inspection
    },

    async createMaster(_bytes, inspection) {
      calls.createMaster += 1
      // Мастер аватара квадратный: кадр применяется до конвейера, и сторона мастера — сторона кадра.
      const side = lastCrop?.size ?? null
      master = { width: side ?? inspection.width, height: side ?? inspection.height }
      const created: MasterImage = {
        body: Buffer.from("master-bytes"),
        mimeType: "image/jpeg",
        extension: "jpg",
        ...master
      }
      return created
    },

    async createVariant(_master, spec) {
      calls.createVariant += 1
      if (remainingVariantFailures > 0 && successesBeforeFailure <= 0) {
        remainingVariantFailures -= 1
        throw new StorageUnavailableError(`Fake variant ${spec.width}.${spec.format} failed`)
      }
      if (successesBeforeFailure > 0) successesBeforeFailure -= 1
      const source = master.width > 0 ? master : { width, height }
      const scaled = Math.min(spec.width, source.width)
      const variant: VariantImage = {
        body: Buffer.from(`variant-${spec.format}-${spec.width}`),
        mimeType: `image/${spec.format}`,
        width: scaled,
        height: Math.max(1, Math.round((source.height * scaled) / source.width))
      }
      return variant
    },

    async createPlaceholder() {
      calls.createPlaceholder += 1
      const placeholder: PlaceholderImage = {
        dataUri: "data:image/webp;base64,ZmFrZS1wbGFjZWhvbGRlcg==",
        width: 48,
        height: 32
      }
      return placeholder
    }
  }

  return { processor, calls, lastCrop: () => lastCrop }
}
