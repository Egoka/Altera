import { createApiError } from "../errors/graphql-error"
import { ensureActiveAuthor, ensureAuthenticated, ensurePermission } from "../exceptions/permissions"
import {
  CENTER_FOCAL,
  coverAssetSelect,
  coverViewOf,
  isCoverReady,
  isFocalShare,
  type CoverView,
  type FocalPoint
} from "../media"
import type { GraphQLContext } from "../prisma"
import type { PrismaClient } from "../generated/prisma"

/**
 * Обложка материала (`docs/spec/85-media-and-binary/article-covers.md`, журнал §29.1).
 *
 * Одна обложка на материал и общая для языковых версий: связь лежит на `Article`, а не на
 * `ArticleTranslation` (ADR-0002 — общие метаданные). Обложка обязательна перед публикацией:
 * подача без неё — `VALIDATION_ERROR` (`article-edit.md` §4).
 *
 * Смена обложки уже опубликованного материала идёт правкой в копии через AI-проверку
 * (`article-covers.md` п. 5, журнал §41) — это отдельная задача (T-122), и здесь опубликованный
 * материал обложку не меняет.
 */

const COVER_ACTION = "article.setCover"

/** Статусы, в которых автор правит метаданные версии (`article-edit.md` §4, `readOnlyReason`). */
const EDITABLE_STATUSES = new Set(["draft", "rework"])

const articleSelect = {
  id: true,
  authorId: true,
  isEditorial: true,
  status: true,
  coverAssetId: true
} as const

function validationError(ctx: Pick<GraphQLContext, "requestId">, field: string, rule: string): never {
  throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field, rule })
}

/** Автор версии или сотрудник с правом `editorial` для редакционного материала (матрица #39, #40). */
function ensureCoverActor(ctx: GraphQLContext) {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  if (user.role === "reader" || user.role === "author") {
    ensureActiveAuthor(user, COVER_ACTION, ctx.requestId, { logger: ctx.logger })
  } else {
    ensurePermission(user, "editorial", COVER_ACTION, ctx.requestId)
  }
  return user
}

async function loadArticle(ctx: GraphQLContext, articleId: string) {
  const article = await ctx.prisma.article.findUnique({ where: { id: articleId }, select: articleSelect })
  if (!article) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
  return article
}

export interface SetArticleCoverInput {
  articleId: string
  /** Запись медиа обложки; `null` снимает обложку у неопубликованного материала. */
  assetId: string | null
  /** Фокусная точка долями стороны; без неё — центр (`image-variants.md` §2 п. 3). */
  focal?: FocalPoint | null
}

/**
 * Выбор обложки и кадрирования. Кадры карточек собираются до возврата ответа: автор выбирает
 * кадрирование с предпросмотром, и ответ мутации показывает ему сделанный выбор, а не обещание
 * задания.
 */
export async function setArticleCover(ctx: GraphQLContext, input: SetArticleCoverInput): Promise<CoverView | null> {
  const user = ensureCoverActor(ctx)
  const article = await loadArticle(ctx, input.articleId)

  if (article.authorId !== user.id) {
    // Чужой материал открыт только сотруднику с `editorial` и только редакционный (журнал §17).
    if (!article.isEditorial) throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: COVER_ACTION })
    ensurePermission(user, "editorial", COVER_ACTION, ctx.requestId)
  }

  if (!EDITABLE_STATUSES.has(article.status)) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "article",
      expected: "draft",
      actual: article.status
    })
  }

  if (!input.assetId) {
    await ctx.prisma.article.update({ where: { id: article.id }, data: { coverAssetId: null } })
    return null
  }

  const focal = readFocal(ctx, input.focal)
  const asset = await ctx.prisma.mediaAsset.findUnique({
    where: { id: input.assetId },
    select: { ...coverAssetSelect, ownerId: true }
  })
  if (!asset || asset.deletedAt) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "mediaAsset" })
  // Свои медиа (матрица #40): обложкой ставится файл, который поставил сам действующий автор.
  if (asset.ownerId !== user.id) throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: COVER_ACTION })
  // Публичен только вариант готового медиа: незаконченная обработка обложкой стать не может.
  if (asset.processingStatus !== "ready") validationError(ctx, "cover", "processing")

  // Кадры делаются до связи: отказ обработки не должен оставить материал с обложкой без кадров.
  const ready = await ctx.media.setCoverFocal({ assetId: asset.id, focal })
  await ctx.prisma.article.update({ where: { id: article.id }, data: { coverAssetId: asset.id } })

  return coverViewOf(ready, ctx.media.mediaBaseUrl)
}

/**
 * Фокус выбора обложки. Без аргумента — центр изображения, а не пустое значение: кадры карточек
 * собираются по фокусу, и обложка без него не дошла бы до публикации (`article-covers.md` п. 2–3).
 * Так же ведёт себя аватар — без кадра берётся наибольший центральный квадрат (`avatars.md` п. 3).
 */
function readFocal(ctx: GraphQLContext, focal: FocalPoint | null | undefined): FocalPoint {
  if (!focal) return CENTER_FOCAL
  if (!isFocalShare(focal.x) || !isFocalShare(focal.y)) validationError(ctx, "focal", "range")
  return { x: focal.x, y: focal.y }
}

/** Обложка материала для ответа API; `null` — обложки нет или её запись не готова. */
export async function articleCoverView(ctx: GraphQLContext, assetId: string | null): Promise<CoverView | null> {
  if (!assetId) return null
  const asset = await ctx.prisma.mediaAsset.findUnique({ where: { id: assetId }, select: coverAssetSelect })
  return coverViewOf(asset, ctx.media.mediaBaseUrl)
}

/**
 * Обложка обязательна перед публикацией (журнал §29.1, `article-covers.md` п. 2): подача без неё
 * — `VALIDATION_ERROR`. Незаконченная запись обложкой тоже не считается: к моменту публикации
 * карточке нечего было бы показать, а дефолтных изображений в лентах нет (§29.1).
 */
type CoverSubmitContext = Pick<GraphQLContext, "requestId"> & {
  prisma: { mediaAsset: Pick<PrismaClient["mediaAsset"], "findUnique"> }
}

export async function ensureCoverBeforeSubmit(ctx: CoverSubmitContext, coverAssetId: string | null): Promise<void> {
  if (!coverAssetId) validationError(ctx, "cover", "required")
  const asset = await ctx.prisma.mediaAsset.findUnique({ where: { id: coverAssetId }, select: coverAssetSelect })
  if (!asset || asset.deletedAt) validationError(ctx, "cover", "required")
  if (!isCoverReady(asset)) validationError(ctx, "cover", "processing")
}
