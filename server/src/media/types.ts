import type { MediaLicense, MediaProcessingStatus } from "../generated/prisma"
import type { MasterExtension, VariantFormat } from "../storage/keys"

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
 * Квадрат кадра в пикселях исходного изображения: левый верхний угол и сторона. Кадрирование
 * выбирает автор с предпросмотром (`image-variants.md` §2 п. 3, `avatars.md` п. 3), поэтому
 * прямоугольник приходит снаружи, а не выводится обработчиком.
 */
export interface SquareCrop {
  x: number
  y: number
  size: number
}

/** Публичный вариант: готовые к раздаче байты одного размера в одном формате (журнал §29.4). */
export interface VariantImage {
  body: Buffer
  mimeType: string
  width: number
  height: number
}

/**
 * Размытый заполнитель показывается мгновенно, до загрузки варианта (`image-variants.md` §2 п. 4),
 * поэтому он не отдельный объект хранилища, а строка `data:` в записи медиа: лишний запрос за
 * картинкой в 48 px стоил бы дороже самих байтов.
 */
export interface PlaceholderImage {
  dataUri: string
  width: number
  height: number
}

/**
 * Обработчик изображений. `inspect` отвечает за целостность и фактические свойства,
 * `createMaster` — за безопасный мастер: без метаданных, с применённой ориентацией EXIF и единым
 * цветовым профилем (заметка владельца п. 3–4, журнал §29.2); `createVariant` и
 * `createPlaceholder` — за производные из мастера (§29.4, ADR-0030 п. 1); `cropSquare` — за
 * кадр, выбранный автором до мастера (`avatars.md` п. 3).
 */
export interface ImageProcessor {
  readonly name: string
  inspect(bytes: Buffer): Promise<ImageInspection>
  createMaster(bytes: Buffer, inspection: ImageInspection): Promise<MasterImage>
  createVariant(master: Buffer, spec: { width: number; format: VariantFormat }): Promise<VariantImage>
  createPlaceholder(master: Buffer): Promise<PlaceholderImage>
  /**
   * Квадрат исходника теми же байтами формата, что и вход: кадр применяется до конвейера, а
   * снятие метаданных и единый профиль остаются шагом мастера, а не этой операции.
   */
  cropSquare(bytes: Buffer, crop: SquareCrop): Promise<Buffer>
}

/** Один вариант в записи медиа: ключ хранилища, не адрес (`access-and-signed-urls.md` п. 9). */
export interface MediaVariantEntry {
  format: VariantFormat
  width: number
  height: number
  key: string
  byteSize: number
}

/**
 * Набор вариантов записи. Хранится в `MediaAsset.variants`; `version` отличает его от значения по
 * умолчанию (`[]`) и от наборов, которые появятся после замены матрицы (`image-variants.md` §2 п. 6).
 */
export interface MediaVariantSet {
  version: 1
  /** `data:`-строка размытого заполнителя; `null`, если шаг ещё не дошёл до него. */
  placeholder: string | null
  /** Ширина варианта для списков и выбора медиа в редакторе. */
  thumbnailWidth: number | null
  items: MediaVariantEntry[]
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
  /**
   * Дедупликация по `sha256` в пределах владельца (`storage-layout.md` п. 6). Файлы, связанные
   * как текущий или предыдущий аватар, в поиск не попадают: у аватара свой квадратный набор
   * вариантов и нет атрибуции, и отдать его как медиа статьи значило бы обойти обязательную
   * лицензию (`avatars.md` п. 2, `image-variants.md` §3).
   */
  findByChecksum(input: { ownerId: string; sha256: string }): Promise<MediaAssetRecord | null>
  create(input: CreateMediaAssetInput): Promise<MediaAssetRecord>
  setStatus(id: string, status: MediaProcessingStatus): Promise<MediaAssetRecord>
  saveMaster(id: string, input: SaveMasterInput): Promise<MediaAssetRecord>
  /** Набор пишется и при частичной ошибке: полученные варианты не теряются (§2 п. 8). */
  saveVariants(id: string, variants: MediaVariantSet): Promise<MediaAssetRecord>
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
