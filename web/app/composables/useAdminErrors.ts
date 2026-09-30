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

type UnknownRecord = Record<string, unknown>

const record = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {}

const liveHealthSnapshot = (value: unknown): AdminHealthSnapshot | null => {
  const web = record(value)
  const api = record(record(web.api).health)
  const checkedAt =
    typeof api.checkedAt === "string"
      ? api.checkedAt
      : typeof web.checkedAt === "string"
        ? web.checkedAt
        : new Date().toISOString()
  const status = typeof api.status === "string" ? api.status : typeof web.status === "string" ? web.status : null
  if (!status) return null

  if (!Object.keys(api).length) {
    return {
      id: `live:${checkedAt}`,
      status,
      checkedAt,
      components: [{ name: "api", status: "down", adapter: "http", latencyMs: null }],
      backups: []
    }
  }

  return {
    id: `live:${checkedAt}`,
    status,
    checkedAt,
    components: Object.entries(record(api.components)).map(([name, raw]) => {
      const component = record(raw)
      return {
        name,
        status: typeof component.status === "string" ? component.status : "down",
        adapter: typeof component.adapter === "string" ? component.adapter : "unknown",
        latencyMs: typeof component.latencyMs === "number" ? Math.round(component.latencyMs) : null
      }
    }),
    backups: Object.entries(record(api.backups)).map(([kind, raw]) => {
      const backup = record(raw)
      return {
        kind,
        status: typeof backup.status === "string" ? backup.status : "unknown",
        ageHours: typeof backup.ageSeconds === "number" ? Math.floor(backup.ageSeconds / 3600) : null
      }
    })
  }
}

export type AdminErrorRow = GetAdminErrorsQuery["errorLog"]["items"][number]
export type AdminErrorDetail = GetAdminErrorQuery["errorEntry"]
export type AdminErrorStats = GetAdminErrorStatsQuery["errorStats"]
export type AdminHealthSnapshot = GetAdminHealthHistoryQuery["healthHistory"][number]

const extension = (errors: readonly GraphQLErrorLike[] | undefined, key: string): unknown =>
  errors?.[0]?.extensions?.[key]

const errorsFromThrown = (error: unknown): readonly GraphQLErrorLike[] | undefined => {
  if (!error || typeof error !== "object") return undefined
  const data = "data" in error ? (error as { data?: unknown }).data : undefined
  if (!data || typeof data !== "object" || !("errors" in data)) return undefined
  const errors = (data as { errors?: unknown }).errors
  return Array.isArray(errors) ? (errors as GraphQLErrorLike[]) : undefined
}

export const useAdminErrors = () => {
  const items = useState<AdminErrorRow[]>("admin.errors.items", () => [])
  const pagination = useState<GetAdminErrorsQuery["errorLog"]["pagination"] | null>(
    "admin.errors.pagination",
    () => null
  )
  const stats = useState<AdminErrorStats | null>("admin.errors.stats", () => null)
  const health = useState<AdminHealthSnapshot[]>("admin.errors.health", () => [])
  const healthStale = ref(false)
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
      if (!envelope.data?.errorLog) {
        if (health.value.length) healthStale.value = true
        return rememberError(envelope.errors)
      }
      clearError()
      items.value = [...envelope.data.errorLog.items]
      pagination.value = envelope.data.errorLog.pagination
    } catch (error: unknown) {
      items.value = []
      pagination.value = null
      if (health.value.length) healthStale.value = true
      rememberError(errorsFromThrown(error))
    } finally {
      pending.value = false
    }
  }

  const loadStats = async (period: ErrorPeriodInput) => {
    try {
      const envelope = (await useGraphQL(GetAdminErrorStatsDocument, {
        period
      })) as GraphQLEnvelope<GetAdminErrorStatsQuery>
      if (envelope.data?.errorStats) stats.value = envelope.data.errorStats
      else rememberError(envelope.errors)
    } catch (error: unknown) {
      rememberError(errorsFromThrown(error))
    }
  }

  const loadHealth = async (period: ErrorPeriodInput) => {
    try {
      const envelope = (await useGraphQL(GetAdminHealthHistoryDocument, {
        period
      })) as GraphQLEnvelope<GetAdminHealthHistoryQuery>
      if (envelope.data?.healthHistory) {
        health.value = [...envelope.data.healthHistory]
        healthStale.value = false
      } else {
        healthStale.value = true
        rememberError(envelope.errors)
      }
    } catch (error: unknown) {
      healthStale.value = true
      rememberError(errorsFromThrown(error))
    }
  }

  const checkHealthNow = async (period: ErrorPeriodInput) => {
    let live: AdminHealthSnapshot | null
    try {
      live = liveHealthSnapshot(await $fetch("/health", { headers: { accept: "application/json" } }))
    } catch (error: unknown) {
      healthStale.value = true
      rememberError(errorsFromThrown(error))
      return false
    }
    if (!live) {
      healthStale.value = true
      rememberError(undefined)
      return false
    }
    await loadHealth(period)
    health.value = [live, ...health.value.filter((snapshot) => snapshot.checkedAt !== live.checkedAt)]
    healthStale.value = false
    return true
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
    let envelope: GraphQLEnvelope<SetAdminErrorWorkStatusMutation>
    try {
      envelope = (await useGraphQL(SetAdminErrorWorkStatusDocument, {
        id,
        status,
        expectedUpdatedAt,
        comment: comment || null
      })) as GraphQLEnvelope<SetAdminErrorWorkStatusMutation>
    } catch (error: unknown) {
      rememberError(errorsFromThrown(error))
      return null
    }
    if (!envelope.data?.setErrorWorkStatus) {
      rememberError(envelope.errors)
      return null
    }
    clearError()
    return envelope.data.setErrorWorkStatus
  }

  const resolveMany = async (ids: string[]) => {
    errorCode.value = null
    let envelope: GraphQLEnvelope<ResolveAdminErrorsMutation>
    try {
      envelope = (await useGraphQL(ResolveAdminErrorsDocument, {
        ids
      })) as GraphQLEnvelope<ResolveAdminErrorsMutation>
    } catch (error: unknown) {
      rememberError(errorsFromThrown(error))
      return null
    }
    if (!envelope.data?.resolveErrors) {
      rememberError(envelope.errors)
      return null
    }
    clearError()
    return envelope.data.resolveErrors
  }

  const exportCsv = async (filters: ErrorLogFilters) => {
    rateLimitRetryAfter.value = null
    let envelope: GraphQLEnvelope<ExportAdminErrorsMutation>
    try {
      envelope = (await useGraphQL(ExportAdminErrorsDocument, {
        filters
      })) as GraphQLEnvelope<ExportAdminErrorsMutation>
    } catch (error: unknown) {
      rememberError(errorsFromThrown(error))
      return null
    }
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
    healthStale,
    pending,
    failed,
    requestId,
    errorCode,
    rateLimitRetryAfter,
    load,
    loadStats,
    loadHealth,
    checkHealthNow,
    openEntry,
    changeStatus,
    resolveMany,
    exportCsv
  }
}
