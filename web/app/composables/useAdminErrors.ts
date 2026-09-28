import {
  ExportAdminErrorsDocument,
  GetAdminErrorDocument,
  GetAdminErrorsDocument,
  GetAdminErrorStatsDocument,
  GetAdminHealthHistoryDocument,
  ResolveAdminErrorsDocument,
  SetAdminErrorWorkStatusDocument,
  type ErrorLogFilters,
  type ErrorPeriodInput,
  type ErrorWorkStatus,
  type ExportAdminErrorsMutation,
  type GetAdminErrorQuery,
  type GetAdminErrorsQuery,
  type GetAdminErrorStatsQuery,
  type GetAdminHealthHistoryQuery,
  type ResolveAdminErrorsMutation,
  type SetAdminErrorWorkStatusMutation
} from "~/graphql/generated/graphql"

interface GraphQLErrorLike {
  extensions?: Record<string, unknown> | null
}

interface GraphQLEnvelope<T> {
  data?: T | null
  errors?: readonly GraphQLErrorLike[]
}

export type AdminErrorRow = GetAdminErrorsQuery["errorLog"]["items"][number]
export type AdminErrorDetail = GetAdminErrorQuery["errorEntry"]
export type AdminErrorStats = GetAdminErrorStatsQuery["errorStats"]
export type AdminHealthSnapshot = GetAdminHealthHistoryQuery["healthHistory"][number]

const extension = (errors: readonly GraphQLErrorLike[] | undefined, key: string): unknown =>
  errors?.[0]?.extensions?.[key]

export const useAdminErrors = () => {
  const items = useState<AdminErrorRow[]>("admin.errors.items", () => [])
  const pagination = useState<GetAdminErrorsQuery["errorLog"]["pagination"] | null>(
    "admin.errors.pagination",
    () => null
  )
  const stats = useState<AdminErrorStats | null>("admin.errors.stats", () => null)
  const health = useState<AdminHealthSnapshot[]>("admin.errors.health", () => [])
  const pending = ref(false)
  const failed = ref(false)
  const requestId = ref<string | null>(null)
  const errorCode = ref<string | null>(null)
  const rateLimitRetryAfter = ref<number | null>(null)

  const rememberError = (errors: readonly GraphQLErrorLike[] | undefined) => {
    failed.value = true
    const id = extension(errors, "requestId")
    const code = extension(errors, "code")
    requestId.value = typeof id === "string" ? id : null
    errorCode.value = typeof code === "string" ? code : null
  }

  const clearError = () => {
    failed.value = false
    requestId.value = null
    errorCode.value = null
  }

  const load = async (filters: ErrorLogFilters, page = 1) => {
    pending.value = true
    try {
      const envelope = (await useGraphQL(GetAdminErrorsDocument, {
        filters,
        pagination: { page, limit: 25 }
      })) as GraphQLEnvelope<GetAdminErrorsQuery>
      if (!envelope.data?.errorLog) return rememberError(envelope.errors)
      clearError()
      items.value = [...envelope.data.errorLog.items]
      pagination.value = envelope.data.errorLog.pagination
    } finally {
      pending.value = false
    }
  }

  const loadStats = async (period: ErrorPeriodInput) => {
    const envelope = (await useGraphQL(GetAdminErrorStatsDocument, {
      period
    })) as GraphQLEnvelope<GetAdminErrorStatsQuery>
    if (envelope.data?.errorStats) stats.value = envelope.data.errorStats
    else rememberError(envelope.errors)
  }

  const loadHealth = async (period: ErrorPeriodInput) => {
    const envelope = (await useGraphQL(GetAdminHealthHistoryDocument, {
      period
    })) as GraphQLEnvelope<GetAdminHealthHistoryQuery>
    if (envelope.data?.healthHistory) health.value = [...envelope.data.healthHistory]
    else rememberError(envelope.errors)
  }

  const openEntry = async (id: string): Promise<AdminErrorDetail> => {
    const envelope = (await useGraphQL(GetAdminErrorDocument, { id })) as GraphQLEnvelope<GetAdminErrorQuery>
    if (!envelope.data?.errorEntry) {
      throw createError({
        statusCode: extension(envelope.errors, "code") === "NOT_FOUND" ? 404 : 500,
        statusMessage: "Error entry is unavailable"
      })
    }
    return envelope.data.errorEntry
  }

  const changeStatus = async (id: string, status: ErrorWorkStatus, expectedUpdatedAt: string, comment?: string) => {
    errorCode.value = null
    const envelope = (await useGraphQL(SetAdminErrorWorkStatusDocument, {
      id,
      status,
      expectedUpdatedAt,
      comment: comment || null
    })) as GraphQLEnvelope<SetAdminErrorWorkStatusMutation>
    if (!envelope.data?.setErrorWorkStatus) {
      rememberError(envelope.errors)
      return null
    }
    clearError()
    return envelope.data.setErrorWorkStatus
  }

  const resolveMany = async (ids: string[]) => {
    errorCode.value = null
    const envelope = (await useGraphQL(ResolveAdminErrorsDocument, {
      ids
    })) as GraphQLEnvelope<ResolveAdminErrorsMutation>
    if (!envelope.data?.resolveErrors) {
      rememberError(envelope.errors)
      return null
    }
    clearError()
    return envelope.data.resolveErrors
  }

  const exportCsv = async (filters: ErrorLogFilters) => {
    rateLimitRetryAfter.value = null
    const envelope = (await useGraphQL(ExportAdminErrorsDocument, {
      filters
    })) as GraphQLEnvelope<ExportAdminErrorsMutation>
    if (!envelope.data?.exportErrors) {
      if (extension(envelope.errors, "code") === "RATE_LIMITED") {
        const retryAfter = extension(envelope.errors, "retryAfter")
        rateLimitRetryAfter.value = typeof retryAfter === "number" ? retryAfter : 0
        return null
      }
      rememberError(envelope.errors)
      return null
    }
    return envelope.data.exportErrors
  }

  return {
    items,
    pagination,
    stats,
    health,
    pending,
    failed,
    requestId,
    errorCode,
    rateLimitRetryAfter,
    load,
    loadStats,
    loadHealth,
    openEntry,
    changeStatus,
    resolveMany,
    exportCsv
  }
}
