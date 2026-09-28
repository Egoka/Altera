import type { PrismaClient } from "../generated/prisma"
import { registerJobHandler } from "../jobs/job-handlers"
import type { PrismaJobStore } from "../jobs/prisma-job-store"
import type { ObjectStorage } from "../storage/types"
import { MEDIA_PROCESS_JOB_KIND, runMediaProcessing, type MediaProcessingDeps } from "./pipeline"
import { createSharpImageProcessor } from "./sharp-processor"
import { createPrismaMediaAssetStore, createPrismaTranslationLookup } from "./store"
import { acceptAvatarUpload, type AvatarUploadDeps, type AvatarUploadInput } from "./avatars"
import { applyCoverFocal, type CoverFocalDeps } from "./covers"
import { acceptMediaUpload, type AcceptUploadInput, type MediaUploadDeps } from "./upload"
import type {
  FocalPoint,
  ImageProcessor,
  MediaAssetRecord,
  MediaProcessingQueue,
  MediaTranslationLookup
} from "./types"

export { MEDIA_PROCESS_JOB_KIND, runMediaProcessing, type MediaProcessingOutcome } from "./pipeline"
export { acceptMediaUpload, isMediaLicense, MEDIA_LICENSES } from "./upload"
export {
  acceptAvatarUpload,
  avatarAssetSelect,
  avatarUrlOf,
  avatarViewOf,
  centerSquare,
  type AvatarAssetRecord,
  type AvatarUploadInput,
  type AvatarView
} from "./avatars"
export {
  CARD_VARIANT_CROPS,
  CENTER_FOCAL,
  COVER_CROP_RATIOS,
  COVER_CROPS,
  coverCropRect,
  focalCropRect,
  focalOf,
  isFocalShare,
  sameFocal,
  type ArticleCardVariant
} from "./cover-crops"
export {
  applyCoverFocal,
  coverAssetSelect,
  coverViewOf,
  isCoverReady,
  type CoverAssetRecord,
  type CoverView
} from "./covers"
export { detectImageFormat } from "./formats"
export { AVATAR_VARIANT_WIDTHS, MAX_IMAGE_PIXELS, MAX_UPLOAD_BYTES, MIN_IMAGE_SIDE, VARIANT_WIDTHS } from "./limits"
export { planAllVariants, planCropVariants, planVariants, variantWidthsFor, THUMBNAIL_WIDTH } from "./variant-matrix"
export {
  cropsFor,
  ensureVariants,
  publicVariantSet,
  readVariantSet,
  type PublicVariant,
  type PublicVariantSet
} from "./variants"
export { createSharpImageProcessor } from "./sharp-processor"
export { createPrismaMediaAssetStore, createPrismaTranslationLookup } from "./store"
export {
  MediaRejectedError,
  type CropRect,
  type FocalPoint,
  type ImageProcessor,
  type MediaAssetRecord,
  type MediaAssetStore,
  type MediaProcessingQueue,
  type MediaTranslationLookup,
  type SquareCrop,
  type UploadSource
} from "./types"

/**
 * Сервис медиа в контексте API: приём загрузки и поиск владельца версии. Обработка идёт заданием
 * очереди, поэтому наружу отдаётся только точка входа, а не шаги конвейера.
 */
export interface MediaService {
  readonly uploadEnabled: boolean
  /** Префикс публичных адресов вариантов: ключи хранятся в базе, домен подставляется при чтении. */
  readonly mediaBaseUrl: string
  translations: MediaTranslationLookup
  upload(input: AcceptUploadInput): Promise<MediaAssetRecord>
  /**
   * Приём аватара: кадр автора, карантин и обработка до готовой записи в одном вызове. Очереди
   * здесь нет — аватар применяется сразу (журнал §29.5), поэтому мутация отвечает уже готовым
   * файлом. Связь с аккаунтом ведёт `account/avatar.ts`, а не сервис медиа.
   */
  uploadAvatar(input: AvatarUploadInput): Promise<MediaAssetRecord>
  /**
   * Фокусная точка обложки и кадры карточек по ней (`article-covers.md` п. 3). Как и у аватара,
   * очереди здесь нет: автор выбирает кадрирование с предпросмотром и должен увидеть результат
   * выбора, а не обещание задания.
   */
  setCoverFocal(input: { assetId: string; focal: FocalPoint | null }): Promise<MediaAssetRecord>
}

export interface MediaServiceOptions {
  client: PrismaClient
  jobStore: Pick<PrismaJobStore, "enqueue">
  storage: ObjectStorage
  mediaBaseUrl: string
  processor?: ImageProcessor
  /**
   * Журнал §33 п. 3: до утверждения владельцем числовых порогов конвейера загрузка пользователям
   * не открывается. Признак держит это ограничение в коде, а не только в отсутствии интерфейса.
   */
  uploadEnabled?: boolean
}

export function createMediaProcessingQueue(jobStore: Pick<PrismaJobStore, "enqueue">): MediaProcessingQueue {
  return {
    async enqueue({ assetId, requestId }) {
      await jobStore.enqueue({
        kind: MEDIA_PROCESS_JOB_KIND,
        parameters: { assetId },
        objectType: "mediaAsset",
        objectId: assetId,
        originRequestId: requestId
      })
    }
  }
}

function readAssetId(parameters: unknown): string | null {
  if (typeof parameters !== "object" || parameters === null) return null
  const { assetId } = parameters as { assetId?: unknown }
  return typeof assetId === "string" && assetId.length > 0 ? assetId : null
}

export function registerMediaProcessingJob(deps: MediaProcessingDeps): void {
  registerJobHandler(MEDIA_PROCESS_JOB_KIND, async (job) => {
    const assetId = readAssetId(job.parameters)
    if (!assetId) throw new Error(`${MEDIA_PROCESS_JOB_KIND} job without assetId`)
    await runMediaProcessing(assetId, deps)
  })
}

/** Сборка сервиса и регистрация задания обработки одним вызовом при старте процесса. */
export function createMediaService(options: MediaServiceOptions): MediaService {
  const store = createPrismaMediaAssetStore(options.client)
  const processor = options.processor ?? createSharpImageProcessor()
  const queue = createMediaProcessingQueue(options.jobStore)
  registerMediaProcessingJob({ store, storage: options.storage, processor })

  const uploadDeps: MediaUploadDeps = { store, storage: options.storage, queue }
  const avatarDeps: AvatarUploadDeps = { store, storage: options.storage, processor }
  const coverDeps: CoverFocalDeps = { store, storage: options.storage, processor }
  return {
    uploadEnabled: options.uploadEnabled ?? false,
    mediaBaseUrl: options.mediaBaseUrl,
    translations: createPrismaTranslationLookup(options.client),
    upload: (input) => acceptMediaUpload(input, uploadDeps),
    uploadAvatar: (input) => acceptAvatarUpload(input, avatarDeps),
    setCoverFocal: ({ assetId, focal }) => applyCoverFocal(assetId, focal, coverDeps)
  }
}

/** Признак открытой загрузки из окружения: по умолчанию выключена (журнал §33 п. 3). */
export function isMediaUploadEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.MEDIA_UPLOAD_ENABLED === "true"
}
