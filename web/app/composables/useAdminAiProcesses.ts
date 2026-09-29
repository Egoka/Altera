import type { Ref } from "vue"
import {
  GetAdminAiRecordDocument,
  GetAdminAiRecordsDocument,
  GetAdminAiStatsDocument,
  type AdminAiProcessKind,
  type AdminAiProcessSort,
  type AdminAiProcessStatus,
  type GetAdminAiRecordQuery,
  type GetAdminAiRecordsQuery,
  type GetAdminAiStatsQuery
} from "~/graphql/generated/graphql"

export type AdminAiRecordsPage = GetAdminAiRecordsQuery["adminAiRecords"]
export type AdminAiProcessRow = AdminAiRecordsPage["items"][number]
export type AdminAiProcessCard = NonNullable<GetAdminAiRecordQuery["adminAiRecord"]>
export type AdminAiStats = GetAdminAiStatsQuery["aiStats"]
export type AdminAiPeriod = "7d" | "30d" | "90d"

export const ADMIN_AI_KINDS: readonly AdminAiProcessKind[] = ["check", "translate", "profile", "alt"]
export const ADMIN_AI_STATUSES: readonly AdminAiProcessStatus[] = [
  "created",
  "started",
  "running",
  "completed",
  "failed"
]
export const ADMIN_AI_PERIODS: readonly AdminAiPeriod[] = ["7d", "30d", "90d"]

const PERIOD_DAYS: Record<AdminAiPeriod, number> = { "7d": 7, "30d": 30, "90d": 90 }

export interface AdminAiQueryState {
  kind: AdminAiProcessKind | null
  status: AdminAiProcessStatus | null
  verdict: string | null
  reason: string | null
  query: string | null
  period: AdminAiPeriod
  sort: AdminAiProcessSort
  page: number
}

export interface AdminAiFailure {
  code: string | null
  requestId: string | null
}

interface GraphQLErrorLike {
  extensions?: Record<string, unknown> | null
}

interface GraphQLEnvelope<T> {
  data?: T | null
  errors?: readonly GraphQLErrorLike[]
}

const parseFailure = (errors: readonly GraphQLErrorLike[] | undefined): AdminAiFailure => {
  const extensions = errors?.[0]?.extensions
  return {
    code: typeof extensions?.code === "string" ? extensions.code : null,
    requestId: typeof extensions?.requestId === "string" ? extensions.requestId : null
  }
}

const oneOf = <T extends string>(value: unknown, values: readonly T[]): T | null =>
  typeof value === "string" && values.includes(value as T) ? (value as T) : null

export const parseAdminAiQueryState = (query: Record<string, unknown>): AdminAiQueryState => {
  const page = Number.parseInt(String(query.page ?? ""), 10)
  return {
    kind: oneOf(query.kind, ADMIN_AI_KINDS),
    status: oneOf(query.status, ADMIN_AI_STATUSES),
    verdict: typeof query.verdict === "string" && query.verdict ? query.verdict : null,
    reason: typeof query.reason === "string" && query.reason ? query.reason : null,
    query: typeof query.q === "string" && query.q ? query.q : null,
    period: oneOf(query.period, ADMIN_AI_PERIODS) ?? "7d",
    sort: query.sort === "duration" ? "duration" : "createdAt",
    page: Number.isFinite(page) && page > 0 ? page : 1
  }
}

const periodRange = (period: AdminAiPeriod) => {
  const to = new Date()
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - PERIOD_DAYS[period])
  return { from: from.toISOString(), to: to.toISOString() }
}

export const useAdminAiProcesses = () => {
  const page = useState<AdminAiRecordsPage | null>("admin.ai.records", () => null)
  const stats = useState<AdminAiStats | null>("admin.ai.stats", () => null)
  const card = useState<AdminAiProcessCard | null>("admin.ai.card", () => null)
  const loading = ref(false)
  const listFailure = ref<AdminAiFailure | null>(null)
  const statsFailure = ref<AdminAiFailure | null>(null)
  const cardFailure = ref<AdminAiFailure | null>(null)

  const run = async <T>(request: Promise<GraphQLEnvelope<T>>, failure: Ref<AdminAiFailure | null>) => {
    const envelope = await request
    if (!envelope.data || envelope.errors?.length) {
      failure.value = parseFailure(envelope.errors)
      return null
    }
    failure.value = null
    return envelope.data
  }

  const refresh = async (state: AdminAiQueryState, includeStats: boolean) => {
    loading.value = true
    const period = periodRange(state.period)
    try {
      const requests: [Promise<GetAdminAiRecordsQuery | null>, Promise<GetAdminAiStatsQuery | null>] = [
        run(
          useGraphQL(GetAdminAiRecordsDocument, {
            filters: {
              kind: state.kind,
              status: state.status,
              verdict: state.verdict,
              reason: state.reason,
              query: state.query,
              period
            },
            sort: state.sort,
            page: state.page,
            limit: 20
          }) as Promise<GraphQLEnvelope<GetAdminAiRecordsQuery>>,
          listFailure
        ),
        includeStats
          ? run(
              useGraphQL(GetAdminAiStatsDocument, { period }) as Promise<GraphQLEnvelope<GetAdminAiStatsQuery>>,
              statsFailure
            )
          : Promise.resolve(null)
      ]
      const [records, metrics] = await Promise.all(requests)
      if (records) page.value = records.adminAiRecords
      if (metrics) stats.value = metrics.aiStats
      if (!includeStats) stats.value = null
    } finally {
      loading.value = false
    }
  }

  const openCard = async (id: string) => {
    loading.value = true
    try {
      const data = await run(
        useGraphQL(GetAdminAiRecordDocument, { id }) as Promise<GraphQLEnvelope<GetAdminAiRecordQuery>>,
        cardFailure
      )
      card.value = data?.adminAiRecord ?? null
      return card.value
    } finally {
      loading.value = false
    }
  }

  return {
    items: computed(() => page.value?.items ?? []),
    pagination: computed(() => page.value?.pagination ?? null),
    viewerRole: computed(() => page.value?.viewerRole ?? null),
    stats,
    card,
    loading,
    listFailure,
    statsFailure,
    cardFailure,
    refresh,
    openCard
  }
}
