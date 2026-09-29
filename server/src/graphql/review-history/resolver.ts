import type { PlanTier, Role } from "../../generated/prisma"
import { AI_CHECK_OBJECT_TYPE, isAiCheckReasonCategory } from "../../ai"
import { createApiError } from "../../errors/graphql-error"
import { ensureActiveAuthor, ensureAuthenticated, hasActiveAuthorPlan } from "../../exceptions/permissions"
import type { GraphQLContext } from "../../prisma"

const REPLYABLE_KINDS = new Set(["rework_request", "unpublish", "message"])

interface ReviewOwner {
  id: string
  role: Role
  archivedAt: Date | null
  planTier: PlanTier
  planUntil: Date | null
}

interface StoredReason {
  category: string
  anchor: string | null
  text: string
}

const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null

function ensureReviewOwner(ctx: GraphQLContext, authorId: string): ReviewOwner {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  if (user.archivedAt) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "translation.review.read" })
  }
  if (user.id !== authorId || (user.role !== "reader" && user.role !== "author")) {
    throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "translation" })
  }
  return user
}

function reasonsOf(value: unknown): StoredReason[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const candidate = item as Record<string, unknown>
    if (!isAiCheckReasonCategory(candidate.category) || typeof candidate.text !== "string") return []
    return [
      {
        category: candidate.category,
        anchor: typeof candidate.anchor === "string" ? candidate.anchor : null,
        text: candidate.text
      }
    ]
  })
}

const toThreadMessage = (message: {
  id: string
  kind: string
  text: string | null
  byRole: Role | null
  createdAt: Date
}) => ({
  id: message.id,
  author: message.kind === "author_reply",
  byRole: message.byRole,
  text: message.text ?? "",
  createdAt: message.createdAt.toISOString()
})

const toNote = (note: {
  id: string
  blockId: string
  text: string
  resolved: boolean
  createdAt: Date
  updatedAt?: Date
}) => ({
  id: note.id,
  blockId: note.blockId,
  text: note.text,
  resolved: note.resolved,
  createdAt: note.createdAt.toISOString(),
  updatedAt: iso(note.updatedAt)
})

async function translationReview(ctx: GraphQLContext, id: string) {
  const translation = await ctx.prisma.articleTranslation.findUnique({
    where: { id },
    include: {
      article: { select: { authorId: true } },
      reviewMessages: {
        where: { parentId: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { replies: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } }
      },
      revisions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { reviewNotes: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } }
      }
    }
  })
  if (!translation) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "translation" })

  const user = ensureReviewOwner(ctx, translation.article.authorId)
  const planLimited = !hasActiveAuthorPlan(user, new Date())
  const aiProcess = await ctx.prisma.aiProcess.findFirst({
    where: { objectType: AI_CHECK_OBJECT_TYPE, objectId: id, kind: "check", status: "completed" },
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
    select: { verdict: true, reasons: true, finishedAt: true }
  })

  const decision = aiProcess?.verdict === "publish" || aiProcess?.verdict === "reject" ? aiProcess.verdict : "none"
  const reviewState = ["review", "in_review", "rework"].includes(translation.status)
    ? translation.status === "review"
      ? "queued"
      : translation.status
    : null

  return {
    translationId: translation.id,
    title: translation.title,
    locale: translation.locale,
    status: translation.status,
    rejected: translation.rejected,
    readOnly: translation.rejected || planLimited,
    planLimited,
    reviewState,
    aiDecision: {
      decision,
      checkedAt: iso(aiProcess?.finishedAt),
      reasons: reasonsOf(aiProcess?.reasons)
    },
    items: translation.reviewMessages.map((message) => ({
      id: message.id,
      kind: message.kind,
      text: message.text,
      recommendations: message.recommendations,
      byRole: message.byRole,
      createdAt: message.createdAt.toISOString(),
      readAt: iso(message.readAt),
      canReply: REPLYABLE_KINDS.has(message.kind) && !translation.rejected && !planLimited,
      thread: message.replies.map(toThreadMessage)
    })),
    notes: translation.revisions.flatMap((revision) => revision.reviewNotes.map(toNote))
  }
}

async function replyToDecision(ctx: GraphQLContext, decisionId: string, rawText: string) {
  const text = rawText.trim()
  if (!text) {
    throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "text", rule: "required" })
  }

  const decision = await ctx.prisma.reviewMessage.findUnique({
    where: { id: decisionId },
    include: { translation: { include: { article: { select: { authorId: true } } } } }
  })
  if (!decision || decision.parentId) {
    throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "reviewDecision" })
  }
  const user = ensureReviewOwner(ctx, decision.translation.article.authorId)
  ensureActiveAuthor(ctx.currentUser, "review.reply.author", ctx.requestId)
  if (!REPLYABLE_KINDS.has(decision.kind) || decision.translation.rejected) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "reviewDecision",
      expected: "open",
      actual: "closed"
    })
  }

  await ctx.rateLimiter.enforce("account.mutation.user", user.id, {
    requestId: ctx.requestId,
    ip: ctx.requestMeta.ip
  })
  const reply = await ctx.prisma.reviewMessage.create({
    data: {
      translationId: decision.translationId,
      kind: "author_reply",
      text,
      byRole: "author",
      parentId: decision.id
    }
  })
  return toThreadMessage(reply)
}

async function resolveReviewNote(ctx: GraphQLContext, noteId: string) {
  const note = await ctx.prisma.reviewNote.findUnique({
    where: { id: noteId },
    include: {
      revision: { include: { translation: { include: { article: { select: { authorId: true } } } } } }
    }
  })
  if (!note) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "reviewNote" })
  const user = ensureReviewOwner(ctx, note.revision.translation.article.authorId)
  ensureActiveAuthor(ctx.currentUser, "review.note.resolve", ctx.requestId)
  if (note.revision.translation.status !== "rework") {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "reviewNote",
      expected: "rework",
      actual: note.revision.translation.status
    })
  }
  await ctx.rateLimiter.enforce("account.mutation.user", user.id, {
    requestId: ctx.requestId,
    ip: ctx.requestMeta.ip
  })
  return toNote(await ctx.prisma.reviewNote.update({ where: { id: noteId }, data: { resolved: true } }))
}

export default {
  Query: {
    translationReview: (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => translationReview(ctx, id)
  },
  Mutation: {
    markReviewRead: async (_parent: unknown, { translationId }: { translationId: string }, ctx: GraphQLContext) => {
      const translation = await ctx.prisma.articleTranslation.findUnique({
        where: { id: translationId },
        select: { article: { select: { authorId: true } } }
      })
      if (!translation) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "translation" })
      }
      ensureReviewOwner(ctx, translation.article.authorId)
      const readAt = new Date()
      await ctx.prisma.reviewMessage.updateMany({
        where: { translationId, readAt: null, kind: { not: "author_reply" } },
        data: { readAt }
      })
      return readAt.toISOString()
    },
    replyToDecision: (
      _parent: unknown,
      { decisionId, text }: { decisionId: string; text: string },
      ctx: GraphQLContext
    ) => replyToDecision(ctx, decisionId, text),
    resolveReviewNote: (_parent: unknown, { noteId }: { noteId: string }, ctx: GraphQLContext) =>
      resolveReviewNote(ctx, noteId)
  }
}
