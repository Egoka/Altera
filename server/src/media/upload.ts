import { createHash, randomUUID } from "node:crypto"
import type { MediaLicense } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { quarantineKey } from "../storage/keys"
import { StorageUnavailableError, storageUnavailableError, type ObjectStorage } from "../storage/types"
import { detectImageFormat } from "./formats"
import { MAX_UPLOAD_BYTES } from "./limits"
import type { MediaAssetRecord, MediaAssetStore, MediaProcessingQueue, UploadSource } from "./types"

// Синхронная часть конвейера: файл принимается в карантин и ставится в очередь обработки. Публичным
// он на этом шаге не становится — публичен только вариант готового медиа
// (`upload-pipeline.md` п. 5, `access-and-signed-urls.md` п. 1).

/** Справочник лицензий медиа (ADR-0008 п. 3); значения совпадают с перечислением базы. */
export const MEDIA_LICENSES: readonly MediaLicense[] = [
  "own",
  "cc_by",
  "cc_by_sa",
  "cc_by_nc",
  "cc0",
  "public_domain",
  "permission"
]

/** Атрибуция — свободный текст автора; длина ограничена, чтобы поле не служило хранилищем текста. */
const MAX_ATTRIBUTION_LENGTH = 500

export interface AcceptUploadInput {
  ownerId: string
  file: UploadSource
  license: string
  attribution: string
  requestId: string
}

export interface MediaUploadDeps {
  store: MediaAssetStore
  storage: ObjectStorage
  queue: MediaProcessingQueue
  newAssetId?: () => string
}

function validationError(requestId: string, field: string, rule: string): never {
  throw createApiError("VALIDATION_ERROR", { requestId, field, rule })
}

export function isMediaLicense(value: string): value is MediaLicense {
  return (MEDIA_LICENSES as readonly string[]).includes(value)
}

/**
 * Лицензия и атрибуция обязательны для медиа статьи (ADR-0008 п. 3, `upload-pipeline.md` п. 3):
 * без них — `VALIDATION_ERROR`. Проверка идёт до чтения байтов: отказ не расходует ни хранилище,
 * ни память.
 */
function readLicense(input: AcceptUploadInput): { license: MediaLicense; attribution: string } {
  const attribution = input.attribution.trim()
  if (!attribution) validationError(input.requestId, "attribution", "required")
  if (attribution.length > MAX_ATTRIBUTION_LENGTH) validationError(input.requestId, "attribution", "maxLength")
  if (!isMediaLicense(input.license)) validationError(input.requestId, "license", "enum")

  return { license: input.license, attribution }
}

/**
 * Приём файла. Порядок шагов важен: объявленный размер отклоняется до чтения содержимого,
 * фактический тип определяется по байтам, а запись создаётся только после того, как файл признан
 * пригодным.
 */
export async function acceptMediaUpload(input: AcceptUploadInput, deps: MediaUploadDeps): Promise<MediaAssetRecord> {
  const { license, attribution } = readLicense(input)

  if (input.file.size > MAX_UPLOAD_BYTES) validationError(input.requestId, "file", "maxSize")
  const bytes = await input.file.bytes()
  // Объявленный размер задаёт клиент: порог проверяется ещё раз по фактической длине.
  if (bytes.length > MAX_UPLOAD_BYTES) validationError(input.requestId, "file", "maxSize")
  if (bytes.length === 0) validationError(input.requestId, "file", "required")

  const detected = detectImageFormat(bytes)
  if (!detected) validationError(input.requestId, "file", "unsupportedType")

  const sha256 = createHash("sha256").update(bytes).digest("hex")
  // Повторная загрузка того же файла возвращает существующую запись (`storage-layout.md` п. 6).
  const existing = await deps.store.findByChecksum({ ownerId: input.ownerId, sha256 })
  if (existing && !existing.deletedAt) {
    // Запись, обработка которой отказала, повторно ставится в очередь: мастер, если он есть,
    // остаётся на месте, а недостающие шаги доделывает то же задание конвейера.
    if (existing.processingStatus === "failed") {
      const requeued = await deps.store.setStatus(existing.id, "queued")
      await deps.queue.enqueue({ assetId: existing.id, requestId: input.requestId })
      return requeued
    }
    return existing
  }

  const assetId = (deps.newAssetId ?? randomUUID)()
  const key = quarantineKey({ assetId })
  const record = await deps.store.create({
    id: assetId,
    ownerId: input.ownerId,
    storageKey: key,
    mimeType: detected.mimeType,
    byteSize: bytes.length,
    sha256,
    attribution,
    license,
    // Пояснение к лицензии автор задаёт в свойствах медиа (матрица #40) — не в подписи загрузки.
    licenseNote: null
  })

  try {
    await deps.storage.put(key, bytes, { contentType: detected.mimeType })
  } catch (error) {
    // Байты в карантин не легли: запись остаётся в `failed`, а не висит в `uploading`.
    await deps.store.setStatus(record.id, "failed")
    if (error instanceof StorageUnavailableError) throw storageUnavailableError(input.requestId)
    throw error
  }

  // Статус меняется до постановки задания: исполнитель живёт в том же процессе и может взять
  // задание сразу, а `queued` поверх уже начатой обработки вернул бы запись назад по состоянию.
  const queued = await deps.store.setStatus(record.id, "queued")
  try {
    await deps.queue.enqueue({ assetId: record.id, requestId: input.requestId })
  } catch (error) {
    await deps.store.setStatus(record.id, "failed")
    throw error
  }
  return queued
}
