import {
  ExportStatisticsDocument,
  GetStatisticsAiDocument,
  GetStatisticsContentDocument,
  GetStatisticsGrowthDocument,
  type ExportStatisticsMutation,
  type GetStatisticsAiQuery,
  type GetStatisticsContentQuery,
  type GetStatisticsGrowthQuery,
  type Locale,
  type StatisticsRangeInput,
  type StatisticsTab as ApiStatisticsTab
} from "~/graphql/generated/graphql"

export const STATISTICS_TABS = ["growth", "content", "engagement", "finance", "ai", "ranking"] as const
export const STATISTICS_PERIODS = ["7d", "30d", "90d", "custom"] as const

export type StatisticsTab = (typeof STATISTICS_TABS)[number]
export type StatisticsPeriod = (typeof STATISTICS_PERIODS)[number]

export interface StatisticsQueryState {
  tab: StatisticsTab
  period: StatisticsPeriod
  from: string | null
  to: string | null
  sectionId: string | null
  locale: Locale | null
}

export interface StatisticsFailure {
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

export const defaultStatisticsQueryState = (): StatisticsQueryState => ({
  tab: "growth",
  period: "30d",
  from: null,
  to: null,
  sectionId: null,
  locale: null
})

const firstValue = (value: unknown): string | null => {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null
}

export const parseStatisticsQueryState = (query: Record<string, unknown>): StatisticsQueryState => {
  const tabValue = firstValue(query.tab)
  const periodValue = firstValue(query.period)
  const localeValue = firstValue(query.locale)
  return {
    tab: STATISTICS_TABS.find((tab) => tab === tabValue) ?? "growth",
    period: STATISTICS_PERIODS.find((period) => period === periodValue) ?? "30d",
    from: firstValue(query.from),
    to: firstValue(query.to),
    sectionId: firstValue(query.section),
    locale: localeValue === "ru" || localeValue === "en" ? localeValue : null
  }
}

export const statisticsQueryToRoute = (state: StatisticsQueryState): Record<string, string> => ({
  tab: state.tab,
  period: state.period,
  ...(state.period === "custom" && state.from ? { from: state.from } : {}),
  ...(state.period === "custom" && state.to ? { to: state.to } : {}),
  ...(state.sectionId ? { section: state.sectionId } : {}),
  ...(state.locale ? { locale: state.locale } : {})
})

const toRange = (state: StatisticsQueryState): StatisticsRangeInput => ({
  period:
    state.period === "7d"
      ? "DAYS_7"
      : state.period === "90d"
        ? "DAYS_90"
        : state.period === "custom"
          ? "CUSTOM"
          : "DAYS_30",
  from: state.period === "custom" ? state.from : null,
  to: state.period === "custom" ? state.to : null,
  sectionId: state.sectionId,
  locale: state.locale
})

const readFailure = (errors: readonly GraphQLErrorLike[] | undefined): StatisticsFailure => {
  const extensions = errors?.[0]?.extensions
  return {
    code: typeof extensions?.code === "string" ? extensions.code : null,
    requestId: typeof extensions?.requestId === "string" ? extensions.requestId : null
  }
}

export const useAdminStatistics = () => {
  const growth = useState<GetStatisticsGrowthQuery["statisticsGrowth"] | null>("admin.statistics.growth", () => null)
  const content = useState<GetStatisticsContentQuery["statisticsContent"] | null>(
    "admin.statistics.content",
    () => null
  )
  const ai = useState<GetStatisticsAiQuery["statisticsAi"] | null>("admin.statistics.ai", () => null)
  const loading = ref(false)
  const failure = ref<StatisticsFailure | null>(null)
  const retryAfter = ref<number | null>(null)
  let loadSequence = 0

  const load = async (state: StatisticsQueryState) => {
    const sequence = ++loadSequence
    failure.value = null
    if (state.tab === "engagement" || state.tab === "finance" || state.tab === "ranking") {
      loading.value = false
      return
    }
    loading.value = true
    const range = toRange(state)
    try {
      if (state.tab === "growth") {
        const envelope = (await useGraphQL(GetStatisticsGrowthDocument, {
          range
        })) as GraphQLEnvelope<GetStatisticsGrowthQuery>
        if (sequence !== loadSequence) return
        if (!envelope.data?.statisticsGrowth) failure.value = readFailure(envelope.errors)
        else growth.value = envelope.data.statisticsGrowth
      } else if (state.tab === "content") {
        const envelope = (await useGraphQL(GetStatisticsContentDocument, {
          range
        })) as GraphQLEnvelope<GetStatisticsContentQuery>
        if (sequence !== loadSequence) return
        if (!envelope.data?.statisticsContent) failure.value = readFailure(envelope.errors)
        else content.value = envelope.data.statisticsContent
      } else {
        const envelope = (await useGraphQL(GetStatisticsAiDocument, { range })) as GraphQLEnvelope<GetStatisticsAiQuery>
        if (sequence !== loadSequence) return
        if (!envelope.data?.statisticsAi) failure.value = readFailure(envelope.errors)
        else ai.value = envelope.data.statisticsAi
      }
    } catch {
      if (sequence === loadSequence) failure.value = { code: null, requestId: null }
    } finally {
      if (sequence === loadSequence) loading.value = false
    }
  }

  const exportCsv = async (state: StatisticsQueryState) => {
    if (state.tab === "engagement" || state.tab === "finance" || state.tab === "ranking") return null
    retryAfter.value = null
    const tab = state.tab.toUpperCase() as ApiStatisticsTab
    let envelope: GraphQLEnvelope<ExportStatisticsMutation>
    try {
      envelope = (await useGraphQL(ExportStatisticsDocument, {
        tab,
        range: toRange(state)
      })) as GraphQLEnvelope<ExportStatisticsMutation>
    } catch {
      failure.value = { code: null, requestId: null }
      return null
    }
    if (envelope.data?.exportStatistics) return envelope.data.exportStatistics

    const parsed = readFailure(envelope.errors)
    if (parsed.code === "RATE_LIMITED") {
      const value = envelope.errors?.[0]?.extensions?.retryAfter
      retryAfter.value = typeof value === "number" ? value : 0
    } else {
      failure.value = parsed
    }
    return null
  }

  return { growth, content, ai, loading, failure, retryAfter, load, exportCsv }
}
