/**
 * Обвязка редактора языковой версии (`docs/spec/30-account/author/article-edit.md`).
 *
 * Это первый писатель, который работает от `ArticleTranslation`, а не от наследной строки
 * `articles`. Каждое сохранение — снимок версии (журнал §6.7, ADR-0007), базовая ревизия
 * защищает от одновременной правки в двух вкладках (ADR-0033), подача проверяет обязательные
 * поля (рубрика — журнал §25.3, обложка — §29.1).
 *
 * Наследная строка ведётся здесь же. Trigger `t015_sync_legacy_article` синхронизирует версию
 * из `articles` и сам заводит ревизию; редактору это сломало бы и текст, и историю, поэтому
 * его транзакции выключают синхронизацию параметром сеанса `altera.legacy_sync` (миграция
 * `20260929130000_translation_first_editor`) и обновляют `articles` сами.
 */

import {
  ContentInvalidError,
  assertValidDocument,
  extractImages,
  toPlainText,
  type ContentDocument
} from "@altera/content"
import { Prisma, type PrismaClient } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import {
  ensureActiveAuthor,
  ensureAuthenticated,
  ensurePermission,
  hasActiveAuthorPlan
} from "../exceptions/permissions"
import { ensureCoverBeforeSubmit } from "../article/cover"
import { enqueueAiCheck } from "../ai/queue"
import { AI_CHECK_OBJECT_TYPE } from "../ai/store"
import { buildArticleCacheTags } from "../cache/key"
import type { GraphQLContext } from "../prisma"

/** Статусы, в которых автор правит версию (`article-edit.md` §4). */
const EDITABLE_STATUSES = new Set(["draft", "rework"])

/** Статусы, из которых версию можно отозвать (`article-edit.md` §7). */
const WITHDRAWABLE_STATUSES = new Set(["ai_check", "review", "in_review"])

/** Одновременно в очереди проверки не более пяти материалов (`rate-limits.md` п. 10). */
export const SUBMISSION_QUEUE_LIMIT = 5

const REVISION_PAGE_LIMIT = 50

/**
 * Почему редактор открыт только на чтение.
 *
 * Значения — перечень `article-edit.md` §4 плюс `published`. Спецификация его не называет, потому
 * что правка опубликованной версии идёт копией через AI-проверку (журнал §41); эта работа —
 * T-122, и до неё редактор показывает опубликованную версию режимом чтения, а не даёт записать
 * в публичный текст.
 */
export type ReadOnlyReason = "none" | "plan" | "rejected" | "archived" | "ai_check" | "in_review" | "published"

export const EDITOR_TRANSLATION_SELECT = {
  id: true,
  articleId: true,
  locale: true,
  slug: true,
  title: true,
  dek: true,
  excerpt: true,
  body: true,
  status: true,
  rejected: true,
  publishedAt: true,
  reeditUntil: true,
  reeditedAt: true,
  updatedAt: true,
  article: {
    select: {
      id: true,
      slug: true,
      authorId: true,
      author: { select: { name: true, handle: true, handleConfirmed: true } },
      isEditorial: true,
      status: true,
      sourceLocale: true,
      coverAssetId: true,
      firstPublishedAt: true,
      section: true,
      format: true,
      tags: true,
      translations: {
        select: { id: true, locale: true, status: true, rejected: true },
        orderBy: { locale: "asc" }
      }
    }
  },
  // Базовая ревизия сохранения — последняя в истории версии. Порядок дополнен идентификатором:
  // две ревизии одной секунды иначе менялись бы местами между запросами.
  revisions: {
    select: { id: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1
  }
} satisfies Prisma.ArticleTranslationSelect

export type EditorTranslation = Prisma.ArticleTranslationGetPayload<{ select: typeof EDITOR_TRANSLATION_SELECT }>

export interface EditorTranslationView extends EditorTranslation {
  currentRevisionId: string
  readOnlyReason: ReadOnlyReason
}

type EditorActor = NonNullable<GraphQLContext["currentUser"]>

/**
 * Тело из базы как документ каталога. Приведение, а не разбор: каждое записанное тело прошло
 * `assertValidDocument` при сохранении, а наследные тела конвертированы миграцией T-020 и
 * проверены `pnpm verify:legacy-bodies`.
 */
function asDocument(value: Prisma.JsonValue): ContentDocument {
  return value as unknown as ContentDocument
}

function validationError(ctx: GraphQLContext, field: string, rule: string): never {
  throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field, rule })
}

/**
 * Автор с активным планом или сотрудник с правом `editorial`. Проверки идут в порядке
 * `permission-checks.md` п. 3: сначала личность, потом роль, потом план.
 */
function ensureEditorActor(ctx: GraphQLContext, action: string): EditorActor {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  if (user.role === "reader" || user.role === "author") {
    ensureActiveAuthor(user, action, ctx.requestId, { logger: ctx.logger })
  } else {
    ensurePermission(user, "editorial", action, ctx.requestId)
  }
  return user
}

/**
 * Чтение редактора плана не требует: при истёкшем плане страница открывается в режиме чтения с
 * баннером, а не отказом (журнал #55, `article-edit.md` §8). Ограниченная сессия снятого
 * аккаунта — `FORBIDDEN`: по нему страница уводит на `/me/archived` (§8 строка «Заблокирован»).
 */
function ensureReaderActor(ctx: GraphQLContext): EditorActor {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  if (user.archivedAt) throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "translation.read" })
  return user
}

/**
 * Чужая версия отвечает `NOT_FOUND`, а не `FORBIDDEN`: существование чужого черновика наружу не
 * подтверждается (`article-edit.md` §3 `[ДОПУЩЕНИЕ]`).
 */
function ensureOwnTranslation(ctx: GraphQLContext, translation: EditorTranslation, user: EditorActor): void {
  if (translation.article.authorId === user.id) return
  // Редакционный материал журнала открыт действующему `editor` (журнал §17).
  if (translation.article.isEditorial && user.role !== "reader" && user.role !== "author") {
    ensurePermission(user, "editorial", "translation.read", ctx.requestId)
    return
  }
  throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "translation" })
}

function ensureOwnTranslationMutation(
  ctx: GraphQLContext,
  translation: EditorTranslation,
  user: EditorActor,
  action: string
): void {
  if (translation.article.authorId === user.id) return
  if (translation.article.isEditorial && user.role !== "reader" && user.role !== "author") {
    ensurePermission(user, "editorial", action, ctx.requestId)
    return
  }
  throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action })
}

export function readOnlyReasonFor(translation: EditorTranslation, user: EditorActor, now: Date): ReadOnlyReason {
  if (translation.article.status === "archived") return "archived"
  if (translation.rejected) return "rejected"
  if (translation.status === "ai_check") return "ai_check"
  if (translation.status === "review" || translation.status === "in_review") return "in_review"
  if (translation.status === "published") return "published"
  // Служебная роль плана не имеет: её доступ к редакционному материалу даёт право `editorial`.
  if ((user.role === "reader" || user.role === "author") && !hasActiveAuthorPlan(user, now)) return "plan"
  return "none"
}

function toView(
  ctx: GraphQLContext,
  translation: EditorTranslation,
  user: EditorActor,
  now: Date
): EditorTranslationView {
  const currentRevisionId = translation.revisions[0]?.id
  if (!currentRevisionId) {
    // Версия без ревизий — сломанные данные: черновик заводится вместе с первой ревизией.
    // Это `INTERNAL_ERROR` словаря, а не необработанное исключение: страница показывает строку
    // «Ошибка данных» (§8), а журнал не считает такой ответ сбоем без диагноза.
    throw createApiError("INTERNAL_ERROR", { requestId: ctx.requestId })
  }
  return { ...translation, currentRevisionId, readOnlyReason: readOnlyReasonFor(translation, user, now) }
}

async function loadTranslationFrom(
  ctx: Pick<GraphQLContext, "requestId">,
  client: PrismaClient | TransactionClient,
  id: string
): Promise<EditorTranslation> {
  const translation = await client.articleTranslation.findUnique({
    where: { id },
    select: EDITOR_TRANSLATION_SELECT
  })
  if (!translation) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "translation" })
  return translation
}

async function loadTranslation(ctx: GraphQLContext, id: string): Promise<EditorTranslation> {
  return loadTranslationFrom(ctx, ctx.prisma, id)
}

/** Версия для редактора: метаданные, тело, состояние и базовая ревизия. */
export async function getEditorTranslation(ctx: GraphQLContext, id: string): Promise<EditorTranslationView> {
  const user = ensureReaderActor(ctx)
  const translation = await loadTranslation(ctx, id)
  ensureOwnTranslation(ctx, translation, user)
  return toView(ctx, translation, user, new Date())
}

export interface SaveTranslationPatch {
  title?: string | null
  lead?: string | null
  body?: unknown
  seoDescription?: string | null
}

export interface SaveTranslationInput {
  id: string
  baseRevisionId: string
  patch: SaveTranslationPatch
  kind: "autosave" | "manual"
}

export interface SaveTranslationResult {
  revisionId: string
  savedAt: string
}

/** Документ тела проверяется каталогом до записи: в базу не попадает то, что не прочитает рендер. */
function readBodyPatch(ctx: GraphQLContext, body: unknown): ContentDocument {
  try {
    return assertValidDocument(body)
  } catch (error) {
    if (error instanceof ContentInvalidError) {
      const issue = error.errors[0]
      throw createApiError("CONTENT_INVALID", {
        requestId: ctx.requestId,
        path: issue?.path ?? "doc",
        node: issue?.code ?? "invalid"
      })
    }
    throw error
  }
}

/**
 * Сохранение версии: снимок ревизии и новые значения полей.
 *
 * `baseRevisionId` сверяется с последней ревизией. Устаревшая база — `CONFLICT`, и `expected`
 * называет свежую ревизию: по нему редактор предлагает открыть свежую версию или сохранить свой
 * текст копией (ADR-0033 — одновременного редактирования нет).
 */
export async function saveTranslation(
  ctx: GraphQLContext,
  input: SaveTranslationInput
): Promise<SaveTranslationResult> {
  const user = ensureEditorActor(ctx, "translation.save")
  const translation = await loadTranslation(ctx, input.id)
  ensureOwnTranslation(ctx, translation, user)

  if (!EDITABLE_STATUSES.has(translation.status) || translation.rejected) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "translation.save" })
  }
  if (translation.article.status === "archived") {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "translation.save" })
  }

  const currentRevisionId = translation.revisions[0]?.id ?? null
  if (currentRevisionId !== input.baseRevisionId) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "revision",
      expected: currentRevisionId ?? "",
      actual: input.baseRevisionId
    })
  }

  const body = input.patch.body === undefined ? asDocument(translation.body) : readBodyPatch(ctx, input.patch.body)
  const title = input.patch.title === undefined ? translation.title : (input.patch.title ?? "")
  const lead = input.patch.lead === undefined ? translation.dek : normalizeOptional(input.patch.lead)
  const excerpt =
    input.patch.seoDescription === undefined ? translation.excerpt : normalizeOptional(input.patch.seoDescription)

  const saved = await writeTranslationSnapshot(ctx, {
    translation,
    actorId: user.id,
    baseRevisionId: input.baseRevisionId,
    kind: input.kind,
    data: { title, dek: lead, excerpt, body }
  })

  return { revisionId: saved.revisionId, savedAt: saved.savedAt.toISOString() }
}

function normalizeOptional(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

interface SnapshotInput {
  translation: EditorTranslation
  actorId: string
  kind: "autosave" | "manual"
  data: { title: string; dek: string | null; excerpt: string | null; body: ContentDocument }
  restoredFromId?: string
  baseRevisionId?: string
}

/**
 * Запись версии и её снимка одной транзакцией. Наследная строка обновляется здесь же, с
 * выключенным trigger: иначе он переписал бы версию наследными значениями и добавил вторую
 * ревизию к той, которую заводит редактор.
 */
async function writeTranslationSnapshot(
  ctx: GraphQLContext,
  input: SnapshotInput
): Promise<{ revisionId: string; savedAt: Date }> {
  const { translation, data } = input
  const bodyValue = data.body as unknown as Prisma.InputJsonValue

  return ctx.prisma.$transaction(async (tx) => {
    await lockTranslation(tx, translation.id)
    const current = await loadTranslationFrom(ctx, tx, translation.id)
    if (!EDITABLE_STATUSES.has(current.status) || current.rejected || current.article.status === "archived") {
      throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "translation.save" })
    }
    if (input.baseRevisionId !== undefined) {
      const currentRevisionId = current.revisions[0]?.id ?? null
      if (currentRevisionId !== input.baseRevisionId) {
        throw createApiError("CONFLICT", {
          requestId: ctx.requestId,
          entity: "revision",
          expected: currentRevisionId ?? "",
          actual: input.baseRevisionId
        })
      }
    }
    await disableLegacySync(tx)

    const revision = await tx.articleRevision.create({
      data: {
        translationId: translation.id,
        title: data.title,
        dek: data.dek,
        excerpt: data.excerpt,
        body: bodyValue,
        kind: input.kind,
        createdById: input.actorId,
        restoredFromId: input.restoredFromId
      },
      select: { id: true, createdAt: true }
    })

    await tx.articleTranslation.update({
      where: { id: translation.id },
      data: { title: data.title, dek: data.dek, excerpt: data.excerpt, body: bodyValue }
    })

    await mirrorLegacyArticle(tx, translation, { ...data, status: null })

    return { revisionId: revision.id, savedAt: revision.createdAt }
  })
}

type TransactionClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">

async function lockTranslation(tx: TransactionClient, translationId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "article_translations" WHERE "id" = ${translationId} FOR UPDATE
  `)
}

async function lockAuthor(tx: TransactionClient, authorId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${authorId} FOR UPDATE`)
}

/**
 * Выключает синхронизацию наследной строки до конца транзакции. Параметр сеанса, а не изменение
 * схемы: `SET LOCAL` действует только внутри этой транзакции и на соседние запросы не влияет.
 */
async function disableLegacySync(tx: TransactionClient): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL "altera.legacy_sync" = 'off'`)
}

/**
 * Зеркало наследной строки `articles`.
 *
 * Пишется только для версии исходной локали: наследная строка одна на материал, второй языковой
 * версии в ней места нет (F-09). В `articles.body` кладётся сериализованный документ: если
 * trigger когда-нибудь сработает со стороны (архив из кабинета, админка), он разберёт эту строку
 * обратно в документ без потерь, а плоский текст на его месте потерял бы заголовки и изображения.
 */
async function mirrorLegacyArticle(
  tx: TransactionClient,
  translation: EditorTranslation,
  data: { title: string; dek: string | null; excerpt: string | null; body: ContentDocument; status: string | null }
): Promise<void> {
  if (translation.locale !== translation.article.sourceLocale) return

  await tx.article.update({
    where: { id: translation.articleId },
    data: {
      title: data.title,
      dek: data.dek,
      excerpt: data.excerpt,
      body: JSON.stringify(data.body),
      ...(data.status ? { status: data.status as never } : {})
    }
  })
}

/**
 * Подача к публикации (`article-edit.md` §4, §7).
 *
 * Проверки — те же, что назовёт интерфейс до нажатия: заголовок, текст, рубрика, обложка, а
 * перед первой публикацией — публичное имя и адрес профиля (§25.4). Переход в `ai_check` и
 * Первая подача атомарно переходит в `ai_check` вместе с заданием; после сохранённого отказа AI
 * повторная подача идёт прямо в редакционное `review` без нового задания.
 */
export async function submitTranslation(ctx: GraphQLContext, id: string): Promise<EditorTranslationView> {
  const user = ensureEditorActor(ctx, "translation.submit")
  const translation = await loadTranslation(ctx, id)
  ensureOwnTranslationMutation(ctx, translation, user, "translation.submit")

  if (!EDITABLE_STATUSES.has(translation.status) || translation.rejected) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "translation",
      expected: "draft",
      actual: translation.rejected ? "rejected" : translation.status
    })
  }

  const now = new Date()
  const submitted = await ctx.prisma.$transaction(async (tx) => {
    await lockTranslation(tx, translation.id)
    const current = await loadTranslationFrom(ctx, tx, translation.id)
    ensureOwnTranslationMutation(ctx, current, user, "translation.submit")
    if (!EDITABLE_STATUSES.has(current.status) || current.rejected) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "translation",
        expected: "draft",
        actual: current.rejected ? "rejected" : current.status
      })
    }

    await lockAuthor(tx, current.article.authorId)
    if (current.title.trim() === "") validationError(ctx, "title", "required")
    if (toPlainText(asDocument(current.body)).trim() === "") validationError(ctx, "body", "required")
    if (!current.article.section) validationError(ctx, "sectionId", "required")
    if (current.article.section.status !== "active") validationError(ctx, "sectionId", "active")
    await ensureCoverBeforeSubmit({ requestId: ctx.requestId, prisma: tx }, current.article.coverAssetId)
    await ensureImageLicenses(ctx, tx, current)
    // Первая публикация требует публичной личности автора: имени и явно сохранённого хэндла (T-031).
    // Редакционная статья выходит от имени журнала (T-052), поэтому у сотрудника проверяется только
    // заполненность профиля, как до T-031.
    const author = current.article.author
    const handleMissing = current.article.isEditorial ? author.handle.trim() === "" : !author.handleConfirmed
    if (!current.article.firstPublishedAt && (author.name.trim() === "" || handleMissing)) {
      validationError(ctx, "profile", "required")
    }
    await ensureSubmissionQueue(ctx, tx, current.article.authorId)

    const previousAiReject = await tx.aiProcess.findFirst({
      where: {
        kind: "check",
        status: "completed",
        objectType: AI_CHECK_OBJECT_TYPE,
        objectId: current.id,
        verdict: "reject"
      },
      select: { id: true }
    })
    const targetStatus: EditorTranslation["status"] =
      previousAiReject || current.status === "rework" ? "review" : "ai_check"
    let revisionId = current.revisions[0]?.id
    if (!revisionId) throw createApiError("INTERNAL_ERROR", { requestId: ctx.requestId })

    if (targetStatus === "ai_check") {
      const previousCheck = await tx.aiProcess.findFirst({
        where: { objectType: AI_CHECK_OBJECT_TYPE, objectId: current.id, revisionId },
        select: { id: true }
      })
      if (previousCheck) {
        const replacement = await tx.articleRevision.create({
          data: {
            translationId: current.id,
            title: current.title,
            dek: current.dek,
            excerpt: current.excerpt,
            body: current.body as Prisma.InputJsonValue,
            kind: "manual",
            createdById: user.id
          },
          select: { id: true }
        })
        revisionId = replacement.id
      }
    }

    await disableLegacySync(tx)
    const changed = await tx.articleTranslation.updateMany({
      where: { id: current.id, status: current.status, rejected: false },
      data: { status: targetStatus }
    })
    if (changed.count !== 1) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "translation",
        expected: current.status,
        actual: "changed"
      })
    }
    await mirrorLegacyArticle(tx, current, {
      title: current.title,
      dek: current.dek,
      excerpt: current.excerpt,
      body: asDocument(current.body),
      status: targetStatus
    })
    const enqueued =
      targetStatus === "review"
        ? null
        : await enqueueAiCheck(tx, { translationId: current.id, revisionId, requestId: ctx.requestId })
    return { current, targetStatus, revisionId, enqueued }
  })

  if (submitted.enqueued) {
    ctx.logger.log({
      level: "info",
      event: "ai.job.created",
      jobId: submitted.enqueued.jobId,
      originRequestId: ctx.requestId,
      message: "AI check job created",
      data: { kind: "check", translationId: submitted.current.id, revisionId: submitted.revisionId }
    })
  }

  ctx.logger.log({
    level: "info",
    event: "translation.submit",
    requestId: ctx.requestId,
    message: "Translation submitted for review",
    data: { translationId: submitted.current.id, status: submitted.targetStatus }
  })

  return toView(
    ctx,
    {
      ...submitted.current,
      status: submitted.targetStatus,
      updatedAt: now,
      revisions: [{ id: submitted.revisionId }]
    },
    user,
    now
  )
}

async function ensureImageLicenses(
  ctx: GraphQLContext,
  client: PrismaClient | TransactionClient,
  translation: EditorTranslation
): Promise<void> {
  const assetIds = [
    ...(translation.article.coverAssetId ? [translation.article.coverAssetId] : []),
    ...extractImages(asDocument(translation.body)).map((image) => image.assetId)
  ].filter((id, index, all) => all.indexOf(id) === index)
  const assets = await client.mediaAsset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, attribution: true, license: true, deletedAt: true, processingStatus: true }
  })
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  const invalid = assetIds.some((id) => {
    const asset = byId.get(id)
    return (
      !asset ||
      asset.deletedAt !== null ||
      asset.processingStatus !== "ready" ||
      !asset.license ||
      asset.attribution.trim() === ""
    )
  })
  if (invalid) validationError(ctx, "images", "license")
}

/** Очередь проверки автора: одновременно не более пяти материалов (`rate-limits.md` п. 10). */
async function ensureSubmissionQueue(
  ctx: GraphQLContext,
  client: PrismaClient | TransactionClient,
  authorId: string
): Promise<void> {
  const current = await client.articleTranslation.count({
    where: {
      article: { authorId },
      status: { in: ["ai_check", "review", "in_review"] }
    }
  })
  if (current < SUBMISSION_QUEUE_LIMIT) return

  ctx.logger.log({
    level: "warn",
    event: "plan.action.rejected",
    requestId: ctx.requestId,
    message: "Submission rejected because the review queue is full",
    data: { action: "translation.submit", limit: SUBMISSION_QUEUE_LIMIT, current }
  })
  throw createApiError("PLAN_LIMIT", {
    requestId: ctx.requestId,
    requiredTier: "standard",
    limit: SUBMISSION_QUEUE_LIMIT,
    current
  })
}

/** Отзыв поданной версии: возврат в черновик (`article-edit.md` §7). */
export async function withdrawTranslation(ctx: GraphQLContext, id: string): Promise<EditorTranslationView> {
  const user = ensureEditorActor(ctx, "translation.withdraw")
  const translation = await loadTranslation(ctx, id)
  ensureOwnTranslationMutation(ctx, translation, user, "translation.withdraw")

  if (!WITHDRAWABLE_STATUSES.has(translation.status) || translation.rejected) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "translation",
      expected: "review",
      actual: translation.rejected ? "rejected" : translation.status
    })
  }

  await ctx.prisma.$transaction(async (tx) => {
    await disableLegacySync(tx)
    const changed = await tx.articleTranslation.updateMany({
      where: { id: translation.id, status: translation.status, rejected: false },
      data: { status: "draft" }
    })
    if (changed.count !== 1) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "translation",
        expected: translation.status,
        actual: "changed"
      })
    }
    await mirrorLegacyArticle(tx, translation, {
      title: translation.title,
      dek: translation.dek,
      excerpt: translation.excerpt,
      body: asDocument(translation.body),
      status: "draft"
    })
  })

  ctx.logger.log({
    level: "info",
    event: "translation.withdraw",
    requestId: ctx.requestId,
    message: "Translation withdrawn from review",
    data: { translationId: translation.id, status: "draft" }
  })

  const now = new Date()
  return toView(ctx, { ...translation, status: "draft", updatedAt: now }, user, now)
}

/** Может ли версия быть снята на перередактирование прямо сейчас (`article-edit.md` §4, access-matrix #100). */
function canReedit(
  translation: Pick<EditorTranslation, "status" | "rejected" | "reeditUntil" | "reeditedAt">,
  now: Date
): boolean {
  return (
    translation.status === "published" &&
    !translation.rejected &&
    translation.reeditedAt === null &&
    translation.reeditUntil !== null &&
    now.getTime() <= translation.reeditUntil.getTime()
  )
}

/**
 * Перередактирование после автопубликации (`article-edit.md` §4, `write-and-publish.md` §4,
 * журнал #9): в течение часа после автопубликации автор один раз снимает версию с публикации и
 * возвращается в черновик; повторная подача снова идёт через AI. `reeditedAt` хранится навсегда,
 * поэтому право не возвращается, даже если версия опубликуется заново.
 */
export async function reeditTranslation(
  ctx: GraphQLContext,
  id: string,
  now = new Date()
): Promise<EditorTranslationView> {
  const user = ensureEditorActor(ctx, "translation.reedit")
  const translation = await loadTranslation(ctx, id)
  ensureOwnTranslationMutation(ctx, translation, user, "translation.reedit")

  if (!canReedit(translation, now)) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "translation.reedit" })
  }

  const withinWindowSec = translation.publishedAt
    ? Math.round((now.getTime() - translation.publishedAt.getTime()) / 1000)
    : null

  const current = await ctx.prisma.$transaction(async (tx) => {
    await lockTranslation(tx, translation.id)
    const current = await loadTranslationFrom(ctx, tx, translation.id)
    ensureOwnTranslationMutation(ctx, current, user, "translation.reedit")
    if (!canReedit(current, now)) {
      throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "translation.reedit" })
    }

    await disableLegacySync(tx)
    const changed = await tx.articleTranslation.updateMany({
      where: { id: current.id, status: "published", reeditedAt: null },
      data: { status: "draft", publishedAt: null, reeditUntil: null, reeditedAt: now }
    })
    if (changed.count !== 1) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "translation",
        expected: "published",
        actual: "changed"
      })
    }
    await mirrorLegacyArticle(tx, current, {
      title: current.title,
      dek: current.dek,
      excerpt: current.excerpt,
      body: asDocument(current.body),
      status: "draft"
    })
    if (current.locale === current.article.sourceLocale) {
      await tx.article.update({ where: { id: current.articleId }, data: { publishedAt: null } })
    }
    await tx.auditLog.create({
      data: {
        action: "translation.reedit",
        actorId: user.id,
        actorRole: user.role,
        entityType: "article_translation",
        entityId: current.id,
        diff: { translationId: current.id, withinWindowSec },
        requestId: ctx.requestId
      }
    })
    return current
  })

  await ctx.cache.delByTags(buildArticleCacheTags(current.article))

  ctx.logger.log({
    level: "info",
    event: "translation.reedit",
    requestId: ctx.requestId,
    message: "Translation reedited within the auto-publish window",
    data: { translationId: current.id, status: "draft", withinWindowSec }
  })

  return toView(
    ctx,
    { ...current, status: "draft", publishedAt: null, reeditUntil: null, reeditedAt: now, updatedAt: now },
    user,
    now
  )
}

export interface RevisionEntry {
  id: string
  createdAt: string
  kind: string
  size: number
}

export interface RevisionPage {
  items: RevisionEntry[]
  endCursor: string | null
  hasNextPage: boolean
}

/** История снимков версии: список для боковой панели (`article-edit.md` §5 зона 5). */
export async function listRevisions(
  ctx: GraphQLContext,
  translationId: string,
  cursor: string | null,
  limit: number
): Promise<RevisionPage> {
  const user = ensureReaderActor(ctx)
  const translation = await loadTranslation(ctx, translationId)
  ensureOwnTranslation(ctx, translation, user)

  const take = Math.min(Math.max(limit, 1), REVISION_PAGE_LIMIT)
  const rows = await ctx.prisma.articleRevision.findMany({
    where: { translationId },
    select: { id: true, createdAt: true, kind: true, body: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
  })

  const page = rows.slice(0, take)
  return {
    items: page.map((revision) => ({
      id: revision.id,
      createdAt: revision.createdAt.toISOString(),
      kind: revision.kind,
      // Размер снимка — число символов текста: автору нужен масштаб правки, а не байты JSON.
      size: toPlainText(asDocument(revision.body)).length
    })),
    endCursor: page[page.length - 1]?.id ?? null,
    hasNextPage: rows.length > take
  }
}

/** Восстановление снимка: старый текст становится новой ревизией (`article-edit.md` §7). */
export async function restoreRevision(
  ctx: GraphQLContext,
  translationId: string,
  revisionId: string
): Promise<SaveTranslationResult> {
  const user = ensureEditorActor(ctx, "revision.restore")
  const translation = await loadTranslation(ctx, translationId)
  ensureOwnTranslation(ctx, translation, user)

  if (!EDITABLE_STATUSES.has(translation.status) || translation.rejected) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "revision.restore" })
  }

  const source = await ctx.prisma.articleRevision.findFirst({
    where: { id: revisionId, translationId },
    select: { id: true, title: true, dek: true, excerpt: true, body: true }
  })
  if (!source) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "revision" })

  const saved = await writeTranslationSnapshot(ctx, {
    translation,
    actorId: user.id,
    kind: "manual",
    restoredFromId: source.id,
    data: {
      title: source.title,
      dek: source.dek,
      excerpt: source.excerpt,
      body: asDocument(source.body)
    }
  })

  return { revisionId: saved.revisionId, savedAt: saved.savedAt.toISOString() }
}

export interface SetTaxonomyInput {
  articleId: string
  sectionId: string | null
  formatId: string | null
  tagIds: string[]
}

/**
 * Рубрика, формат и теги материала (`article-edit.md` §5 зона 3, журнал §25.3).
 *
 * При создании ничего не требуется, рубрика обязательна только перед подачей, поэтому здесь
 * `null` — допустимое значение. Архивированную рубрику выбрать нельзя: подача с ней всё равно
 * отвечает `VALIDATION_ERROR`.
 */
export async function setTaxonomy(ctx: GraphQLContext, input: SetTaxonomyInput) {
  const user = ensureEditorActor(ctx, "article.setTaxonomy")
  const article = await ctx.prisma.article.findUnique({
    where: { id: input.articleId },
    select: { id: true, authorId: true, isEditorial: true, status: true }
  })
  if (!article) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
  if (article.authorId !== user.id) {
    if (!article.isEditorial) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
    ensurePermission(user, "editorial", "article.setTaxonomy", ctx.requestId)
  }
  if (article.status === "archived") {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "article.setTaxonomy" })
  }

  if (input.sectionId) {
    const section = await ctx.prisma.section.findFirst({
      where: { id: input.sectionId, status: "active" },
      select: { id: true }
    })
    if (!section) validationError(ctx, "sectionId", "active")
  }
  if (input.formatId) {
    const format = await ctx.prisma.format.findFirst({
      where: { id: input.formatId, status: "active" },
      select: { id: true }
    })
    if (!format) validationError(ctx, "formatId", "active")
  }
  if (input.tagIds.length > 0) {
    const found = await ctx.prisma.tag.count({ where: { id: { in: input.tagIds }, status: "active" } })
    if (found !== new Set(input.tagIds).size) validationError(ctx, "tagIds", "active")
  }

  return ctx.prisma.article.update({
    where: { id: article.id },
    data: {
      sectionId: input.sectionId,
      formatId: input.formatId,
      tags: { set: input.tagIds.map((id) => ({ id })) }
    },
    select: {
      id: true,
      coverAssetId: true,
      section: true,
      format: true,
      tags: true,
      translations: {
        select: { id: true, locale: true, status: true, rejected: true },
        orderBy: { locale: "asc" }
      }
    }
  })
}

/** Разрешённый вид публичного адреса версии (ADR-0004): строчные латинские буквы, цифры, дефис. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SLUG_MAX_LENGTH = 120

/** Публичный адрес версии до первой публикации (`article-edit.md` §4, матрица #31). */
export async function setSlug(ctx: GraphQLContext, translationId: string, slug: string) {
  const user = ensureEditorActor(ctx, "translation.setSlug")
  const translation = await loadTranslation(ctx, translationId)
  ensureOwnTranslation(ctx, translation, user)

  if (translation.publishedAt || translation.article.firstPublishedAt) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "translation.setSlug" })
  }

  const value = slug.trim().toLowerCase()
  if (value.length === 0 || value.length > SLUG_MAX_LENGTH || !SLUG_PATTERN.test(value)) {
    validationError(ctx, "slug", "format")
  }

  const taken = await ctx.prisma.articleTranslation.findFirst({
    where: { locale: translation.locale, slug: value, NOT: { id: translation.id } },
    select: { id: true }
  })
  if (taken) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "slug",
      expected: "free",
      actual: "taken"
    })
  }

  // Адрес навсегда занят (журнал §26.10, AC-T053-2 → T-076): проверяем и, при необходимости,
  // резервируем `(locale, slug)` в реестре, который переживает физическое удаление материала.
  const reserved = await ctx.prisma.articleSlugHistory.findUnique({
    where: { locale_slug: { locale: translation.locale, slug: value } },
    select: { articleId: true }
  })
  if (reserved && reserved.articleId !== translation.articleId) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "slug",
      expected: "free",
      actual: "taken"
    })
  }

  await ctx.prisma.$transaction(async (tx) => {
    await disableLegacySync(tx)
    await tx.articleTranslation.update({ where: { id: translation.id }, data: { slug: value } })
    if (translation.locale === translation.article.sourceLocale) {
      await tx.article.update({ where: { id: translation.articleId }, data: { slug: value } })
    }
    if (!reserved) {
      await tx.articleSlugHistory.create({
        data: { locale: translation.locale, slug: value, articleId: translation.articleId }
      })
    }
  })

  return { description: translation.excerpt, slug: value, slugLocked: false }
}

/**
 * Рубрики и форматы для выбора в редакторе.
 *
 * Административные `sections` и `formats` закрыты правом `taxonomy`, а автору нужен свой
 * перечень (`article-edit.md` §6: `SectionPicker`, выбор рубрики с описанием). Архивированные
 * сюда не попадают: выбрать их нельзя, а у материала уже выбранная рубрика приходит с версией.
 */
export async function authoringTaxonomy(ctx: GraphQLContext) {
  ensureEditorActor(ctx, "article.taxonomy.read")

  const [sections, formats] = await Promise.all([
    ctx.prisma.section.findMany({ where: { status: "active" }, orderBy: [{ order: "asc" }, { name: "asc" }] }),
    ctx.prisma.format.findMany({ where: { status: "active" }, orderBy: { name: "asc" } })
  ])

  return { sections, formats }
}
