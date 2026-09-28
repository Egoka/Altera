import { publicMediaUrl } from "../storage/access"
import { parseStorageKey, variantKey, VARIANT_CROPS, type VariantCrop, type VariantFormat } from "../storage/keys"
import type { ObjectStorage } from "../storage/types"
import { COVER_CROPS, focalOf, sameFocal } from "./cover-crops"
import { planAllVariants, thumbnailWidthFor, type MasterSize } from "./variant-matrix"
import type {
  FocalPoint,
  ImageProcessor,
  MediaAssetRecord,
  MediaAssetStore,
  MediaVariantEntry,
  MediaVariantSet
} from "./types"

// Шаг конвейера после мастера (`upload-pipeline.md` п. 5, `image-variants.md` §2 п. 2): из
// мастер-файла делаются размытый заполнитель и публичные варианты матрицы в AVIF и WebP.

export interface VariantGenerationDeps {
  store: MediaAssetStore
  storage: ObjectStorage
  processor: ImageProcessor
  /** Набор ширин: по умолчанию матрица статьи, у аватара — квадратные размеры (`avatars.md` п. 3). */
  variantWidths?: readonly number[]
}

export const EMPTY_VARIANT_SET: MediaVariantSet = {
  version: 1,
  placeholder: null,
  thumbnailWidth: null,
  focal: null,
  items: []
}

/**
 * Кадры карточек собираются для записи с фокусной точкой. Фокус ставится только при выборе
 * обложки (`setArticleCover`), поэтому признак назначения не заводится второй раз: в записи
 * медиа его нет, его несёт связь в базе (`storage-layout.md` п. 3). Повторное задание очереди
 * по той же причине не теряет кадры — фокус остаётся в записи.
 */
export function cropsFor(record: Pick<MediaAssetRecord, "focalX" | "focalY">): readonly VariantCrop[] {
  // Проверка по типу, а не по `!== null`: у записи без фокуса поле может отсутствовать вовсе,
  // и такая запись кадров не получает — иначе их собрал бы себе и аватар.
  const set = typeof record.focalX === "number" && typeof record.focalY === "number"
  return set ? COVER_CROPS : []
}

function isVariantEntry(value: unknown): value is MediaVariantEntry {
  if (typeof value !== "object" || value === null) return false
  const entry = value as Partial<MediaVariantEntry>
  const cropKnown = entry.crop === undefined || (VARIANT_CROPS as readonly string[]).includes(entry.crop)
  return (
    (entry.format === "avif" || entry.format === "webp") &&
    typeof entry.width === "number" &&
    typeof entry.height === "number" &&
    typeof entry.key === "string" &&
    typeof entry.byteSize === "number" &&
    cropKnown
  )
}

function readFocal(value: unknown): FocalPoint | null {
  if (typeof value !== "object" || value === null) return null
  const point = value as Partial<FocalPoint>
  if (typeof point.x !== "number" || typeof point.y !== "number") return null
  return { x: point.x, y: point.y }
}

/**
 * Значение колонки в набор. По умолчанию там `[]` (миграция `media_assets`), а после замены
 * матрицы формат может измениться — незнакомое значение читается как «вариантов нет», и повтор
 * задания соберёт набор заново.
 */
export function readVariantSet(value: unknown): MediaVariantSet {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY_VARIANT_SET
  const stored = value as Partial<MediaVariantSet>
  if (stored.version !== 1 || !Array.isArray(stored.items)) return EMPTY_VARIANT_SET
  return {
    version: 1,
    placeholder: typeof stored.placeholder === "string" ? stored.placeholder : null,
    thumbnailWidth: typeof stored.thumbnailWidth === "number" ? stored.thumbnailWidth : null,
    focal: readFocal(stored.focal),
    items: stored.items.filter(isVariantEntry)
  }
}

/** Размер мастера: из записи, а если её поля ещё не заполнены — из самих байтов. */
async function masterSize(record: MediaAssetRecord, body: Buffer, processor: ImageProcessor): Promise<MasterSize> {
  if (record.width && record.height) return { width: record.width, height: record.height }
  const inspection = await processor.inspect(body)
  return { width: inspection.width, height: inspection.height }
}

/**
 * Идемпотентная генерация набора: уже лежащие в хранилище варианты не пересоздаются, недостающие
 * добавляются. Так повторная задача восстанавливает частичный набор, не теряя мастер-файл
 * (`image-variants.md` §2 п. 8, заметка владельца п. 9).
 *
 * Отказ на любом варианте сохраняет полученную часть набора и пробрасывается наружу: статус
 * записи ведёт конвейер, а повторы — очередь (T-047).
 *
 * Варианты прежней матрицы, которых нет в плане, в набор не переносятся; удаление их объектов —
 * шаг миграции набора ширин (§2 п. 6), а не обработки одного файла.
 *
 * Запись с фокусной точкой получает сверх базовых варианты-кадры под соотношения карточек
 * (`article-covers.md` п. 3). Смена фокуса пересобирает только их: мастер и базовые варианты
 * от фокуса не зависят (`image-variants.md` §2 п. 3).
 */
export async function ensureVariants(
  record: MediaAssetRecord,
  masterBody: Buffer,
  deps: VariantGenerationDeps
): Promise<MediaVariantSet> {
  const master = await masterSize(record, masterBody, deps.processor)
  const known = readVariantSet(record.variants)
  const byKey = new Map(known.items.map((item) => [item.key, item]))
  const crops = cropsFor(record)
  const focal = crops.length > 0 ? focalOf(record) : null
  // Ключ кадра фокуса не называет: при смене фокуса под тем же ключом должны лечь другие байты,
  // поэтому прежние кадры не переиспользуются, даже когда объект в хранилище есть.
  const cropsStale = !sameFocal(known.focal, focal)

  const set: MediaVariantSet = {
    version: 1,
    placeholder: known.placeholder,
    thumbnailWidth: thumbnailWidthFor(master, deps.variantWidths),
    focal,
    items: []
  }

  try {
    if (!set.placeholder) {
      set.placeholder = (await deps.processor.createPlaceholder(masterBody)).dataUri
    }

    for (const planned of planAllVariants(master, {
      widths: deps.variantWidths,
      crops,
      focal: focal ?? undefined
    })) {
      const key = variantKey({
        assetId: record.id,
        createdAt: record.createdAt,
        width: planned.width,
        format: planned.format,
        crop: planned.crop
      })

      const existing = byKey.get(key)
      const reusable = !planned.crop || !cropsStale
      if (reusable && existing && (await deps.storage.exists(key))) {
        set.items.push(existing)
        continue
      }

      const variant = await deps.processor.createVariant(masterBody, {
        width: planned.width,
        format: planned.format,
        crop: planned.rect
      })
      await deps.storage.put(key, variant.body, { contentType: variant.mimeType })
      set.items.push({
        format: planned.format,
        width: variant.width,
        height: variant.height,
        key,
        byteSize: variant.body.length,
        ...(planned.crop ? { crop: planned.crop } : {})
      })
    }
  } catch (error) {
    // Часть набора уже в хранилище: без этой записи повтор не знал бы, что пересоздавать не нужно.
    // Новый фокус при этом не объявляется: под ключами недоделанных кадров ещё лежат байты
    // прежнего фокуса, и повтор должен считать негодными все кадры, а не часть.
    const unfinishedFocal = crops.length > 0 && cropsStale ? known.focal : focal
    await deps.store.saveVariants(record.id, { ...set, focal: unfinishedFocal })
    throw error
  }

  return deps.store.saveVariants(record.id, set).then(() => set)
}

/**
 * Набор цел: есть заполнитель, а каждый вариант плана числится в записи и лежит в хранилище.
 * Проверка идёт по объектам, а не по длине списка: запись могла пережить потерю файла, и повтор
 * задания должен такой вариант восстановить, а не считать набор готовым.
 */
export async function isVariantSetIntact(
  record: MediaAssetRecord,
  master: MasterSize,
  storage: ObjectStorage,
  variantWidths?: readonly number[]
): Promise<boolean> {
  const set = readVariantSet(record.variants)
  if (!set.placeholder) return false

  const crops = cropsFor(record)
  const focal = crops.length > 0 ? focalOf(record) : null
  // Набор, нарезанный по другому фокусу, целым не считается: кадры карточек в нём не те.
  if (!sameFocal(set.focal, focal)) return false

  const byKey = new Set(set.items.map((item) => item.key))
  for (const planned of planAllVariants(master, { widths: variantWidths, crops, focal: focal ?? undefined })) {
    const key = variantKey({
      assetId: record.id,
      createdAt: record.createdAt,
      width: planned.width,
      format: planned.format,
      crop: planned.crop
    })
    if (!byKey.has(key)) return false
    if (!(await storage.exists(key))) return false
  }
  return true
}

/** Вариант в ответе API: адрес вместо ключа — интерфейс не знает раскладки бакета (§2 п. 9). */
export interface PublicVariant {
  format: VariantFormat
  width: number
  height: number
  url: string
  /** Метка кадра карточки; без неё вариант сохраняет композицию мастера. */
  crop?: VariantCrop
}

export interface PublicVariantSet {
  version: 1
  placeholder: string | null
  thumbnailWidth: number | null
  items: PublicVariant[]
}

/**
 * Набор для ответа API. В базе лежат ключи: смена провайдера хранилища меняет домен, не ключи
 * (`access-and-signed-urls.md` п. 9), поэтому адрес собирается при чтении. Само право на файл
 * проверяет раздача по ключу (`storage/access.ts`), а не эта сборка.
 */
export function publicVariantSet(value: unknown, mediaBaseUrl: string): PublicVariantSet {
  const set = readVariantSet(value)
  return {
    version: 1,
    placeholder: set.placeholder,
    thumbnailWidth: set.thumbnailWidth,
    items: set.items
      .filter((item) => parseStorageKey(item.key)?.kind === "variant")
      .map((item) => ({
        format: item.format,
        width: item.width,
        height: item.height,
        url: publicMediaUrl(mediaBaseUrl, item.key),
        ...(item.crop ? { crop: item.crop } : {})
      }))
  }
}
