import {
  ExportAuditDocument,
  GetAuditEntryDocument,
  GetAuditLogDocument,
  GetAuditSummaryDocument,
  type AuditLogFilters,
  type ExportAuditMutation,
  type GetAuditEntryQuery,
  type GetAuditLogQuery,
  type GetAuditSummaryQuery
} from "~/graphql/generated/graphql"

interface GraphQLErrorLike {
  message?: string
  extensions?: Record<string, unknown> | null
}

interface GraphQLEnvelope<T> {
  data?: T | null
  errors?: readonly GraphQLErrorLike[]
}

export type AuditPage = GetAuditLogQuery["auditLog"]
export type AuditRow = AuditPage["entries"][number]
export type AuditDetail = GetAuditEntryQuery["auditEntry"]
export type AuditSummary = GetAuditSummaryQuery["auditSummary"]

const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string): unknown =>
  errors?.[0]?.extensions?.[key]

const readRequestId = (errors: readonly GraphQLErrorLike[] | undefined): string | null => {
  const requestId = readExtension(errors, "requestId")
  return typeof requestId === "string" ? requestId : null
}

export const useAdminAudit = () => {
  const requestId = useState<string | null>("admin.audit.requestId", () => null)
  const rateLimitRetryAfter = useState<number | null>("admin.audit.rateLimit", () => null)
  const entries = useState<AuditRow[]>("admin.audit.entries", () => [])
  const page = useState<AuditPage | null>("admin.audit.page", () => null)
  const summary = useState<AuditSummary | null>("admin.audit.summary", () => null)
  const pending = ref(false)
  const failed = ref(false)

  const load = async (filters: AuditLogFilters) => {
    pending.value = true
    try {
      const [list, stats] = await Promise.all([
        useGraphQL(GetAuditLogDocument, { filters, limit: 20 }) as Promise<GraphQLEnvelope<GetAuditLogQuery>>,
        useGraphQL(GetAuditSummaryDocument, { filters }) as Promise<GraphQLEnvelope<GetAuditSummaryQuery>>
      ])
      if (!list.data?.auditLog) {
        failed.value = true
        requestId.value = readRequestId(list.errors)
        return
      }
      failed.value = false
      requestId.value = null
      page.value = list.data.auditLog
      entries.value = [...list.data.auditLog.entries]
      summary.value = stats.data?.auditSummary ?? null
    } finally {
      pending.value = false
    }
  }

  const loadMore = async (filters: AuditLogFilters) => {
    const cursor = page.value?.nextCursor
    if (!cursor) return
    pending.value = true
    try {
      const next = (await useGraphQL(GetAuditLogDocument, {
        filters,
        limit: 20,
        cursor
      })) as GraphQLEnvelope<GetAuditLogQuery>
      if (!next.data?.auditLog) {
        failed.value = true
        requestId.value = readRequestId(next.errors)
        return
      }
      page.value = next.data.auditLog
      entries.value = [...entries.value, ...next.data.auditLog.entries]
    } finally {
      pending.value = false
    }
  }

  const openEntry = async (id: string): Promise<AuditDetail> => {
    const envelope = (await useGraphQL(GetAuditEntryDocument, { id })) as GraphQLEnvelope<GetAuditEntryQuery>
    if (!envelope.data?.auditEntry) {
      // Запись вне зоны неотличима от несуществующей: и то и другое — NOT_FOUND.
      throw createError({
        statusCode: readExtension(envelope.errors, "code") === "NOT_FOUND" ? 404 : 500,
        statusMessage: "Audit entry is unavailable"
      })
    }
    return envelope.data.auditEntry
  }

  const exportCsv = async (filters: AuditLogFilters) => {
    rateLimitRetryAfter.value = null
    const envelope = (await useGraphQL(ExportAuditDocument, { filters })) as GraphQLEnvelope<ExportAuditMutation>
    const file = envelope.data?.exportAudit
    if (!file) {
      if (readExtension(envelope.errors, "code") === "RATE_LIMITED") {
        const retryAfter = readExtension(envelope.errors, "retryAfter")
        rateLimitRetryAfter.value = typeof retryAfter === "number" ? retryAfter : 0
        return null
      }
      failed.value = true
      requestId.value = readRequestId(envelope.errors)
      return null
    }
    return file
  }

  return {
    entries,
    page,
    summary,
    pending,
    failed,
    requestId,
    rateLimitRetryAfter,
    load,
    loadMore,
    openEntry,
    exportCsv
  }
}
