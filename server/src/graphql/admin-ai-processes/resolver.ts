import {
  getAdminAiRecord,
  getAdminAiStats,
  listAdminAiRecords,
  type AdminAiPeriodInput,
  type AdminAiProcess,
  type AdminAiQueryInput,
  type AdminAiStats
} from "../../admin/ai-processes"
import type { GraphQLContext } from "../../prisma"

const iso = (value: Date | null) => value?.toISOString() ?? null

const presentProcess = (process: AdminAiProcess) => ({
  ...process,
  createdAt: process.createdAt.toISOString(),
  startedAt: iso(process.startedAt),
  finishedAt: iso(process.finishedAt)
})

const presentStats = (stats: AdminAiStats) => ({
  ...stats,
  periodFrom: stats.periodFrom.toISOString(),
  periodTo: stats.periodTo.toISOString()
})

export default {
  Query: {
    adminAiRecords: async (_parent: unknown, args: AdminAiQueryInput, ctx: GraphQLContext) => {
      const page = await listAdminAiRecords(ctx, args)
      return { ...page, items: page.items.map(presentProcess) }
    },
    adminAiRecord: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const process = await getAdminAiRecord(ctx, id)
      return process ? presentProcess(process) : null
    },
    aiStats: async (_parent: unknown, { period }: { period?: AdminAiPeriodInput | null }, ctx: GraphQLContext) =>
      presentStats(await getAdminAiStats(ctx, period ?? {}))
  }
}
