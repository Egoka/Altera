import {
  exportAuditCsv,
  getAuditEntry,
  getAuditSummary,
  listAuditLog,
  type AuditEntryDetail,
  type AuditFilters,
  type AuditListEntry
} from "../../admin/audit"
import type { GraphQLContext } from "../../prisma"

interface FilterArgs {
  filters?: AuditFilters | null
}

/** Время отдаётся строкой ISO 8601: сериализация `Date` в GraphQL `String` даёт метку в мс. */
const toEntry = (entry: AuditListEntry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })
const toDetail = (entry: AuditEntryDetail) => ({ ...entry, createdAt: entry.createdAt.toISOString() })

export default {
  Query: {
    auditLog: async (
      _parent: unknown,
      args: FilterArgs & { limit?: number | null; cursor?: string | null },
      ctx: GraphQLContext
    ) => {
      const page = await listAuditLog(ctx, args.filters ?? {}, { limit: args.limit, cursor: args.cursor })
      return { ...page, entries: page.entries.map(toEntry) }
    },
    auditEntry: async (_parent: unknown, args: { id: string }, ctx: GraphQLContext) =>
      toDetail(await getAuditEntry(ctx, args.id)),
    auditSummary: (_parent: unknown, args: FilterArgs, ctx: GraphQLContext) => getAuditSummary(ctx, args.filters ?? {})
  },
  Mutation: {
    exportAudit: (_parent: unknown, args: FilterArgs, ctx: GraphQLContext) => exportAuditCsv(ctx, args.filters ?? {})
  }
}
