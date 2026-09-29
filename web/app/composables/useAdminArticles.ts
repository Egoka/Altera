import {
  ArchiveAdminArticleDocument,
  GetAdminArticleDocument,
  GetAdminArticleFilterOptionsDocument,
  GetAdminArticlesDocument,
  RejectAdminReviewFinalDocument,
  RestoreAdminArticleDocument,
  type AdminArticleFiltersInput,
  type AdminArticleSort,
  type AdminArticleTab,
  type GetAdminArticleQuery,
  type GetAdminArticleFilterOptionsQuery,
  type GetAdminArticlesQuery
} from "~/graphql/generated/graphql"
import { canArchiveArticles, canReadArticles, canRejectArticles, canRestoreArticles } from "~/utils/admin"

interface GraphQLErrorLike {
  extensions?: Record<string, unknown> | null
}

interface GraphQLEnvelope<T> {
  data?: T | null
  errors?: readonly GraphQLErrorLike[]
}

export type AdminArticleRow = GetAdminArticlesQuery["adminArticles"]["items"][number]
export type AdminArticleItem = GetAdminArticleQuery["adminArticle"]
export type AdminArticleAction = "archive" | "restore" | "reject"

const tabs: readonly AdminArticleTab[] = ["all", "draft", "review", "published", "rejected", "archived"]
const sorts: readonly AdminArticleSort[] = ["updated", "published", "title", "reads"]
const archiveRoles = ["reader", "author", "editor", "moderator", "admin", "owner"] as const

const firstQueryValue = (value: unknown): string | null => {
  const single = Array.isArray(value) ? value[0] : value
  return typeof single === "string" && single.trim() ? single.trim() : null
}

const pick = <T extends string>(allowed: readonly T[], value: unknown): T | null => {
  const single = firstQueryValue(value)
  return allowed.find((candidate) => candidate === single) ?? null
}

const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string): string | null => {
  const value = errors?.[0]?.extensions?.[key]
  return typeof value === "string" ? value : null
}

const parsePage = (value: unknown) => {
  const parsed = Number(firstQueryValue(value) ?? 1)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

export const adminArticleLoadStatus = (code: string | null): 403 | 404 | 500 => {
  if (code === "NOT_FOUND") return 404
  if (code === "FORBIDDEN") return 403
  return 500
}

export const parseAdminArticleFilters = (query: Record<string, unknown>): AdminArticleFiltersInput => ({
  status: pick(tabs, query.status) ?? "all",
  locale: firstQueryValue(query.locale) === "en" ? "en" : firstQueryValue(query.locale) === "ru" ? "ru" : null,
  sectionId: firstQueryValue(query.section),
  formatId: firstQueryValue(query.format),
  tagId: firstQueryValue(query.tag),
  author: firstQueryValue(query.author),
  archiveRole: pick(archiveRoles, query.archiveRole),
  publishedFrom: firstQueryValue(query.publishedFrom),
  publishedTo: firstQueryValue(query.publishedTo),
  search: firstQueryValue(query.q)
})

export const useAdminArticleFilterOptions = () => {
  const load = async () => {
    const envelope = (await useGraphQL(
      GetAdminArticleFilterOptionsDocument
    )) as GraphQLEnvelope<GetAdminArticleFilterOptionsQuery>
    if (!envelope.data || envelope.errors?.length) return { sections: [], formats: [], tags: [] }
    return envelope.data.adminArticleFilterOptions
  }
  const { data } = useAsyncData("admin-article-filter-options", load)
  return {
    sections: computed(() => data.value?.sections ?? []),
    formats: computed(() => data.value?.formats ?? []),
    tags: computed(() => data.value?.tags ?? [])
  }
}

export const useAdminArticlesList = () => {
  const route = useRoute()
  const requestId = useState<string | null>("admin.articles.list.requestId", () => null)
  const errorCode = useState<string | null>("admin.articles.list.errorCode", () => null)
  const filters = computed(() => parseAdminArticleFilters(route.query as Record<string, unknown>))
  const page = computed(() => parsePage(route.query.page))
  const sort = computed<AdminArticleSort>(() => pick(sorts, route.query.sort) ?? "updated")

  const load = async () => {
    const envelope = (await useGraphQL(GetAdminArticlesDocument, {
      filters: filters.value,
      pagination: { page: page.value, limit: 20 },
      sort: sort.value
    })) as GraphQLEnvelope<GetAdminArticlesQuery>
    if (!envelope.data || envelope.errors?.length) {
      requestId.value = readExtension(envelope.errors, "requestId")
      errorCode.value = readExtension(envelope.errors, "code")
      throw createError({ statusCode: 500, statusMessage: "Articles section is unavailable" })
    }
    requestId.value = null
    errorCode.value = null
    return envelope.data.adminArticles
  }

  const { data, pending, error, refresh } = useAsyncData("admin-articles-list", load, {
    watch: [filters, page, sort]
  })
  return {
    items: computed(() => data.value?.items ?? []),
    pagination: computed(() => data.value?.pagination ?? null),
    pending,
    failed: computed(() => Boolean(error.value)),
    requestId,
    errorCode,
    refresh
  }
}

export const useAdminArticleCard = (id: string) => {
  const { summary } = useAdminDashboard()
  const viewerRole = computed(() => summary.value?.role ?? null)
  const canArchive = computed(() => (viewerRole.value ? canArchiveArticles(viewerRole.value) : false))
  const canRestore = computed(() => (viewerRole.value ? canRestoreArticles(viewerRole.value) : false))
  const canReject = computed(() => (viewerRole.value ? canRejectArticles(viewerRole.value) : false))
  const requestId = useState<string | null>(`admin.articles.${id}.requestId`, () => null)
  const actionErrorCode = useState<string | null>(`admin.articles.${id}.errorCode`, () => null)
  const actionPending = ref(false)

  const load = async () => {
    const envelope = (await useGraphQL(GetAdminArticleDocument, { id })) as GraphQLEnvelope<GetAdminArticleQuery>
    if (!envelope.data || envelope.errors?.length) {
      requestId.value = readExtension(envelope.errors, "requestId")
      actionErrorCode.value = readExtension(envelope.errors, "code")
      throw createError({
        statusCode: adminArticleLoadStatus(actionErrorCode.value),
        statusMessage: actionErrorCode.value === "NOT_FOUND" ? "Article version not found" : "Article is unavailable"
      })
    }
    return envelope.data.adminArticle
  }

  const { data, pending, error, refresh } = useAsyncData(`admin-article-${id}`, load)

  const remember = (envelope: GraphQLEnvelope<unknown>) => {
    requestId.value = readExtension(envelope.errors, "requestId")
    actionErrorCode.value = readExtension(envelope.errors, "code")
    return Boolean(envelope.data) && !envelope.errors?.length
  }

  const runAction = async (action: AdminArticleAction, reason = "") => {
    if (!data.value) return false
    actionPending.value = true
    actionErrorCode.value = null
    try {
      const envelope =
        action === "archive"
          ? ((await useGraphQL(ArchiveAdminArticleDocument, {
              id: data.value.articleId,
              reason: reason.trim()
            })) as GraphQLEnvelope<unknown>)
          : action === "restore"
            ? ((await useGraphQL(RestoreAdminArticleDocument, {
                id: data.value.articleId
              })) as GraphQLEnvelope<unknown>)
            : ((await useGraphQL(RejectAdminReviewFinalDocument, {
                id: data.value.id,
                reason: reason.trim() || null
              })) as GraphQLEnvelope<unknown>)
      if (!remember(envelope)) return false
      await refresh()
      return true
    } finally {
      actionPending.value = false
    }
  }

  return {
    item: computed(() => data.value ?? null),
    pending,
    failed: computed(() => Boolean(error.value)),
    viewerRole,
    canArchive,
    canRestore,
    canReject,
    requestId,
    actionPending,
    actionErrorCode,
    refresh,
    runAction
  }
}

export const articleDocumentText = (value: unknown): string => {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(articleDocumentText).filter(Boolean).join("\n")
  if (!value || typeof value !== "object") return ""
  const record = value as Record<string, unknown>
  if (typeof record.text === "string") return record.text
  return articleDocumentText(record.content)
}

export const canOpenAdminArticles = canReadArticles
