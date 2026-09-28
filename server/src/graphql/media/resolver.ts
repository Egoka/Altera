import { createApiError } from "../../errors/graphql-error"
import { ensureActiveAuthor, ensureAuthenticated, ensurePermission, ensureRole } from "../../exceptions/permissions"
import { MEDIA_META_ACTION, publicVariantSet, type MediaAssetRecord, type UploadSource } from "../../media"
import type { GraphQLContext } from "../../prisma"

// Точка входа конвейера (`upload-pipeline.md` п. 1–4). Резолвер отвечает за права, лимит частоты и
// перевод файла multipart-запроса в источник байтов; проверки содержимого и статусы ведёт конвейер.

const UPLOAD_ACTION = "media.upload"

/** Форма файла multipart-запроса, которой достаточно конвейеру: длина и байты. */
interface UploadedBlob {
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

function isUploadedBlob(value: unknown): value is UploadedBlob {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<UploadedBlob>
  return typeof candidate.size === "number" && typeof candidate.arrayBuffer === "function"
}

function toUploadSource(blob: UploadedBlob): UploadSource {
  return {
    size: blob.size,
    bytes: async () => Buffer.from(await blob.arrayBuffer())
  }
}

/**
 * Медиа статьи загружает автор версии; редакционные материалы — сотрудник с правом `editorial`
 * (матрица #39). Истёкший план автора даёт `PLAN_LIMIT` (`article-edit.md` §4).
 */
async function ensureUploadAccess(ctx: GraphQLContext, translationId: string) {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  const owner = await ctx.media.translations.findTranslationOwner(translationId)
  if (!owner) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "articleTranslation" })

  if (owner.authorId === user.id) {
    if (user.role === "reader" || user.role === "author") {
      ensureActiveAuthor(user, UPLOAD_ACTION, ctx.requestId, { logger: ctx.logger })
      return user
    }
    ensurePermission(user, "editorial", UPLOAD_ACTION, ctx.requestId)
    return user
  }

  if (!owner.isEditorial) throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: UPLOAD_ACTION })
  ensurePermission(user, "editorial", UPLOAD_ACTION, ctx.requestId)
  return user
}

function asMediaAsset(record: MediaAssetRecord, mediaBaseUrl: string) {
  return {
    id: record.id,
    processingStatus: record.processingStatus,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    width: record.width,
    height: record.height,
    alt: record.alt,
    caption: record.caption,
    attribution: record.attribution,
    license: record.license,
    licenseNote: record.licenseNote,
    variants: publicVariantSet(record.variants, mediaBaseUrl),
    createdAt: record.createdAt.toISOString()
  }
}

export default {
  Mutation: {
    uploadMedia: async (
      _parent: unknown,
      args: { translationId: string; file: unknown; license: string; attribution: string },
      ctx: GraphQLContext
    ) => {
      const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
      // Журнал §33 п. 3: до утверждения владельцем числовых порогов конвейера загрузка
      // пользователям не открывается.
      if (!ctx.media.uploadEnabled) {
        throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: UPLOAD_ACTION })
      }
      if (!isUploadedBlob(args.file)) {
        throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "file", rule: "required" })
      }

      await ensureUploadAccess(ctx, args.translationId)
      // Корзина пользователя применяется после прав (`permission-checks.md` §2 п. 3).
      await ctx.rateLimiter.enforce("media.upload.user", user.id, {
        requestId: ctx.requestId,
        ip: ctx.requestMeta?.ip
      })

      const record = await ctx.media.upload({
        ownerId: user.id,
        file: toUploadSource(args.file),
        license: args.license,
        attribution: args.attribution,
        requestId: ctx.requestId
      })
      return asMediaAsset(record, ctx.media.mediaBaseUrl)
    },

    /**
     * Исправление `alt` у медиафайла. `ensureRole` пропускает `admin` и `owner` как полный
     * доступ; автору, рецензенту и остальным служебным ролям — `FORBIDDEN` (матрица #40).
     */
    adminUpdateMediaAlt: async (_parent: unknown, args: { assetId: string; alt: string }, ctx: GraphQLContext) => {
      ensureRole(ctx.currentUser, "admin", MEDIA_META_ACTION, ctx.requestId)
      const actor = ensureAuthenticated(ctx.currentUser, ctx.requestId)

      const record = await ctx.media.updateAlt({
        assetId: args.assetId,
        alt: args.alt,
        actor: { id: actor.id, role: actor.role },
        requestId: ctx.requestId
      })
      return asMediaAsset(record, ctx.media.mediaBaseUrl)
    }
  }
}
