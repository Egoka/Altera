import { accountAvatarView, removeAccountAvatar, revertAccountAvatar, uploadAccountAvatar } from "../../account/avatar"
import { createApiError } from "../../errors/graphql-error"
import { ensureAuthenticated } from "../../exceptions/permissions"
import type { SquareCrop, UploadSource } from "../../media"
import type { GraphQLContext } from "../../prisma"

// Точки входа аватара (`85-media-and-binary/avatars.md`, `30-account/reader/profile-edit.md` §4).
// Резолвер переводит файл multipart-запроса в источник байтов и сверяет владельца поля; правила
// применения, предыдущей версии и отката ведёт `account/avatar.ts`.

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

export default {
  Mutation: {
    uploadAvatar: async (_parent: unknown, args: { file: unknown; crop?: SquareCrop | null }, ctx: GraphQLContext) => {
      if (!isUploadedBlob(args.file)) {
        throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "file", rule: "required" })
      }
      return uploadAccountAvatar(ctx, { file: toUploadSource(args.file), crop: args.crop ?? null })
    },

    removeAvatar: (_parent: unknown, _args: unknown, ctx: GraphQLContext) => removeAccountAvatar(ctx),

    revertAvatar: (_parent: unknown, args: { userId: string; reason: string }, ctx: GraphQLContext) =>
      revertAccountAvatar(ctx, args)
  },

  AccountUser: {
    /**
     * Поля своей записи: сверка `parent.id` с текущим пользователем не даёт прочитать аватар
     * чужого аккаунта через типы, у которых тот же `AccountUser` (матрица #6).
     */
    avatar: async (parent: { id: string; avatarAssetId: string | null }, _args: unknown, ctx: GraphQLContext) =>
      accountAvatarView(ctx, ownAssetId(parent, parent.avatarAssetId, ctx)),

    previousAvatar: async (parent: { id: string; prevAvatarId: string | null }, _args: unknown, ctx: GraphQLContext) =>
      accountAvatarView(ctx, ownAssetId(parent, parent.prevAvatarId, ctx))
  }
}

function ownAssetId(parent: { id: string }, assetId: string | null, ctx: GraphQLContext): string | null {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  if (parent.id !== user.id) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "profile.update" })
  }
  return assetId
}
