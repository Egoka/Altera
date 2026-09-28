import { masterKey, parseStorageKey, quarantineKey } from "../storage/keys"
import type { ObjectStorage } from "../storage/types"
import { MAX_IMAGE_PIXELS, MIN_IMAGE_SIDE } from "./limits"
import { ensureVariants, isVariantSetIntact } from "./variants"
import {
  MediaRejectedError,
  type ImageInspection,
  type ImageProcessor,
  type MediaAssetRecord,
  type MediaAssetStore
} from "./types"

/** Вид задания очереди (T-047): обработка одного загруженного файла. */
export const MEDIA_PROCESS_JOB_KIND = "media.process"

export interface MediaProcessingDeps {
  store: MediaAssetStore
  storage: ObjectStorage
  processor: ImageProcessor
}

export type MediaProcessingOutcome =
  /** Нечего обрабатывать: запись удалена или её уже нет. */
  | { result: "skipped"; reason: "missing" | "deleted" }
  /** Обработка уже завершена — повторное задание ничего не меняет. */
  | { result: "already_ready" }
  /** Мастер создан этим проходом либо уже существовал, все шаги завершены. */
  | { result: "ready"; masterCreated: boolean }
  /** Содержимое не принято; повтор того же задания результат не изменит. */
  | { result: "rejected"; rule: string }

/**
 * Пороги содержимого проверяются здесь, а не в мутации: число пикселей известно только после
 * декодирования. Числа — предложение архитектора (`limits.ts`, журнал §33 п. 3).
 */
function assertAcceptable(inspection: ImageInspection): void {
  if (inspection.frames > 1) {
    throw new MediaRejectedError("file.animation", "Animated images are out of this pass")
  }
  if (inspection.width < MIN_IMAGE_SIDE || inspection.height < MIN_IMAGE_SIDE) {
    throw new MediaRejectedError("file.minSide", `Image side is smaller than ${MIN_IMAGE_SIDE}px`)
  }
  if (inspection.width * inspection.height > MAX_IMAGE_PIXELS) {
    throw new MediaRejectedError("file.pixels", `Image exceeds ${MAX_IMAGE_PIXELS} pixels`)
  }
}

/** Мастер существует, когда ключ записи — ключ мастера и объект лежит в хранилище. */
async function findExistingMaster(record: MediaAssetRecord, storage: ObjectStorage): Promise<string | null> {
  if (parseStorageKey(record.storageKey)?.kind !== "master") return null
  return (await storage.exists(record.storageKey)) ? record.storageKey : null
}

async function createMaster(
  record: MediaAssetRecord,
  deps: MediaProcessingDeps
): Promise<{ record: MediaAssetRecord; body: Buffer }> {
  const key = quarantineKey({ assetId: record.id })
  const quarantined = await deps.storage.get(key)
  if (!quarantined) {
    // Ни мастера, ни карантина: восстанавливать нечего, байты загрузки потеряны.
    throw new MediaRejectedError("file.missing", "Quarantined upload is gone")
  }

  const inspection = await deps.processor.inspect(quarantined.body)
  assertAcceptable(inspection)

  const master = await deps.processor.createMaster(quarantined.body, inspection)
  const target = masterKey({ assetId: record.id, createdAt: record.createdAt, extension: master.extension })
  await deps.storage.put(target, master.body, { contentType: master.mimeType })
  const saved = await deps.store.saveMaster(record.id, {
    storageKey: target,
    mimeType: master.mimeType,
    byteSize: master.body.length,
    width: master.width,
    height: master.height
  })
  return { record: saved, body: master.body }
}

/**
 * Набор вариантов для записи с уже существующим мастером. Полный набор повторно не собирается и
 * мастер за ним не читается: повтор после частичной ошибки не должен стоить как первая обработка.
 */
async function completeVariants(record: MediaAssetRecord, deps: MediaProcessingDeps): Promise<void> {
  const size = record.width && record.height ? { width: record.width, height: record.height } : null
  if (size && (await isVariantSetIntact(record, size, deps.storage))) return

  const master = await deps.storage.get(record.storageKey)
  // Мастер только что был на месте (`findExistingMaster`): пропал между проверкой и чтением.
  if (!master) throw new MediaRejectedError("file.missing", "Master file is gone")
  await ensureVariants(record, master.body, deps)
}

/**
 * Обработка одного файла: `processing` → мастер без EXIF → варианты и заполнитель → снятие
 * карантина → `ready`.
 *
 * Повтор после частичной ошибки (§29.12) держится на состоянии самой записи: если `storageKey`
 * уже указывает на существующий мастер, задание его не пересоздаёт, а доделывает оставшиеся шаги —
 * недостающие варианты (`image-variants.md` §2 п. 8) и снятие карантина.
 *
 * Отказ содержимого завершает задание: байты не изменятся, и повторять его незачем. Любая другая
 * ошибка выбрасывается наружу — повторы и исчерпание ведёт очередь (T-047).
 */
export async function runMediaProcessing(assetId: string, deps: MediaProcessingDeps): Promise<MediaProcessingOutcome> {
  const record = await deps.store.findById(assetId)
  if (!record) return { result: "skipped", reason: "missing" }
  if (record.deletedAt) return { result: "skipped", reason: "deleted" }
  if (record.processingStatus === "ready") return { result: "already_ready" }

  const processing = await deps.store.setStatus(assetId, "processing")
  try {
    const existingMaster = await findExistingMaster(processing, deps.storage)
    if (existingMaster) {
      await completeVariants(processing, deps)
    } else {
      const created = await createMaster(processing, deps)
      await ensureVariants(created.record, created.body, deps)
    }

    // Карантин — временная зона: после мастера копия загрузки в ней не нужна.
    await deps.storage.delete(quarantineKey({ assetId }))
    await deps.store.setStatus(assetId, "ready")
    return { result: "ready", masterCreated: !existingMaster }
  } catch (error) {
    await deps.store.setStatus(assetId, "failed")
    if (error instanceof MediaRejectedError) return { result: "rejected", rule: error.rule }
    throw error
  }
}
