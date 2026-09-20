import {
  cancelAdminJob,
  getAdminJob,
  getJobsSummary,
  listAdminJobs,
  retryAdminJob,
  retryAdminJobs,
  type AdminJobAction,
  type AdminJobCard,
  type AdminJobRow,
  type AdminJobsPage,
  type AdminJobsQueryInput,
  type AdminJobsSummary
} from "../../admin/jobs"
import type { GraphQLContext } from "../../prisma"

const iso = (value: Date | null) => value?.toISOString() ?? null

function presentJob(job: AdminJobRow) {
  return {
    ...job,
    createdAt: job.createdAt.toISOString(),
    startedAt: iso(job.startedAt),
    finishedAt: iso(job.finishedAt),
    cancelledAt: iso(job.cancelledAt)
  }
}

function presentPage(page: AdminJobsPage) {
  return {
    ...page,
    jobs: page.jobs.map(presentJob),
    appliedFrom: page.appliedFrom.toISOString(),
    appliedTo: page.appliedTo.toISOString()
  }
}

function presentAction(action: AdminJobAction) {
  return { ...action, createdAt: action.createdAt.toISOString() }
}

function presentCard(card: AdminJobCard) {
  return {
    ...card,
    job: presentJob(card.job),
    attempts: card.attempts.map((attempt) => ({
      ...attempt,
      startedAt: iso(attempt.startedAt),
      finishedAt: iso(attempt.finishedAt)
    })),
    actions: card.actions.map(presentAction)
  }
}

function presentSummary(summary: AdminJobsSummary) {
  return {
    ...summary,
    periodFrom: summary.periodFrom.toISOString(),
    periodTo: summary.periodTo.toISOString()
  }
}

export default {
  Query: {
    adminJobs: async (_parent: unknown, args: AdminJobsQueryInput, ctx: GraphQLContext) =>
      presentPage(await listAdminJobs(ctx, args)),
    adminJob: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const card = await getAdminJob(ctx, id)
      return card ? presentCard(card) : null
    },
    jobsSummary: async (_parent: unknown, _args: Record<string, never>, ctx: GraphQLContext) =>
      presentSummary(await getJobsSummary(ctx))
  },
  Mutation: {
    retryJob: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      presentJob(await retryAdminJob(ctx, id)),
    cancelJob: async (_parent: unknown, { id, reason }: { id: string; reason: string }, ctx: GraphQLContext) =>
      presentJob(await cancelAdminJob(ctx, id, reason)),
    retryJobs: async (_parent: unknown, { ids }: { ids: string[] }, ctx: GraphQLContext) => retryAdminJobs(ctx, ids)
  }
}
