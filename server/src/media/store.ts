import { Prisma, type PrismaClient } from "../generated/prisma"
import type { MediaOrphanRecord, MediaOrphanStore } from "./orphans"
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
  focalX: true,
  focalY: true,
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
      //
      // Аватары исключены связью, а не признаком в записи: назначение файла определяет связь в
      // базе (`storage-layout.md` п. 3). У аватара свой квадратный набор вариантов и пустая
      // атрибуция (`avatars.md` п. 2–3), поэтому отдать его как медиа статьи значило бы и
      // показать обрезанный кадр, и обойти обязательную лицензию.
      return client.mediaAsset.findFirst({
        where: {
          ownerId,
          sha256,
          deletedAt: null,
          currentAvatarUsers: { none: {} },
          previousAvatarUsers: { none: {} }
        },
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
    },

    async saveFocal(id, focal) {
      // Фокус пишется парой: половина точки кадр не задаёт, и `focalOf` такую пару читает как центр.
      return client.mediaAsset.update({
        where: { id },
        data: { focalX: focal?.x ?? null, focalY: focal?.y ?? null },
        select: assetSelect
      })
    },

    async saveAltWithAudit({ assetId, alt, audit }) {
      // Одна транзакция: исправление администратора без записи в журнале недопустимо (#75).
      return client.$transaction(async (transaction) => {
        const saved = await transaction.mediaAsset.update({
          where: { id: assetId },
          data: { alt },
          select: assetSelect
        })
        await transaction.auditLog.create({
          data: {
            action: audit.action,
            actorId: audit.actorId,
            actorRole: audit.actorRole,
            entityType: audit.entityType,
            entityId: audit.entityId,
            diff: audit.diff as Prisma.InputJsonValue,
            requestId: audit.requestId
          },
          select: { id: true }
        })
        return saved
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

/**
 * Выборка сирот (`retention-and-orphans.md` §2 п. 5) на SQL: ссылка из документа живёт внутри
 * JSONB-тела узлом `figure` (`@altera/content`), и условие «на медиа никто не ссылается» иначе
 * не выразить — `jsonb_path_exists` обходит документ целиком, как прореживание `autosave` в
 * housekeeping. Статус материала в условиях не участвует: архив закрывает доступ к файлу, но
 * связь остаётся (журнал #11, #28), поэтому медиа архивированной статьи в выборку не попадает.
 *
 * Окно тишины проверяется и по `createdAt`, и по `updatedAt`: запись, которую только что
 * создала загрузка или только что изменил конвейер, сиротой не считается, даже если связь с
 * документом ещё не появилась.
 */
export function createPrismaMediaOrphanStore(client: PrismaClient): MediaOrphanStore {
  return {
    async findOrphans({ quietBefore, limit }) {
      return client.$queryRaw<MediaOrphanRecord[]>(Prisma.sql`
        SELECT m."id", m."storageKey", m."byteSize", m."variants"
        FROM "media_assets" AS m
        WHERE m."createdAt" < ${quietBefore}
          AND m."updatedAt" < ${quietBefore}
          AND NOT EXISTS (SELECT 1 FROM "articles" AS a WHERE a."coverAssetId" = m."id")
          AND NOT EXISTS (
            SELECT 1 FROM "users" AS u WHERE u."avatarAssetId" = m."id" OR u."prevAvatarId" = m."id"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "article_translations" AS t
            WHERE jsonb_path_exists(t."body", '$.**.assetId ? (@ == $assetId)', jsonb_build_object('assetId', m."id"))
          )
          AND NOT EXISTS (
            SELECT 1 FROM "article_revisions" AS r
            WHERE jsonb_path_exists(r."body", '$.**.assetId ? (@ == $assetId)', jsonb_build_object('assetId', m."id"))
          )
        ORDER BY m."createdAt" ASC
        LIMIT ${limit}
      `)
    },

    async deleteAsset(id) {
      // `deleteMany`, а не `delete`: отсутствие записи здесь — обычный исход параллельного
      // прохода или «удалить навсегда», а не ошибка.
      const { count } = await client.mediaAsset.deleteMany({ where: { id } })
      return count > 0
    }
  }
}
