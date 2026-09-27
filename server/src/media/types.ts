import type { MediaLicense, MediaProcessingStatus } from "../generated/prisma"
import type { MasterExtension } from "../storage/keys"

// Порты конвейера загрузки (`upload-pipeline.md` п. 5, журнал §29.2, §29.12). Библиотека
// обработки, хранилище записей и очередь заданий подключаются через интерфейсы: тесты конвейера
// работают с двойниками, а удаление EXIF проверяется настоящей реализацией.

/** Форматы изображений, которые принимает этот проход (GIF, PDF, видео и аудио — не этот проход). */
export const ACCEPTED_IMAGE_FORMATS = ["jpeg", "png", "webp", "avif"] as const
export type AcceptedImageFormat = (typeof ACCEPTED_IMAGE_FORMATS)[number]

export interface ImageFormatDescriptor {
  format: AcceptedImageFormat
  mimeType: string
  extension: MasterExtension
}

/**
 * Источник байтов загрузки. Объявленный размер читается до чтения содержимого, чтобы превышение
 * порога отклонялось без буферизации файла; фактическая длина проверяется ещё раз после чтения.
 */
export interface UploadSource {
  readonly size: number
  bytes(): Promise<Buffer>
}

export interface ImageInspection {
  format: AcceptedImageFormat
  width: number
  height: number
  /** Число кадров: анимация этим проходом не принимается. */
  frames: number
  /** В байтах есть EXIF, XMP, IPTC или ICC — сведение для проверки мастера. */
  hasMetadata: boolean
}

export interface MasterImage {
  body: Buffer
  mimeType: string
  extension: MasterExtension
  width: number
  height: number
}

/**
 * Обработчик изображений. `inspect` отвечает за целостность и фактические свойства,
 * `createMaster` — за безопасный мастер: без метаданных, с применённой ориентацией EXIF и единым
 * цветовым профилем (заметка владельца п. 3–4, журнал §29.2).
 */
export interface ImageProcessor {
  readonly name: string
  inspect(bytes: Buffer): Promise<ImageInspection>
  createMaster(bytes: Buffer, inspection: ImageInspection): Promise<MasterImage>
}

export interface MediaAssetRecord {
  id: string
  ownerId: string
  processingStatus: MediaProcessingStatus
  storageKey: string
  mimeType: string
  byteSize: number
  width: number | null
  height: number | null
  sha256: string
  attribution: string
  license: MediaLicense
  licenseNote: string | null
  alt: string | null
  caption: string | null
  variants: unknown
  deletedAt: Date | null
  createdAt: Date
}

export interface CreateMediaAssetInput {
  id: string
  ownerId: string
  storageKey: string
  mimeType: string
  byteSize: number
  sha256: string
  attribution: string
  license: MediaLicense
  licenseNote: string | null
}

export interface SaveMasterInput {
  storageKey: string
  mimeType: string
  byteSize: number
  width: number
  height: number
}

/** Истина о файле — запись в базе (`storage-layout.md` п. 2), поэтому статусы ведёт этот порт. */
export interface MediaAssetStore {
  findById(id: string): Promise<MediaAssetRecord | null>
  /** Дедупликация по `sha256` в пределах владельца (`storage-layout.md` п. 6). */
  findByChecksum(input: { ownerId: string; sha256: string }): Promise<MediaAssetRecord | null>
  create(input: CreateMediaAssetInput): Promise<MediaAssetRecord>
  setStatus(id: string, status: MediaProcessingStatus): Promise<MediaAssetRecord>
  saveMaster(id: string, input: SaveMasterInput): Promise<MediaAssetRecord>
}

export interface MediaProcessingQueue {
  enqueue(input: { assetId: string; requestId: string }): Promise<void>
}

/** Права на медиа версии статьи: автор версии, редакционные — по праву `editorial` (матрица #39). */
export interface MediaTranslationOwner {
  translationId: string
  authorId: string
  isEditorial: boolean
}

export interface MediaTranslationLookup {
  findTranslationOwner(translationId: string): Promise<MediaTranslationOwner | null>
}

/**
 * Содержимое конвейер не принял и повтор того же задания результат не изменит: байты не меняются.
 * Запись переходит в `failed`, задание завершается. Правила повторов и действия при частичном
 * сбое — отдельный проход (§29.12).
 */
export class MediaRejectedError extends Error {
  override name = "MediaRejectedError"
  readonly rule: string

  constructor(rule: string, message: string) {
    super(message)
    this.rule = rule
  }
}
