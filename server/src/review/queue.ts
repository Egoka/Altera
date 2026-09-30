import type { Prisma, Role } from "../generated/prisma"
import { buildArticleCacheTags } from "../cache/key"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, ensurePermission } from "../exceptions/permissions"
import { avatarAssetSelect, avatarUrlOf } from "../media"
import { notifyArticleDecision } from "../mail/article-notifications"
import type { GraphQLContext } from "../prisma"
import { calculatePagination, validatePagination, type PaginationInput } from "../utils/admin"

const REVIEW_ACTION = "admin.review.decide"
const REVIEW_READ_ACTION = "admin.review.read"
const QUEUE_ROLES = new Set<Role>(["moderator", "admin", "owner"])
const REVIEW_STATES = new Set(["queued", "in_review", "rework", "published"])
const PROFILE_FIELDS = new Set(["name", "avatar"])
const PROFILE_VERDICTS = new Set(["accept", "reject"])

const reviewArticleSelect = {
  id: true,
  slug: true,
  sourceLocale: true,
  isEditorial: true,
  firstPublishedAt: true,
  sectionId: true,
  coverAssetId: true,
  section: { select: { slug: true, name: true, status: true } },
  coverAsset: { select: { id: true, processingStatus: true } },
  author: {
    select: {
      id: true,
      name: true,
      handle: true,
      nameCheckStatus: true,
      avatarCheckStatus: true
    }
  },
  tags: { select: { slug: true } }
} satisfies Prisma.ArticleSelect

const reviewRowInclude = {
  article: { select: reviewArticleSelect }
} satisfies Prisma.ArticleTranslationInclude

const reviewItemInclude = {
  ...reviewRowInclude,
  revisions: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    include: { reviewNotes: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] } }
  },
  reviewMessages: {
    where: { parentId: null },
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    include: { replies: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] } }
  }
} satisfies Prisma.ArticleTranslationInclude

const profileReviewSelect = {
  id: true,
  name: true,
  pendingName: true,
  handle: true,
  avatarAssetId: true,
  prevAvatarId: true,
  nameCheckStatus: true,
  avatarCheckStatus: true,
  updatedAt: true,
  avatarAsset: { select: avatarAssetSelect },
  previousAvatar: { select: avatarAssetSelect }
} satisfies Prisma.UserSelect

type ReviewRowRecord = Prisma.ArticleTranslationGetPayload<{ include: typeof reviewRowInclude }>
type ReviewItemRecord = Prisma.ArticleTranslationGetPayload<{ include: typeof reviewItemInclude }>
type ProfileReviewRecord = Prisma.UserGetPayload<{ select: typeof profileReviewSelect }>
type ReviewActor = NonNullable<GraphQLContext["currentUser"]>
type TransactionClient = Prisma.TransactionClient

export interface ReviewQueueFilters {
  states?: readonly string[] | null
  locale?: "ru" | "en" | null
  sectionId?: string | null
  editorial?: boolean | null
  search?: string | null
}

export interface ReviewQueueInput {
  filters?: ReviewQueueFilters | null
  pagination?: PaginationInput | null
  sort?: "age" | "updated" | null
}

export interface ReviewQueueItem {
  id: string
  articleId: string
  title: string
  slug: string
  locale: "ru" | "en"
  status: string
  state: "queued" | "in_review" | "rework" | "published" | null
  rejected: boolean
  publishedAt: Date | null
  readCount: number
  createdAt: Date
  updatedAt: Date
  author: { id: string; name: string; handle: string }
  section: { slug: string; name: string } | null
  editorial: boolean
  reviewer: { role: Role; mine: boolean } | null
}

export interface ReviewItem extends ReviewQueueItem {
  body: Prisma.JsonValue
  revisions: ReviewItemRecord["revisions"]
  decisions: ReviewItemRecord["reviewMessages"]
  aiDecision: {
    verdict: string | null
    reasons: Prisma.JsonValue | null
    finishedAt: Date | null
  } | null
}

export interface ReviewQueuePage<T> {
  items: T[]
  pagination: ReturnType<typeof calculatePagination>["pagination"]
}

export interface ProfileReviewInput {
  pagination?: PaginationInput | null
}

export interface ProfileReviewItem {
  userId: string
  name: string
  previousName: string | null
  handle: string
  avatarAssetId: string | null
  previousAvatarId: string | null
  avatarUrl: string | null
  previousAvatarUrl: string | null
  nameStatus: string
  avatarStatus: string
  fields: Array<"name" | "avatar">
  updatedAt: Date
}

export interface ProfileDecisionInput {
  userId: string
  field: "name" | "avatar"
  verdict: "accept" | "reject"
  reason?: string | null
}

export interface CreateReviewNoteInput {
  translationId: string
  revisionId: string
  blockId: string
  text: string
}

function ensureQueueReader(ctx: GraphQLContext): ReviewActor {
  const actor = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  if (actor.archivedAt || !QUEUE_ROLES.has(actor.role)) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: REVIEW_READ_ACTION })
  }
  return actor
}

function ensureReviewer(ctx: GraphQLContext): ReviewActor {
  const actor = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  ensurePermission(actor, "review", REVIEW_ACTION, ctx.requestId)
  return actor
}

function validationError(ctx: GraphQLContext, field: string, rule = "required"): never {
  throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field, rule })
}

function reviewState(record: Pick<ReviewRowRecord, "status" | "rejected">): ReviewQueueItem["state"] {
  if (record.rejected) return null
  if (record.status === "review") return "queued"
  if (record.status === "in_review" || record.status === "rework") return record.status
  if (record.status === "published") return "published"
  return null
}

function toQueueItem(record: ReviewRowRecord, actor: ReviewActor): ReviewQueueItem {
  return {
    id: record.id,
    articleId: record.articleId,
    title: record.title,
    slug: record.slug,
    locale: record.locale,
    status: record.status,
    state: reviewState(record),
    rejected: record.rejected,
    publishedAt: record.publishedAt,
    readCount: record.readCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    author: {
      id: record.article.author.id,
      name: record.article.author.name,
      handle: record.article.author.handle
    },
    section: record.article.section ? { slug: record.article.section.slug, name: record.article.section.name } : null,
    editorial: record.article.isEditorial,
    reviewer: record.reviewerId
      ? { role: record.reviewerRole ?? "moderator", mine: record.reviewerId === actor.id }
      : null
  }
}

function normalizePagination(ctx: GraphQLContext, input: PaginationInput | null | undefined) {
  const pagination = input ?? { page: 1, limit: 20 }
  validatePagination(pagination, ctx.requestId)
  return pagination
}

function normalizeStates(ctx: GraphQLContext, states: readonly string[] | null | undefined) {
  if (!states?.length) return null
  for (const state of states) {
    if (!REVIEW_STATES.has(state)) validationError(ctx, "filters.states", "enum:queued,in_review,rework,published")
  }
  return states.map((state) => (state === "queued" ? "review" : state))
}

function queueWhere(ctx: GraphQLContext, actor: ReviewActor, filters: ReviewQueueFilters | null | undefined) {
  const states = normalizeStates(ctx, filters?.states)
  const search = filters?.search?.trim() ?? ""
  if (search.length > 0 && search.length < 3) validationError(ctx, "filters.search", "minLength:3")

  const where: Prisma.ArticleTranslationWhereInput = {
    rejected: false,
    ...(states
      ? { status: { in: states as Array<"review" | "in_review" | "rework" | "published"> } }
      : { OR: [{ status: "review" }, { status: "in_review", reviewerId: actor.id }] }),
    ...(filters?.locale ? { locale: filters.locale } : {}),
    ...(filters?.sectionId || (filters?.editorial !== null && filters?.editorial !== undefined)
      ? {
          article: {
            ...(filters?.sectionId ? { sectionId: filters.sectionId } : {}),
            ...(filters?.editorial !== null && filters?.editorial !== undefined
              ? { isEditorial: filters.editorial }
              : {})
          }
        }
      : {}),
    ...(search
      ? {
          AND: [
            {
              OR: [
                { title: { contains: search, mode: "insensitive" } },
                { article: { author: { handle: { contains: search, mode: "insensitive" } } } }
              ]
            }
          ]
        }
      : {})
  }
  return where
}

export async function listReviewQueue(
  ctx: GraphQLContext,
  input: ReviewQueueInput = {}
): Promise<ReviewQueuePage<ReviewQueueItem>> {
  const actor = ensureQueueReader(ctx)
  const pagination = normalizePagination(ctx, input.pagination)
  const where = queueWhere(ctx, actor, input.filters)
  const total = await ctx.prisma.articleTranslation.count({ where })
  const page = calculatePagination(pagination.page, pagination.limit, total)
  const items = await ctx.prisma.articleTranslation.findMany({
    where,
    include: reviewRowInclude,
    orderBy: input.sort === "updated" ? [{ updatedAt: "desc" }, { id: "asc" }] : [{ createdAt: "asc" }, { id: "asc" }],
    skip: page.skip,
    take: page.take
  })
  return { items: items.map((item) => toQueueItem(item, actor)), pagination: page.pagination }
}

async function loadReviewItemRecord(
  prisma: GraphQLContext["prisma"] | TransactionClient,
  ctx: GraphQLContext,
  id: string
): Promise<ReviewItemRecord> {
  const record = await prisma.articleTranslation.findUnique({ where: { id }, include: reviewItemInclude })
  if (!record) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "translation" })
  return record
}

async function presentReviewItem(
  ctx: GraphQLContext,
  actor: ReviewActor,
  record: ReviewItemRecord
): Promise<ReviewItem> {
  const aiDecision = await ctx.prisma.aiProcess.findFirst({
    where: { objectType: "ArticleTranslation", objectId: record.id, kind: "check", status: "completed" },
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
    select: { verdict: true, reasons: true, finishedAt: true }
  })
  return {
    ...toQueueItem(record, actor),
    body: record.body,
    revisions: record.revisions,
    decisions: record.reviewMessages,
    aiDecision
  }
}

export async function getReviewItem(ctx: GraphQLContext, id: string): Promise<ReviewItem> {
  const actor = ensureQueueReader(ctx)
  return presentReviewItem(ctx, actor, await loadReviewItemRecord(ctx.prisma, ctx, id))
}

function conflictFor(ctx: GraphQLContext, record: Pick<ReviewRowRecord, "status" | "reviewerId" | "rejected">): never {
  const actual = record.rejected
    ? "rejected"
    : record.status === "in_review" && record.reviewerId !== ctx.currentUser?.id
      ? "claimed_by_other"
      : record.status
  throw createApiError("CONFLICT", {
    requestId: ctx.requestId,
    entity: "translation",
    expected: "available",
    actual
  })
}

async function reloadAfterMutation(ctx: GraphQLContext, actor: ReviewActor, id: string) {
  return presentReviewItem(ctx, actor, await loadReviewItemRecord(ctx.prisma, ctx, id))
}

export async function claimReview(ctx: GraphQLContext, id: string, now = new Date()): Promise<ReviewItem> {
  const actor = ensureReviewer(ctx)
  const changed = await ctx.prisma.articleTranslation.updateMany({
    where: { id, status: "review", reviewerId: null, rejected: false },
    data: { status: "in_review", reviewerId: actor.id, reviewerRole: actor.role, reviewClaimedAt: now }
  })
  if (changed.count !== 1) conflictFor(ctx, await loadReviewItemRecord(ctx.prisma, ctx, id))
  return reloadAfterMutation(ctx, actor, id)
}

export async function releaseReview(ctx: GraphQLContext, id: string, now = new Date()): Promise<ReviewItem> {
  const actor = ensureReviewer(ctx)
  const changed = await ctx.prisma.articleTranslation.updateMany({
    where: { id, status: "in_review", ...(actor.role === "owner" ? {} : { reviewerId: actor.id }) },
    data: { status: "review", reviewerId: null, reviewerRole: null, reviewClaimedAt: null, updatedAt: now }
  })
  if (changed.count !== 1) conflictFor(ctx, await loadReviewItemRecord(ctx.prisma, ctx, id))
  return reloadAfterMutation(ctx, actor, id)
}

async function audit(
  tx: TransactionClient,
  ctx: GraphQLContext,
  actor: ReviewActor,
  translationId: string,
  action: string,
  diff: Prisma.InputJsonValue,
  entityType = "article_translation"
) {
  await tx.auditLog.create({
    data: {
      action,
      actorId: actor.id,
      actorRole: actor.role,
      entityType,
      entityId: translationId,
      diff,
      context: "admin.review",
      requestId: ctx.requestId
    }
  })
}

async function decisionMessage(
  tx: TransactionClient,
  ctx: GraphQLContext,
  actor: ReviewActor,
  input: {
    translationId: string
    kind: "rework_request" | "manual_publish" | "final_reject" | "unpublish" | "message"
    text?: string | null
    recommendations?: string | null
    parentId?: string | null
  }
) {
  const message = await tx.reviewMessage.create({
    data: {
      translationId: input.translationId,
      kind: input.kind,
      text: input.text ?? null,
      recommendations: input.recommendations ?? null,
      byRole: actor.role,
      parentId: input.parentId ?? null
    }
  })
  await audit(tx, ctx, actor, input.translationId, "review.message", {
    kind: input.kind,
    decisionId: message.id
  })
  return message
}

async function requireClaimed(
  tx: TransactionClient,
  ctx: GraphQLContext,
  actor: ReviewActor,
  id: string
): Promise<ReviewItemRecord> {
  const record = await loadReviewItemRecord(tx, ctx, id)
  if (record.status !== "in_review" || record.reviewerId !== actor.id || record.rejected) conflictFor(ctx, record)
  return record
}

export async function requestReviewRework(
  ctx: GraphQLContext,
  id: string,
  rawRecommendations: string,
  now = new Date()
): Promise<ReviewItem> {
  const actor = ensureReviewer(ctx)
  const recommendations = rawRecommendations.trim()
  if (!recommendations) validationError(ctx, "recommendations")

  await ctx.prisma.$transaction(async (tx) => {
    await requireClaimed(tx, ctx, actor, id)
    const changed = await tx.articleTranslation.updateMany({
      where: { id, status: "in_review", reviewerId: actor.id, rejected: false },
      data: {
        status: "rework",
        reviewerId: null,
        reviewerRole: null,
        reviewClaimedAt: null,
        updatedAt: now
      }
    })
    if (changed.count !== 1) conflictFor(ctx, await loadReviewItemRecord(tx, ctx, id))
    await decisionMessage(tx, ctx, actor, {
      translationId: id,
      kind: "rework_request",
      recommendations
    })
    await audit(tx, ctx, actor, id, "translation.rework.request", {
      before: "in_review",
      after: "rework"
    })
  })
  await notifyArticleDecision(
    { store: ctx.prisma, mail: ctx.mail },
    { translationId: id, decision: "rework_requested", recommendations, requestId: ctx.requestId, now }
  )
  return reloadAfterMutation(ctx, actor, id)
}

function assertPublishable(ctx: GraphQLContext, record: ReviewItemRecord) {
  if (!record.article.sectionId || !record.article.section || record.article.section.status !== "active") {
    validationError(ctx, "sectionId")
  }
  if (!record.article.coverAssetId || record.article.coverAsset?.processingStatus !== "ready") {
    validationError(ctx, "coverAssetId", "ready")
  }
  if (!record.article.author.name.trim() || !record.article.author.handle.trim()) validationError(ctx, "profile")
}

async function invalidateReviewArticle(ctx: GraphQLContext, record: ReviewItemRecord) {
  await ctx.cache.delByTags(buildArticleCacheTags(record.article))
}

export async function publishReviewManual(
  ctx: GraphQLContext,
  id: string,
  rawMessage?: string | null,
  now = new Date()
): Promise<ReviewItem> {
  const actor = ensureReviewer(ctx)
  let before: ReviewItemRecord | null = null
  await ctx.prisma.$transaction(async (tx) => {
    before = await requireClaimed(tx, ctx, actor, id)
    assertPublishable(ctx, before)
    const changed = await tx.articleTranslation.updateMany({
      where: { id, status: "in_review", reviewerId: actor.id, rejected: false },
      data: {
        status: "published",
        publishedAt: now,
        reviewerId: null,
        reviewerRole: null,
        reviewClaimedAt: null
      }
    })
    if (changed.count !== 1) conflictFor(ctx, await loadReviewItemRecord(tx, ctx, id))
    if ("$executeRawUnsafe" in tx) await tx.$executeRawUnsafe(`SET LOCAL "altera.legacy_sync" = 'off'`)
    await tx.article.update({
      where: { id: before.articleId },
      data: {
        status: "published",
        publishedAt: now,
        firstPublishedAt: before.article.firstPublishedAt ?? now
      }
    })
    await decisionMessage(tx, ctx, actor, {
      translationId: id,
      kind: "manual_publish",
      text: rawMessage?.trim() || null
    })
    await audit(tx, ctx, actor, id, "translation.publish.manual", {
      before: "in_review",
      after: "published",
      aiOverride: true
    })
  })
  if (before) await invalidateReviewArticle(ctx, before)
  ctx.logger.metric?.({
    event: "translation.published",
    requestId: ctx.requestId,
    data: { translationId: id, mode: "manual", byRole: actor.role }
  })
  await notifyArticleDecision(
    { store: ctx.prisma, mail: ctx.mail },
    { translationId: id, decision: "published_manual", requestId: ctx.requestId, now }
  )
  return reloadAfterMutation(ctx, actor, id)
}

export async function rejectReviewFinal(
  ctx: GraphQLContext,
  id: string,
  rawReason?: string | null,
  now = new Date()
): Promise<ReviewItem> {
  const actor = ensureReviewer(ctx)
  await ctx.prisma.$transaction(async (tx) => {
    await requireClaimed(tx, ctx, actor, id)
    const changed = await tx.articleTranslation.updateMany({
      where: { id, status: "in_review", reviewerId: actor.id, rejected: false },
      data: {
        rejected: true,
        reviewerId: null,
        reviewerRole: null,
        reviewClaimedAt: null,
        updatedAt: now
      }
    })
    if (changed.count !== 1) conflictFor(ctx, await loadReviewItemRecord(tx, ctx, id))
    await decisionMessage(tx, ctx, actor, {
      translationId: id,
      kind: "final_reject",
      text: rawReason?.trim() || null
    })
    await audit(tx, ctx, actor, id, "translation.reject.final", { before: "in_review", after: "rejected" })
  })
  await notifyArticleDecision(
    { store: ctx.prisma, mail: ctx.mail },
    { translationId: id, decision: "rejected_final", reason: rawReason?.trim() || null, requestId: ctx.requestId, now }
  )
  return reloadAfterMutation(ctx, actor, id)
}

export async function unpublishReview(
  ctx: GraphQLContext,
  id: string,
  rawReason: string,
  now = new Date()
): Promise<ReviewItem> {
  const actor = ensureReviewer(ctx)
  const reason = rawReason.trim()
  if (!reason) validationError(ctx, "reason")
  let before: ReviewItemRecord | null = null
  await ctx.prisma.$transaction(async (tx) => {
    before = await loadReviewItemRecord(tx, ctx, id)
    if (before.status !== "published" || before.rejected) conflictFor(ctx, before)
    const changed = await tx.articleTranslation.updateMany({
      where: { id, status: "published", rejected: false },
      data: {
        status: "review",
        publishedAt: null,
        reviewerId: null,
        reviewerRole: null,
        reviewClaimedAt: null,
        updatedAt: now
      }
    })
    if (changed.count !== 1) conflictFor(ctx, await loadReviewItemRecord(tx, ctx, id))
    if (before.locale === before.article.sourceLocale) {
      if ("$executeRawUnsafe" in tx) await tx.$executeRawUnsafe(`SET LOCAL "altera.legacy_sync" = 'off'`)
      await tx.article.update({ where: { id: before.articleId }, data: { status: "review", publishedAt: null } })
    }
    await decisionMessage(tx, ctx, actor, { translationId: id, kind: "unpublish", text: reason })
    await audit(tx, ctx, actor, id, "translation.unpublish", { before: "published", after: "review", reason })
  })
  if (before) await invalidateReviewArticle(ctx, before)
  await notifyArticleDecision(
    { store: ctx.prisma, mail: ctx.mail },
    { translationId: id, decision: "unpublished", reason, requestId: ctx.requestId, now }
  )
  return reloadAfterMutation(ctx, actor, id)
}

export async function replyInReviewDecision(ctx: GraphQLContext, decisionId: string, rawText: string) {
  const actor = ensureReviewer(ctx)
  const text = rawText.trim()
  if (!text) validationError(ctx, "text")
  return ctx.prisma.$transaction(async (tx) => {
    const decision = await tx.reviewMessage.findUnique({
      where: { id: decisionId },
      include: { translation: true }
    })
    if (!decision || decision.parentId) {
      throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "reviewDecision" })
    }
    if (decision.translation.rejected || !["rework_request", "unpublish", "message"].includes(decision.kind)) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "reviewDecision",
        expected: "open",
        actual: "closed"
      })
    }
    return decisionMessage(tx, ctx, actor, {
      translationId: decision.translationId,
      kind: "message",
      text,
      parentId: decision.id
    })
  })
}

function documentHasBlock(value: Prisma.JsonValue | undefined, blockId: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => documentHasBlock(entry, blockId))
  if (!value || typeof value !== "object") return false
  const record = value as Prisma.JsonObject
  const attrs = record.attrs
  if (attrs && typeof attrs === "object" && !Array.isArray(attrs) && attrs.id === blockId) return true
  return Object.values(record).some((entry) => documentHasBlock(entry, blockId))
}

export async function createReviewNote(ctx: GraphQLContext, input: CreateReviewNoteInput) {
  const actor = ensureReviewer(ctx)
  const text = input.text.trim()
  const blockId = input.blockId.trim()
  if (!text) validationError(ctx, "text")
  if (!blockId) validationError(ctx, "blockId")

  return ctx.prisma.$transaction(async (tx) => {
    const revision = await tx.articleRevision.findUnique({
      where: { id: input.revisionId },
      include: { translation: true }
    })
    if (!revision || revision.translationId !== input.translationId) {
      throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "articleRevision" })
    }
    const translation = revision.translation
    if (!["review", "in_review", "published"].includes(translation.status) || translation.rejected) {
      conflictFor(ctx, translation as ReviewRowRecord)
    }
    if (translation.status === "in_review" && translation.reviewerId !== actor.id)
      conflictFor(ctx, translation as ReviewRowRecord)
    if (!documentHasBlock(revision.body, blockId)) validationError(ctx, "blockId", "exists")

    const note = await tx.reviewNote.create({
      data: { revisionId: revision.id, blockId, text, createdById: actor.id }
    })
    await audit(tx, ctx, actor, input.translationId, "review.message", {
      kind: "note",
      noteId: note.id,
      revisionId: revision.id,
      blockId
    })
    return note
  })
}

function toProfileItem(record: ProfileReviewRecord, mediaBaseUrl: string): ProfileReviewItem {
  const fields: Array<"name" | "avatar"> = []
  if (record.nameCheckStatus === "pending") fields.push("name")
  if (record.avatarCheckStatus === "pending") fields.push("avatar")
  return {
    userId: record.id,
    name: record.pendingName ?? record.name,
    previousName: record.name,
    handle: record.handle,
    avatarAssetId: record.avatarAssetId,
    previousAvatarId: record.prevAvatarId,
    avatarUrl: avatarUrlOf(record.avatarAsset, mediaBaseUrl),
    previousAvatarUrl: avatarUrlOf(record.previousAvatar, mediaBaseUrl),
    nameStatus: record.nameCheckStatus,
    avatarStatus: record.avatarCheckStatus,
    fields,
    updatedAt: record.updatedAt
  }
}

export async function listProfileReviewQueue(
  ctx: GraphQLContext,
  input: ProfileReviewInput = {}
): Promise<ReviewQueuePage<ProfileReviewItem>> {
  ensureQueueReader(ctx)
  const pagination = normalizePagination(ctx, input.pagination)
  const where: Prisma.UserWhereInput = {
    isServiceAccount: false,
    OR: [{ nameCheckStatus: "pending" }, { avatarCheckStatus: "pending" }]
  }
  const total = await ctx.prisma.user.count({ where })
  const page = calculatePagination(pagination.page, pagination.limit, total)
  const items = await ctx.prisma.user.findMany({
    where,
    select: profileReviewSelect,
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    skip: page.skip,
    take: page.take
  })
  return { items: items.map((item) => toProfileItem(item, ctx.media.mediaBaseUrl)), pagination: page.pagination }
}

export async function decideProfileCheck(
  ctx: GraphQLContext,
  input: ProfileDecisionInput,
  now = new Date()
): Promise<ProfileReviewItem> {
  const actor = ensureReviewer(ctx)
  if (!PROFILE_FIELDS.has(input.field)) validationError(ctx, "field", "enum:name,avatar")
  if (!PROFILE_VERDICTS.has(input.verdict)) validationError(ctx, "verdict", "enum:accept,reject")
  const reason = input.reason?.trim() || null
  const field = input.field === "name" ? "nameCheckStatus" : "avatarCheckStatus"

  const updated = await ctx.prisma.$transaction(async (tx) => {
    const profile = await tx.user.findUnique({
      where: { id: input.userId },
      select: profileReviewSelect
    })
    if (!profile) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "user" })
    if (profile[field] !== "pending") {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "profileCheck",
        expected: "pending",
        actual: profile[field]
      })
    }
    const status = input.verdict === "accept" ? "ok" : "rejected"
    const data: Prisma.UserUncheckedUpdateManyInput = { [field]: status }
    if (input.field === "name") {
      const proposedName = profile.pendingName
      if (!proposedName) {
        throw createApiError("CONFLICT", {
          requestId: ctx.requestId,
          entity: "profileName",
          expected: "proposedVersion",
          actual: "none"
        })
      }
      if (input.verdict === "accept") data.name = proposedName
      data.pendingName = null
      // Причину отказа автор видит в настройках профиля (T-031); принятое значение её снимает.
      data.nameCheckReason = input.verdict === "accept" ? null : reason
    } else {
      data.avatarCheckReason = input.verdict === "accept" ? null : reason
      if (input.verdict === "reject") {
        if (!profile.prevAvatarId) {
          throw createApiError("CONFLICT", {
            requestId: ctx.requestId,
            entity: "avatar",
            expected: "previousVersion",
            actual: "none"
          })
        }
        data.avatarAssetId = profile.prevAvatarId
        data.prevAvatarId = null
      } else {
        data.prevAvatarId = null
      }
    }
    const changed = await tx.user.updateMany({ where: { id: input.userId, [field]: "pending" }, data })
    if (changed.count !== 1) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "profileCheck",
        expected: "pending",
        actual: "decided"
      })
    }
    await audit(
      tx,
      ctx,
      actor,
      input.userId,
      "profile.check",
      {
        field: input.field,
        verdict: input.verdict === "accept" ? "accepted" : input.field === "avatar" ? "reverted" : "rejected",
        reason,
        decidedAt: now.toISOString()
      },
      "user"
    )
    const result = await tx.user.findUnique({
      where: { id: input.userId },
      select: profileReviewSelect
    })
    if (!result) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "user" })
    return result
  })
  await ctx.cache.delByTags([`author:${updated.handle.toLowerCase()}`, "home"])
  return toProfileItem(updated, ctx.media.mediaBaseUrl)
}
