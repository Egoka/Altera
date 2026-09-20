import type { Ref } from "vue"
import {
  CancelJobDocument,
  GetAdminJobDocument,
  GetAdminJobsDocument,
  GetJobsSummaryDocument,
  RetryJobDocument,
  RetryJobsDocument,
  type AdminJobSortField,
  type AdminJobStatus,
  type GetAdminJobQuery,
  type GetAdminJobsQuery,
  type GetJobsSummaryQuery,
  type SortDirection
} from "~/graphql/generated/graphql"

export type AdminJobsPage = GetAdminJobsQuery["adminJobs"]
export type AdminJobRow = AdminJobsPage["jobs"][number]
export type AdminJobCard = NonNullable<GetAdminJobQuery["adminJob"]>
export type AdminJobsSummary = GetJobsSummaryQuery["jobsSummary"]
export type AdminJobPeriod = "24h" | "7d" | "30d"

// `jobs.md` §6 [ДОПУЩЕНИЕ]: массовый повтор ограничен сотней заданий.
export const JOB_BULK_RETRY_LIMIT = 100
export const ADMIN_JOB_PERIODS: readonly AdminJobPeriod[] = ["24h", "7d", "30d"]
export const ADMIN_JOB_STATUSES: readonly AdminJobStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "stuck"
]

const PERIOD_HOURS: Record<AdminJobPeriod, number> = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 }

export interface AdminJobsQueryState {
  kind: string | null
  statuses: AdminJobStatus[]
  period: AdminJobPeriod
  objectId: string | null
  stuckOnly: boolean
  page: number
  sort: AdminJobSortField
  direction: SortDirection
}

export interface AdminJobsFailure {
  code: string | null
  requestId: string | null
}

interface GraphQLErrorLike {
  message?: string
  extensions?: Record<string, unknown> | null
}

interface GraphQLEnvelope<T> {
  data?: T | null
  errors?: readonly GraphQLErrorLike[]
}

export const readFailure = (errors: readonly GraphQLErrorLike[] | undefined): AdminJobsFailure => {
  const extensions = errors?.[0]?.extensions
  return {
    code: typeof extensions?.code === "string" ? extensions.code : null,
    requestId: typeof extensions?.requestId === "string" ? extensions.requestId : null
  }
}

export const defaultJobsQueryState = (): AdminJobsQueryState => ({
  kind: null,
  // `jobs.md` §4: по умолчанию показываются ошибка и зависло.
  statuses: ["failed", "stuck"],
  period: "24h",
  objectId: null,
  stuckOnly: false,
  page: 1,
  sort: "createdAt",
  direction: "DESC"
})

const asStatuses = (value: unknown): AdminJobStatus[] => {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []
  return raw.filter((item): item is AdminJobStatus => ADMIN_JOB_STATUSES.includes(item as AdminJobStatus))
}

export const parseJobsQueryState = (query: Record<string, unknown>): AdminJobsQueryState => {
  const base = defaultJobsQueryState()
  const statuses = asStatuses(query.status)
  const page = Number.parseInt(String(query.page ?? ""), 10)
  const period = ADMIN_JOB_PERIODS.find((item) => item === query.period)
  const sort = ["createdAt", "duration", "attempts"].includes(String(query.sort))
    ? (String(query.sort) as AdminJobSortField)
    : base.sort
  return {
    kind: typeof query.kind === "string" && query.kind ? query.kind : null,
    statuses: statuses.length ? statuses : base.statuses,
    period: period ?? base.period,
    objectId: typeof query.object === "string" && query.object ? query.object : null,
    stuckOnly: query.stuck === "1" || query.stuck === 1,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    sort,
    direction: query.dir === "ASC" ? "ASC" : base.direction
  }
}

export const jobsQueryToRoute = (state: AdminJobsQueryState): Record<string, string> => {
  const defaults = defaultJobsQueryState()
  const query: Record<string, string> = {}
  if (state.kind) query.kind = state.kind
  if (state.statuses.join(",") !== defaults.statuses.join(",")) query.status = state.statuses.join(",")
  if (state.period !== defaults.period) query.period = state.period
  if (state.objectId) query.object = state.objectId
  if (state.stuckOnly) query.stuck = "1"
  if (state.page > 1) query.page = String(state.page)
  if (state.sort !== defaults.sort) query.sort = state.sort
  if (state.direction !== defaults.direction) query.dir = state.direction
  return query
}

export const useAdminJobs = () => {
  const page = useState<AdminJobsPage | null>("admin.jobs.page", () => null)
  const summary = useState<AdminJobsSummary | null>("admin.jobs.summary", () => null)
  const card = useState<AdminJobCard | null>("admin.jobs.card", () => null)
  const loading = ref(false)
  const acting = ref(false)
  const listFailure = ref<AdminJobsFailure | null>(null)
  const summaryFailure = ref<AdminJobsFailure | null>(null)
  const actionFailure = ref<AdminJobsFailure | null>(null)

  const run = async <T>(request: Promise<GraphQLEnvelope<T>>, failure: Ref<AdminJobsFailure | null>) => {
    const envelope = await request
    if (!envelope.data || envelope.errors?.length) {
      failure.value = readFailure(envelope.errors)
      return null
    }
    failure.value = null
    return envelope.data
  }

  const refresh = async (state: AdminJobsQueryState) => {
    loading.value = true
    try {
      const to = new Date()
      const from = new Date(to.getTime() - PERIOD_HOURS[state.period] * 3_600_000)
      const [list, metrics] = await Promise.all([
        run(
          useGraphQL(GetAdminJobsDocument, {
            filters: {
              kinds: state.kind ? [state.kind] : null,
              statuses: state.statuses,
              from: from.toISOString(),
              to: to.toISOString(),
              objectId: state.objectId,
              stuckOnly: state.stuckOnly
            },
            sort: { field: state.sort, direction: state.direction },
            page: state.page,
            limit: 20
          }) as Promise<GraphQLEnvelope<GetAdminJobsQuery>>,
          listFailure
        ),
        run(useGraphQL(GetJobsSummaryDocument, {}) as Promise<GraphQLEnvelope<GetJobsSummaryQuery>>, summaryFailure)
      ])
      if (list) page.value = list.adminJobs
      if (metrics) summary.value = metrics.jobsSummary
    } finally {
      loading.value = false
    }
  }

  const openCard = async (id: string) => {
    const data = await run(
      useGraphQL(GetAdminJobDocument, { id }) as Promise<GraphQLEnvelope<GetAdminJobQuery>>,
      actionFailure
    )
    card.value = data?.adminJob ?? null
    return card.value
  }

  const closeCard = () => {
    card.value = null
  }

  const act = async <T>(request: Promise<GraphQLEnvelope<T>>) => {
    acting.value = true
    try {
      return await run(request, actionFailure)
    } finally {
      acting.value = false
    }
  }

  const retry = (id: string) => act(useGraphQL(RetryJobDocument, { id }))
  const cancel = (id: string, reason: string) => act(useGraphQL(CancelJobDocument, { id, reason }))
  const retryMany = async (ids: string[]) => {
    if (ids.length > JOB_BULK_RETRY_LIMIT) {
      actionFailure.value = { code: "LIMIT_EXCEEDED", requestId: null }
      return null
    }
    const data = await act(useGraphQL(RetryJobsDocument, { ids }))
    // Единственная проверка входа массового повтора на сервере — размер списка заданий.
    if (actionFailure.value?.code === "VALIDATION_ERROR") {
      actionFailure.value = { ...actionFailure.value, code: "LIMIT_EXCEEDED" }
    }
    return data?.retryJobs ?? null
  }

  return {
    page,
    summary,
    card,
    loading,
    acting,
    listFailure,
    summaryFailure,
    actionFailure,
    refresh,
    openCard,
    closeCard,
    retry,
    cancel,
    retryMany
  }
}
