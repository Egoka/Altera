import { publicMediaUrl } from "../storage/access"
import type { ObjectStorage } from "../storage/types"
import { CENTER_FOCAL, focalOf } from "./cover-crops"
import {
  MediaRejectedError,
  type FocalPoint,
  type ImageProcessor,
  type MediaAssetRecord,
  type MediaAssetStore
} from "./types"
import { ensureVariants, publicVariantSet, readVariantSet, type PublicVariantSet } from "./variants"

// Обложка материала (`article-covers.md`): одна запись медиа на материал, общая для языковых
// версий (ADR-0002). Здесь — применение фокусной точки и чтение обложки для ответа API; связь с
// материалом и права ведёт `article/cover.ts`.

export interface CoverFocalDeps {
  store: MediaAssetStore
  storage: ObjectStorage
  processor: ImageProcessor
}

/**
 * Фокус обложки и кадры карточек по нему. Кадры собираются здесь же, а не заданием очереди:
 * автор выбирает кадрирование с предпросмотром (`image-variants.md` §2 п. 3), и показать ему
 * результат выбора нужно сразу, как и аватару (журнал §29.5). Базовые варианты уже готовы —
 * повторно они не пересоздаются.
 */
export async function applyCoverFocal(
  assetId: string,
  focal: FocalPoint | null,
  deps: CoverFocalDeps
): Promise<MediaAssetRecord> {
  const updated = await deps.store.saveFocal(assetId, focal)
  const master = await deps.storage.get(updated.storageKey)
  // Мастер — источник всех производных (§29.2): без него кадр не из чего вырезать.
  if (!master) throw new MediaRejectedError("file.missing", "Master file is gone")

  await ensureVariants(updated, master.body, deps)
  const reread = await deps.store.findById(assetId)
  return reread ?? updated
}

/** Поля записи, которых достаточно для показа обложки. */
export const coverAssetSelect = {
  id: true,
  processingStatus: true,
  deletedAt: true,
  variants: true,
  alt: true,
  focalX: true,
  focalY: true
} as const

export interface CoverAssetRecord {
  id: string
  processingStatus: MediaAssetRecord["processingStatus"]
  deletedAt: Date | null
  variants: unknown
  alt: string | null
  focalX: number | null
  focalY: number | null
}

export interface CoverView {
  assetId: string
  /** Адрес наибольшего готового варианта WebP исходной композиции — один адрес для `<img>`. */
  url: string
  /** Базовые варианты и кадры карточек; карточка выбирает кадр по своему варианту. */
  variants: PublicVariantSet
  /** Единое описание медиафайла (журнал §29.13); узел документа его не переопределяет. */
  alt: string | null
  focal: FocalPoint
}

/**
 * Обложка для ответа API. Не готовая, удалённая или ещё не собранная запись обложкой не
 * считается: публичен только вариант готового медиа (`access-and-signed-urls.md` п. 1), а
 * карточке лучше остаться без картинки, чем показать сломанную.
 */
export function coverViewOf(asset: CoverAssetRecord | null | undefined, mediaBaseUrl: string): CoverView | null {
  if (!asset || asset.deletedAt || asset.processingStatus !== "ready") return null
  const items = readVariantSet(asset.variants).items.filter((item) => item.format === "webp" && !item.crop)
  if (items.length === 0) return null

  const largest = items.reduce((left, right) => (right.width > left.width ? right : left))
  return {
    assetId: asset.id,
    url: publicMediaUrl(mediaBaseUrl, largest.key),
    variants: publicVariantSet(asset.variants, mediaBaseUrl),
    alt: asset.alt,
    focal: focalOf(asset)
  }
}

/** Обложка, пригодная к публикации: готовая запись с собранным набором кадров. */
export function isCoverReady(asset: CoverAssetRecord | null | undefined): boolean {
  if (!asset || asset.deletedAt || asset.processingStatus !== "ready") return false
  const set = readVariantSet(asset.variants)
  return set.items.some((item) => item.crop !== undefined)
}

export { CENTER_FOCAL }
