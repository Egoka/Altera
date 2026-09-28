import type { Prisma, PrismaClient } from "../generated/prisma"
import type { MediaAssetStore, MediaTranslationLookup, MediaTranslationOwner } from "./types"

// Истина о файле — запись `MediaAsset` (`storage-layout.md` п. 2). Выборка закрыта перечнем полей:
// конвейеру не нужны ни связи, ни поля, которые появятся у следующих задач эпика.

const assetSelect = {
  id: true,
  ownerId: true,
  processingStatus: true,
  storageKey: true,
  mimeType: true,
  byteSize: true,
  width: true,
  height: true,
  sha256: true,
  attribution: true,
  license: true,
  licenseNote: true,
  alt: true,
  caption: true,
  variants: true,
  deletedAt: true,
  createdAt: true
} as const

export function createPrismaMediaAssetStore(client: PrismaClient): MediaAssetStore {
  return {
    async findById(id) {
      return client.mediaAsset.findUnique({ where: { id }, select: assetSelect })
    },

    async findByChecksum({ ownerId, sha256 }) {
      // Один и тот же файл мог загружаться несколько раз до того, как дедупликация появилась:
      // берётся самая старая запись, чтобы результат не зависел от порядка чтения.
      return client.mediaAsset.findFirst({
        where: { ownerId, sha256, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: assetSelect
      })
    },

    async create(input) {
      return client.mediaAsset.create({
        data: {
          id: input.id,
          ownerId: input.ownerId,
          kind: "image",
          processingStatus: "uploading",
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          sha256: input.sha256,
          attribution: input.attribution,
          license: input.license,
          licenseNote: input.licenseNote
        },
        select: assetSelect
      })
    },

    async setStatus(id, status) {
      return client.mediaAsset.update({ where: { id }, data: { processingStatus: status }, select: assetSelect })
    },

    async saveMaster(id, input) {
      return client.mediaAsset.update({
        where: { id },
        data: {
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          width: input.width,
          height: input.height
        },
        select: assetSelect
      })
    },

    async saveVariants(id, variants) {
      return client.mediaAsset.update({
        where: { id },
        // Набор — единое значение колонки: частичный набор переписывает прежний целиком.
        data: { variants: variants as unknown as Prisma.InputJsonValue },
        select: assetSelect
      })
    }
  }
}

export function createPrismaTranslationLookup(client: PrismaClient): MediaTranslationLookup {
  return {
    async findTranslationOwner(translationId) {
      const translation = await client.articleTranslation.findUnique({
        where: { id: translationId },
        select: { id: true, article: { select: { authorId: true, isEditorial: true } } }
      })
      if (!translation) return null
      const owner: MediaTranslationOwner = {
        translationId: translation.id,
        authorId: translation.article.authorId,
        isEditorial: translation.article.isEditorial
      }
      return owner
    }
  }
}
