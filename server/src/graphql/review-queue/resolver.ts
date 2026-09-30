import {
  claimReview,
  createReviewNote,
  decideProfileCheck,
  getReviewItem,
  listProfileReviewQueue,
  listReviewQueue,
  publishReviewManual,
  rejectReviewFinal,
  releaseReview,
  replyInReviewDecision,
  requestReviewRework,
  unpublishReview,
  type CreateReviewNoteInput,
  type ProfileDecisionInput,
  type ProfileReviewItem,
  type ReviewItem,
  type ReviewQueueInput,
  type ReviewQueueItem
} from "../../review/queue"
import type { GraphQLContext } from "../../prisma"
import type { PaginationInput } from "../../utils/admin"

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null

function presentQueueItem(item: ReviewQueueItem) {
  return {
    ...item,
    author: { id: item.author.id, name: item.author.name, handle: item.author.handle },
    publishedAt: iso(item.publishedAt),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  }
}

function presentNote(note: {
  id: string
  blockId: string
  text: string
  resolved: boolean
  createdAt: Date
  updatedAt?: Date
}) {
  return {
    id: note.id,
    blockId: note.blockId,
    text: note.text,
    resolved: note.resolved,
    createdAt: note.createdAt.toISOString(),
    updatedAt: iso(note.updatedAt)
  }
}

function presentReply(reply: { id: string; text: string | null; byRole: string | null; createdAt: Date }) {
  return {
    id: reply.id,
    text: reply.text ?? "",
    byRole: reply.byRole,
    createdAt: reply.createdAt.toISOString()
  }
}

function presentItem(item: ReviewItem) {
  return {
    ...presentQueueItem(item),
    body: item.body,
    revisions: item.revisions.map((revision) => ({
      id: revision.id,
      title: revision.title,
      body: revision.body,
      createdAt: revision.createdAt.toISOString(),
      notes: revision.reviewNotes.map(presentNote)
    })),
    decisions: item.decisions.map((decision) => ({
      id: decision.id,
      kind: decision.kind,
      text: decision.text,
      recommendations: decision.recommendations,
      byRole: decision.byRole,
      createdAt: decision.createdAt.toISOString(),
      replies: decision.replies.map(presentReply)
    })),
    aiDecision: item.aiDecision
      ? {
          verdict: item.aiDecision.verdict,
          reasons: item.aiDecision.reasons,
          finishedAt: iso(item.aiDecision.finishedAt)
        }
      : null
  }
}

function presentProfile(item: ProfileReviewItem) {
  return { ...item, updatedAt: item.updatedAt.toISOString() }
}

interface ProfileQueueArgs {
  pagination?: PaginationInput | null
}

export default {
  Query: {
    reviewQueue: async (_parent: unknown, args: ReviewQueueInput, ctx: GraphQLContext) => {
      const page = await listReviewQueue(ctx, args)
      return { ...page, items: page.items.map(presentQueueItem) }
    },
    reviewItem: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      presentItem(await getReviewItem(ctx, id)),
    profileReviewQueue: async (_parent: unknown, args: ProfileQueueArgs, ctx: GraphQLContext) => {
      const page = await listProfileReviewQueue(ctx, args)
      return { ...page, items: page.items.map(presentProfile) }
    }
  },
  Mutation: {
    claimReview: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      presentItem(await claimReview(ctx, id)),
    releaseReview: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      presentItem(await releaseReview(ctx, id)),
    requestReviewRework: async (
      _parent: unknown,
      { id, recommendations }: { id: string; recommendations: string },
      ctx: GraphQLContext
    ) => presentItem(await requestReviewRework(ctx, id, recommendations)),
    publishReviewManual: async (
      _parent: unknown,
      { id, message }: { id: string; message?: string | null },
      ctx: GraphQLContext
    ) => presentItem(await publishReviewManual(ctx, id, message)),
    rejectReviewFinal: async (
      _parent: unknown,
      { id, reason }: { id: string; reason?: string | null },
      ctx: GraphQLContext
    ) => presentItem(await rejectReviewFinal(ctx, id, reason)),
    unpublishReview: async (_parent: unknown, { id, reason }: { id: string; reason: string }, ctx: GraphQLContext) =>
      presentItem(await unpublishReview(ctx, id, reason)),
    replyInReviewDecision: async (
      _parent: unknown,
      { decisionId, text }: { decisionId: string; text: string },
      ctx: GraphQLContext
    ) => presentReply(await replyInReviewDecision(ctx, decisionId, text)),
    createReviewNote: async (_parent: unknown, { input }: { input: CreateReviewNoteInput }, ctx: GraphQLContext) =>
      presentNote(await createReviewNote(ctx, input)),
    decideProfileCheck: async (_parent: unknown, { input }: { input: ProfileDecisionInput }, ctx: GraphQLContext) =>
      presentProfile(await decideProfileCheck(ctx, input))
  }
}
