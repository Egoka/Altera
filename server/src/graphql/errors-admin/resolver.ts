import {
  exportErrors,
  getErrorEntry,
  getErrorStats,
  listErrorLog,
  listHealthHistory,
  resolveErrors,
  setErrorWorkStatus,
  type ErrorLogArgs,
  type ErrorLogFilters,
  type ErrorPeriodInput,
  type ErrorWorkStatus
} from "../../admin/errors"
import type { GraphQLContext } from "../../prisma"

const iso = (value: Date): string => value.toISOString()

const presentLogItem = <T extends { firstSeenAt: Date; lastSeenAt: Date; updatedAt: Date }>(item: T) => ({
  ...item,
  firstSeenAt: iso(item.firstSeenAt),
  lastSeenAt: iso(item.lastSeenAt),
  updatedAt: iso(item.updatedAt)
})

const presentEntry = (entry: Awaited<ReturnType<typeof getErrorEntry>>) => ({
  ...entry,
  firstSeenAt: iso(entry.firstSeenAt),
  lastSeenAt: iso(entry.lastSeenAt),
  updatedAt: iso(entry.updatedAt),
  occurrences: entry.occurrences.map((occurrence) => ({ ...occurrence, occurredAt: iso(occurrence.occurredAt) })),
  statusHistory: entry.statusHistory.map((history) => ({ ...history, createdAt: iso(history.createdAt) }))
})

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const nullableInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null

const presentHealth = (snapshot: Awaited<ReturnType<typeof listHealthHistory>>[number]) => {
  const components = objectValue(snapshot.components)
  const backups = objectValue(snapshot.backups)
  return {
    id: snapshot.id,
    status: snapshot.status,
    checkedAt: snapshot.checkedAt.toISOString(),
    components: Object.entries(components).map(([name, raw]) => {
      const component = objectValue(raw)
      return {
        name,
        status: typeof component.status === "string" ? component.status : "down",
        adapter: typeof component.adapter === "string" ? component.adapter : "unknown",
        latencyMs: nullableInteger(component.latencyMs)
      }
    }),
    backups: Object.entries(backups).map(([kind, raw]) => {
      const backup = objectValue(raw)
      const ageSeconds = nullableInteger(backup.ageSeconds)
      return {
        kind,
        status: typeof backup.status === "string" ? backup.status : "unknown",
        ageHours: ageSeconds === null ? null : Math.floor(ageSeconds / 3600)
      }
    })
  }
}

export default {
  Query: {
    errorLog: async (_parent: unknown, args: ErrorLogArgs, ctx: GraphQLContext) => {
      const page = await listErrorLog(ctx, args)
      return { ...page, items: page.items.map(presentLogItem) }
    },
    errorEntry: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      presentEntry(await getErrorEntry(ctx, id)),
    errorStats: (_parent: unknown, { period }: { period: ErrorPeriodInput }, ctx: GraphQLContext) =>
      getErrorStats(ctx, period),
    healthHistory: async (_parent: unknown, { period }: { period: ErrorPeriodInput }, ctx: GraphQLContext) =>
      (await listHealthHistory(ctx, period)).map(presentHealth)
  },
  Mutation: {
    setErrorWorkStatus: async (
      _parent: unknown,
      args: { id: string; status: ErrorWorkStatus; expectedUpdatedAt: string; comment?: string | null },
      ctx: GraphQLContext
    ) => {
      await setErrorWorkStatus(ctx, args)
      return presentEntry(await getErrorEntry(ctx, args.id))
    },
    resolveErrors: async (_parent: unknown, { ids }: { ids: string[] }, ctx: GraphQLContext) => {
      await resolveErrors(ctx, ids)
      return Promise.all(ids.map(async (id) => presentEntry(await getErrorEntry(ctx, id))))
    },
    exportErrors: (_parent: unknown, { filters }: { filters?: ErrorLogFilters | null }, ctx: GraphQLContext) =>
      exportErrors(ctx, filters ?? {})
  }
}
