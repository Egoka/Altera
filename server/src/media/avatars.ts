import { createHash, randomUUID } from "node:crypto"
import { createApiError } from "../errors/graphql-error"
import { publicMediaUrl } from "../storage/access"
import { quarantineKey } from "../storage/keys"
import { StorageUnavailableError, storageUnavailableError, type ObjectStorage } from "../storage/types"
import { detectImageFormat } from "./formats"
import { AVATAR_VARIANT_WIDTHS, MAX_UPLOAD_BYTES } from "./limits"
import { assertAcceptableImage, runMediaProcessing } from "./pipeline"
import { MediaRejectedError, type ImageProcessor, type MediaAssetRecord, type MediaAssetStore } from "./types"
import type { SquareCrop, UploadSource } from "./types"
import { publicVariantSet, readVariantSet, type PublicVariantSet } from "./variants"

// Аватар идёт тем же конвейером, что и медиа статьи (`upload-pipeline.md` п. 5), с двумя
// отличиями, которые задал владелец:
//
//  * кадр выбирает автор (`avatars.md` п. 3), поэтому квадрат применяется до карантина и мастер
//    аватара уже квадратный — сам конвейер про назначение файла ничего не знает;
//  * обработка идёт синхронно: «применяется публично сразу» (журнал §29.5) значит, что мутация
//    отвечает готовой записью, а не обещанием задания. Отказ содержимого при этом возвращается
//    автору ошибкой, а не остаётся в записи, которую ему негде увидеть.
//
// Лицензия и атрибуция у аватара не запрашиваются (`avatars.md` п. 2): колонки обязательны, и
// запись получает нейтральные значения, а не выдуманное имя правообладателя.
const AVATAR_LICENSE = "own"
const AVATAR_ATTRIBUTION = ""

export interface AvatarUploadInput {
  ownerId: string
  file: UploadSource
  /** Квадрат в пикселях изображения, как его видит автор; без него берётся центральный квадрат. */
  crop?: SquareCrop | null
  requestId: string
}

export interface AvatarUploadDeps {
  store: MediaAssetStore
  storage: ObjectStorage
  processor: ImageProcessor
  newAssetId?: () => string
}

function validationError(requestId: string, field: string, rule: string): never {
  throw createApiError("VALIDATION_ERROR", { requestId, field, rule })
}

/**
 * Наибольший центральный квадрат: кадр по умолчанию, когда автор его не выбирал. Так ведёт себя
 * и предпросмотр — из широкой фотографии берётся середина, а не левый край.
 */
export function centerSquare(size: { width: number; height: number }): SquareCrop {
  const side = Math.min(size.width, size.height)
  return {
    x: Math.floor((size.width - side) / 2),
    y: Math.floor((size.height - side) / 2),
    size: side
  }
}

/**
 * Кадр внутри изображения и целыми пикселями. Квадрат, выходящий за границу, — ошибка клиента,
 * а не повод молча подвинуть выбор автора.
 */
export function assertCropFits(crop: SquareCrop, size: { width: number; height: number }, requestId: string): void {
  const whole = [crop.x, crop.y, crop.size].every((value) => Number.isInteger(value))
  if (!whole) validationError(requestId, "crop", "integer")
  if (crop.size < 1) validationError(requestId, "crop", "min")
  if (crop.x < 0 || crop.y < 0) validationError(requestId, "crop", "bounds")
  if (crop.x + crop.size > size.width || crop.y + crop.size > size.height) {
    validationError(requestId, "crop", "bounds")
  }
}

/** Отказ содержимого — ответ автору о файле, а не внутренняя ошибка: правило уходит в `rule`. */
function rejectedAsValidation(error: unknown, requestId: string): never {
  if (error instanceof MediaRejectedError) validationError(requestId, "file", error.rule)
  throw error
}

/**
 * Приём аватара: проверки, кадр, карантин и обработка до готовой записи. Связь с аккаунтом эта
 * функция не трогает — применение, предыдущую версию и откат ведёт `account/avatar.ts`.
 */
export async function acceptAvatarUpload(input: AvatarUploadInput, deps: AvatarUploadDeps): Promise<MediaAssetRecord> {
  if (input.file.size > MAX_UPLOAD_BYTES) validationError(input.requestId, "file", "maxSize")
  const bytes = await input.file.bytes()
  // Объявленный размер задаёт клиент: порог проверяется ещё раз по фактической длине.
  if (bytes.length > MAX_UPLOAD_BYTES) validationError(input.requestId, "file", "maxSize")
  if (bytes.length === 0) validationError(input.requestId, "file", "required")

  const detected = detectImageFormat(bytes)
  if (!detected) validationError(input.requestId, "file", "unsupportedType")

  // Пороги проверяются по исходнику, а не по кадру: декодировать 50-мегапиксельный снимок ради
  // квадрата в 512 px конвейеру всё равно пришлось бы.
  let cropped: Buffer
  try {
    const inspection = await deps.processor.inspect(bytes)
    assertAcceptableImage(inspection)
    const crop = input.crop ?? centerSquare(inspection)
    assertCropFits(crop, inspection, input.requestId)
    cropped = await deps.processor.cropSquare(bytes, crop)
  } catch (error) {
    rejectedAsValidation(error, input.requestId)
  }

  const assetId = (deps.newAssetId ?? randomUUID)()
  const key = quarantineKey({ assetId })
  // Дедупликации у аватара нет: кадр делает байты своими, а общая запись с медиа статьи увела бы
  // за собой чужой набор вариантов и чужую лицензию.
  const record = await deps.store.create({
    id: assetId,
    ownerId: input.ownerId,
    storageKey: key,
    mimeType: detected.mimeType,
    byteSize: cropped.length,
    sha256: createHash("sha256").update(cropped).digest("hex"),
    attribution: AVATAR_ATTRIBUTION,
    license: AVATAR_LICENSE,
    licenseNote: null
  })

  try {
    await deps.storage.put(key, cropped, { contentType: detected.mimeType })
  } catch (error) {
    await deps.store.setStatus(record.id, "failed")
    if (error instanceof StorageUnavailableError) throw storageUnavailableError(input.requestId)
    throw error
  }

  await deps.store.setStatus(record.id, "queued")
  const outcome = await runMediaProcessing(record.id, { ...deps, variantWidths: AVATAR_VARIANT_WIDTHS })
  if (outcome.result === "rejected") validationError(input.requestId, "file", outcome.rule)
  if (outcome.result !== "ready" && outcome.result !== "already_ready") {
    // Запись пропала между приёмом и обработкой: отвечать «готово» нечем.
    throw createApiError("INTERNAL_ERROR", { requestId: input.requestId })
  }

  const ready = await deps.store.findById(record.id)
  if (!ready) throw createApiError("INTERNAL_ERROR", { requestId: input.requestId })
  return ready
}

/** Запись аватара так, как её читают резолверы: связи и адреса, без ключей хранилища. */
export interface AvatarAssetRecord {
  id: string
  processingStatus: MediaAssetRecord["processingStatus"]
  deletedAt: Date | null
  variants: unknown
}

export interface AvatarView {
  assetId: string
  /** Наибольший готовый вариант WebP: он читается всеми браузерами, которым показывается сайт. */
  url: string
  variants: PublicVariantSet
}

/** Поля записи, которых достаточно для показа аватара: набор вариантов и признаки готовности. */
export const avatarAssetSelect = {
  id: true,
  processingStatus: true,
  deletedAt: true,
  variants: true
} as const

/**
 * Аватар для ответа API. Не готовая, удалённая или ещё не собранная запись аватаром не считается:
 * публичен только вариант готового медиа (`access-and-signed-urls.md` п. 1), а интерфейсу вместо
 * пустой картинки нужны инициалы (`avatars.md` п. 1).
 */
export function avatarViewOf(asset: AvatarAssetRecord | null | undefined, mediaBaseUrl: string): AvatarView | null {
  if (!asset || asset.deletedAt || asset.processingStatus !== "ready") return null
  const items = readVariantSet(asset.variants).items.filter((item) => item.format === "webp")
  if (items.length === 0) return null

  const largest = items.reduce((left, right) => (right.width > left.width ? right : left))
  return {
    assetId: asset.id,
    url: publicMediaUrl(mediaBaseUrl, largest.key),
    variants: publicVariantSet(asset.variants, mediaBaseUrl)
  }
}

/** Адрес аватара для публичного профиля; без аватара — `null`, и страница показывает инициалы. */
export function avatarUrlOf(asset: AvatarAssetRecord | null | undefined, mediaBaseUrl: string): string | null {
  return avatarViewOf(asset, mediaBaseUrl)?.url ?? null
}
