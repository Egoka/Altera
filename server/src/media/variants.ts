import { publicMediaUrl } from "../storage/access"
import { parseStorageKey, variantKey, type VariantFormat } from "../storage/keys"
import type { ObjectStorage } from "../storage/types"
import { planVariants, thumbnailWidthFor, type MasterSize } from "./variant-matrix"
import type { ImageProcessor, MediaAssetRecord, MediaAssetStore, MediaVariantEntry, MediaVariantSet } from "./types"

// Шаг конвейера после мастера (`upload-pipeline.md` п. 5, `image-variants.md` §2 п. 2): из
// мастер-файла делаются размытый заполнитель и публичные варианты матрицы в AVIF и WebP.

export interface VariantGenerationDeps {
  store: MediaAssetStore
  storage: ObjectStorage
  processor: ImageProcessor
}

export const EMPTY_VARIANT_SET: MediaVariantSet = {
  version: 1,
  placeholder: null,
  thumbnailWidth: null,
  items: []
}

function isVariantEntry(value: unknown): value is MediaVariantEntry {
  if (typeof value !== "object" || value === null) return false
  const entry = value as Partial<MediaVariantEntry>
  return (
    (entry.format === "avif" || entry.format === "webp") &&
    typeof entry.width === "number" &&
    typeof entry.height === "number" &&
    typeof entry.key === "string" &&
    typeof entry.byteSize === "number"
  )
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
 */
export async function ensureVariants(
  record: MediaAssetRecord,
  masterBody: Buffer,
  deps: VariantGenerationDeps
): Promise<MediaVariantSet> {
  const master = await masterSize(record, masterBody, deps.processor)
  const known = readVariantSet(record.variants)
  const byKey = new Map(known.items.map((item) => [item.key, item]))

  const set: MediaVariantSet = {
    version: 1,
    placeholder: known.placeholder,
    thumbnailWidth: thumbnailWidthFor(master),
    items: []
  }

  try {
    if (!set.placeholder) {
      set.placeholder = (await deps.processor.createPlaceholder(masterBody)).dataUri
    }

    for (const planned of planVariants(master)) {
      const key = variantKey({
        assetId: record.id,
        createdAt: record.createdAt,
        width: planned.width,
        format: planned.format
      })

      const existing = byKey.get(key)
      if (existing && (await deps.storage.exists(key))) {
        set.items.push(existing)
        continue
      }

      const variant = await deps.processor.createVariant(masterBody, { width: planned.width, format: planned.format })
      await deps.storage.put(key, variant.body, { contentType: variant.mimeType })
      set.items.push({
        format: planned.format,
        width: variant.width,
        height: variant.height,
        key,
        byteSize: variant.body.length
      })
    }
  } catch (error) {
    // Часть набора уже в хранилище: без этой записи повтор не знал бы, что пересоздавать не нужно.
    await deps.store.saveVariants(record.id, set)
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
  storage: ObjectStorage
): Promise<boolean> {
  const set = readVariantSet(record.variants)
  if (!set.placeholder) return false

  const byKey = new Set(set.items.map((item) => item.key))
  for (const planned of planVariants(master)) {
    const key = variantKey({
      assetId: record.id,
      createdAt: record.createdAt,
      width: planned.width,
      format: planned.format
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
        url: publicMediaUrl(mediaBaseUrl, item.key)
      }))
  }
}
