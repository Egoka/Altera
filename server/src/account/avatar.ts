import { authorCacheTag } from "../cache"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, ensurePermission } from "../exceptions/permissions"
import { avatarAssetSelect, avatarViewOf, type AvatarView, type SquareCrop, type UploadSource } from "../media"
import type { GraphQLContext } from "../prisma"
import { persistAutomaticProfileCheck, runAutomaticProfileCheck } from "./profile-check"

/**
 * Аватар аккаунта (`docs/spec/85-media-and-binary/avatars.md`, журнал §29.5).
 *
 * Новая версия применяется публично сразу после технической обработки, без ожидания проверки;
 * прежняя остаётся в `User.prevAvatarId`, и рецензент может вернуть её с записью `profile.check`
 * (#85, `verdict: reverted`). Автоматическая проверка допустимости идёт следом отдельной задачей
 * (T-031 через адаптер T-048) и загрузку не блокирует.
 */

const UPLOAD_ACTION = "profile.update"
const REVIEW_ACTION = "profile.review.decide"

/** Поля аккаунта, которых достаточно для работы с аватаром: связи, состояние и тег кеша. */
const ownerSelect = {
  id: true,
  handle: true,
  avatarAssetId: true,
  prevAvatarId: true,
  isServiceAccount: true
} as const

/**
 * Страницу автора и каталог отдаёт публичный кеш (`author.md` §4), поэтому без сброса тегов
 * «виден сразу» не выполнялось бы: гость до конца TTL видел бы прежний аватар.
 */
async function invalidateAuthorViews(ctx: GraphQLContext, handle: string): Promise<void> {
  await ctx.cache.delByTags([authorCacheTag(handle), "home"])
}

/**
 * Свой профиль меняет владелец аккаунта (матрица #48 — «свои»). Служебная запись публичного
 * профиля не имеет (журнал §25.2), поэтому аватара у неё не бывает; ограниченная сессия
 * архивированного аккаунта дальше экрана состояния не идёт (`session-lifecycle.md` п. 7).
 */
function ensureAvatarOwner(ctx: GraphQLContext, action: string) {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  if (user.isServiceAccount || user.archivedAt) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action })
  }
  return user
}

async function loadOwner(ctx: GraphQLContext, id: string) {
  const owner = await ctx.prisma.user.findUnique({ where: { id }, select: ownerSelect })
  if (!owner) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "user" })
  return owner
}

async function currentAvatarView(ctx: GraphQLContext, assetId: string | null): Promise<AvatarView | null> {
  if (!assetId) return null
  const asset = await ctx.prisma.mediaAsset.findUnique({ where: { id: assetId }, select: avatarAssetSelect })
  return avatarViewOf(asset, ctx.media.mediaBaseUrl)
}

export interface UploadAvatarInput {
  file: UploadSource
  crop?: SquareCrop | null
}

/**
 * Загрузка аватара (`profile-edit.md` §4, §7). Порядок шагов — `permission-checks.md` §2 п. 3:
 * сперва права, затем корзина лимита, и только потом работа с файлом.
 */
export async function uploadAccountAvatar(ctx: GraphQLContext, input: UploadAvatarInput): Promise<AvatarView | null> {
  const user = ensureAvatarOwner(ctx, UPLOAD_ACTION)
  // Журнал §33 п. 3: до утверждения владельцем числовых порогов конвейера загрузка пользователям
  // не открывается — у аватара те же пороги, что и у медиа статьи.
  if (!ctx.media.uploadEnabled) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: UPLOAD_ACTION })
  }
  await ctx.rateLimiter.enforce("media.upload.user", user.id, {
    requestId: ctx.requestId,
    ip: ctx.requestMeta?.ip
  })

  const asset = await ctx.media.uploadAvatar({
    ownerId: user.id,
    file: input.file,
    crop: input.crop ?? null,
    requestId: ctx.requestId
  })

  // Прежняя версия становится предыдущей — её возвращает рецензент (журнал §29.5). Более старые
  // связей не сохраняют и уходят в сироты (`retention-and-orphans.md`).
  await ctx.prisma.user.update({
    where: { id: user.id },
    data: {
      prevAvatarId: user.avatarAssetId,
      avatarAssetId: asset.id,
      avatarCheckStatus: "pending",
      avatarCheckReason: null
    }
  })

  // Профиль использует тот же адаптер T-048. Отказ автоматики не скрывает аватар: он переводит
  // версию в ручную очередь, где рецензент может вернуть `prevAvatarId`.
  const checkInput = {
    userId: user.id,
    field: "avatar" as const,
    locale: user.locale,
    value: asset.id,
    versionId: asset.id,
    images: [
      {
        assetId: asset.id,
        role: "cover" as const,
        alt: asset.alt,
        caption: asset.caption,
        attribution: asset.attribution,
        license: asset.license,
        licenseNote: asset.licenseNote
      }
    ]
  }
  const check = await runAutomaticProfileCheck(ctx, checkInput)
  await ctx.prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: user.id, avatarAssetId: asset.id },
      data: { avatarCheckStatus: check.status }
    })
    if (updated.count !== 1) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "avatar",
        expected: asset.id,
        actual: "changed"
      })
    }
    await persistAutomaticProfileCheck(tx, ctx, checkInput, check)
  })
  await invalidateAuthorViews(ctx, user.handle)

  return avatarViewOf(asset, ctx.media.mediaBaseUrl)
}

/**
 * Удаление аватара (`avatars.md` п. 8): запись помечается `deletedAt`, файл чистится по политике
 * ретенции. Возвращать после удаления нечего, поэтому предыдущая версия тоже отвязывается —
 * иначе рецензент вернул бы аккаунту картинку, от которой пользователь уже отказался.
 */
export async function removeAccountAvatar(ctx: GraphQLContext, now = new Date()): Promise<null> {
  const user = ensureAvatarOwner(ctx, UPLOAD_ACTION)
  await ctx.rateLimiter.enforce("account.mutation.user", user.id, {
    requestId: ctx.requestId,
    ip: ctx.requestMeta?.ip
  })

  const owner = await loadOwner(ctx, user.id)
  // Повторный вызов без аватара ничего не меняет: удалять нечего, и ошибки здесь нет.
  if (!owner.avatarAssetId && !owner.prevAvatarId) return null

  await ctx.prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: owner.id },
      data: { avatarAssetId: null, prevAvatarId: null, avatarCheckStatus: "ok", avatarCheckReason: null }
    })
    if (owner.avatarAssetId) {
      await tx.mediaAsset.updateMany({
        where: { id: owner.avatarAssetId, deletedAt: null },
        data: { deletedAt: now }
      })
    }
  })
  await invalidateAuthorViews(ctx, owner.handle)

  return null
}

export interface RevertAvatarInput {
  userId: string
  /** Причина словами для автора; внутренних признаков проверки в ней нет (`profile-edit.md` §4). */
  reason: string
}

/**
 * Откат аватара к предыдущей версии (матрица #120, журнал §29.5). Отклонённая версия связей не
 * сохраняет и становится сиротой; запись `deletedAt` ей не ставится — файл остаётся до плановой
 * чистки (`retention-and-orphans.md`), а основанием отката служит запись журнала.
 */
export async function revertAccountAvatar(ctx: GraphQLContext, input: RevertAvatarInput): Promise<AvatarView | null> {
  const actor = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  ensurePermission(actor, "moderate", REVIEW_ACTION, ctx.requestId)

  const target = await loadOwner(ctx, input.userId)
  // Возвращать нечего: прежней версии у аккаунта нет (`NOT_FOUND`, `CONFLICT` — матрица #120).
  if (!target.prevAvatarId) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "avatar",
      expected: "previousVersion",
      actual: "none"
    })
  }

  const reason = input.reason.trim()
  if (!reason) {
    throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "reason", rule: "required" })
  }
  const restoredId = target.prevAvatarId
  await ctx.prisma.$transaction(async (tx) => {
    const reverted = await tx.user.updateMany({
      // Условие держит одновременный откат двумя рецензентами: второй не переставит связи ещё раз.
      where: { id: target.id, prevAvatarId: restoredId },
      data: {
        avatarAssetId: restoredId,
        prevAvatarId: null,
        avatarCheckStatus: "rejected",
        avatarCheckReason: reason
      }
    })
    if (reverted.count !== 1) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "avatar",
        expected: "previousVersion",
        actual: "changed"
      })
    }

    await tx.auditLog.create({
      data: {
        action: "profile.check",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: target.id,
        diff: {
          userId: target.id,
          field: "avatar",
          verdict: "reverted",
          byRole: actor.role,
          // Идентификаторы обеих версий: по записи журнала видно, что именно вернули и взамен чего.
          restoredAssetId: restoredId,
          revertedAssetId: target.avatarAssetId,
          reason
        },
        requestId: ctx.requestId
      }
    })
  })
  await invalidateAuthorViews(ctx, target.handle)

  return currentAvatarView(ctx, restoredId)
}

/** Аватар аккаунта для своей карточки кабинета; `null` — аватара нет, показываются инициалы. */
export async function accountAvatarView(ctx: GraphQLContext, assetId: string | null): Promise<AvatarView | null> {
  return currentAvatarView(ctx, assetId)
}
