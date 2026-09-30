import {
  ClaimReviewDocument,
  CreateAdminReviewNoteDocument,
  DecideAdminProfileCheckDocument,
  GetAdminReviewItemDocument,
  GetAdminReviewQueueDocument,
  GetProfileReviewQueueDocument,
  PublishAdminReviewManualDocument,
  RejectAdminReviewFinalDocument,
  ReleaseReviewDocument,
  ReplyInAdminReviewDecisionDocument,
  RequestAdminReviewReworkDocument,
  UnpublishAdminReviewDocument,
  type CreateAdminReviewNoteInput,
  type GetAdminReviewItemQuery,
  type GetAdminReviewQueueQuery,
  type GetProfileReviewQueueQuery,
  type ProfileReviewDecisionInput,
  type ReviewQueueFiltersInput,
  type ReviewQueueSort,
  type ReviewQueueState
} from "~/graphql/generated/graphql"
import { canDecideReviews } from "~/utils/admin"

interface GraphQLErrorLike {
  extensions?: Record<string, unknown> | null
}

interface GraphQLEnvelope<T> {
  data?: T | null
  errors?: readonly GraphQLErrorLike[]
}

export type AdminReviewRow = GetAdminReviewQueueQuery["reviewQueue"]["items"][number]
export type AdminReviewItem = GetAdminReviewItemQuery["reviewItem"]
export type ProfileReviewRow = GetProfileReviewQueueQuery["profileReviewQueue"]["items"][number]
export type ReviewAction = "claim" | "release" | "rework" | "publish" | "reject" | "unpublish"

const states: readonly ReviewQueueState[] = ["queued", "in_review", "rework", "published"]
const sorts: readonly ReviewQueueSort[] = ["age", "updated"]

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

export const reviewItemLoadStatus = (code: string | null): 404 | 500 => (code === "NOT_FOUND" ? 404 : 500)

export const parseReviewFilters = (query: Record<string, unknown>): ReviewQueueFiltersInput => ({
  states: pick(states, query.state) ? [pick(states, query.state)!] : null,
  locale: firstQueryValue(query.locale) === "en" ? "en" : firstQueryValue(query.locale) === "ru" ? "ru" : null,
  sectionId: firstQueryValue(query.section),
  editorial:
    firstQueryValue(query.editorial) === "yes" ? true : firstQueryValue(query.editorial) === "no" ? false : null,
  search: firstQueryValue(query.q)
})

const parsePage = (value: unknown) => {
  const parsed = Number(firstQueryValue(value) ?? 1)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

export const useAdminReviewList = () => {
  const route = useRoute()
  const { summary } = useAdminDashboard()
  const canDecide = computed(() => (summary.value?.role ? canDecideReviews(summary.value.role) : false))
  const requestId = useState<string | null>("admin.review.list.requestId", () => null)
  const errorCode = useState<string | null>("admin.review.list.errorCode", () => null)
  const tab = computed(() => (firstQueryValue(route.query.tab) === "profiles" ? "profiles" : "materials"))
  const page = computed(() => parsePage(route.query.page))
  const filters = computed(() => parseReviewFilters(route.query as Record<string, unknown>))
  const sort = computed<ReviewQueueSort>(() => pick(sorts, route.query.sort) ?? "age")

  const load = async () => {
    const envelope =
      tab.value === "profiles"
        ? ((await useGraphQL(GetProfileReviewQueueDocument, {
            pagination: { page: page.value, limit: 20 }
          })) as GraphQLEnvelope<GetProfileReviewQueueQuery>)
        : ((await useGraphQL(GetAdminReviewQueueDocument, {
            filters: filters.value,
            pagination: { page: page.value, limit: 20 },
            sort: sort.value
          })) as GraphQLEnvelope<GetAdminReviewQueueQuery>)
    if (!envelope.data || envelope.errors?.length) {
      requestId.value = readExtension(envelope.errors, "requestId")
      errorCode.value = readExtension(envelope.errors, "code")
      throw createError({ statusCode: 500, statusMessage: "Review queue is unavailable" })
    }
    requestId.value = null
    errorCode.value = null
    return envelope.data
  }

  const { data, pending, error, refresh } = useAsyncData("admin-review-list", load, {
    watch: [tab, page, filters, sort]
  })
  const items = computed(() => {
    const result = data.value
    return result && "reviewQueue" in result ? result.reviewQueue.items : []
  })
  const profiles = computed(() => {
    const result = data.value
    return result && "profileReviewQueue" in result ? result.profileReviewQueue.items : []
  })
  const pagination = computed(() =>
    data.value && "reviewQueue" in data.value
      ? data.value.reviewQueue.pagination
      : data.value?.profileReviewQueue.pagination
  )

  const decideProfile = async (input: ProfileReviewDecisionInput) => {
    const envelope = (await useGraphQL(DecideAdminProfileCheckDocument, { input })) as GraphQLEnvelope<{
      decideProfileCheck: ProfileReviewRow
    }>
    requestId.value = readExtension(envelope.errors, "requestId")
    errorCode.value = readExtension(envelope.errors, "code")
    if (!envelope.data || envelope.errors?.length) return false
    await refresh()
    return true
  }

  return {
    items,
    profiles,
    pagination,
    pending,
    failed: computed(() => Boolean(error.value)),
    requestId,
    errorCode,
    canDecide,
    refresh,
    decideProfile
  }
}

export const useAdminReviewCard = (id: string) => {
  const { summary } = useAdminDashboard()
  const viewerRole = computed(() => summary.value?.role ?? null)
  const canDecide = computed(() => (viewerRole.value ? canDecideReviews(viewerRole.value) : false))
  const requestId = useState<string | null>(`admin.review.${id}.requestId`, () => null)
  const errorCode = useState<string | null>(`admin.review.${id}.errorCode`, () => null)
  const actionPending = ref(false)

  const load = async () => {
    const envelope = (await useGraphQL(GetAdminReviewItemDocument, { id })) as GraphQLEnvelope<GetAdminReviewItemQuery>
    if (!envelope.data || envelope.errors?.length) {
      requestId.value = readExtension(envelope.errors, "requestId")
      errorCode.value = readExtension(envelope.errors, "code")
      throw createError({
        statusCode: reviewItemLoadStatus(errorCode.value),
        statusMessage: errorCode.value === "NOT_FOUND" ? "Review item not found" : "Review item is unavailable"
      })
    }
    return envelope.data.reviewItem
  }

  const { data, pending, error, refresh } = useAsyncData(`admin-review-${id}`, load)

  const remember = (envelope: GraphQLEnvelope<unknown>) => {
    requestId.value = readExtension(envelope.errors, "requestId")
    errorCode.value = readExtension(envelope.errors, "code")
    return Boolean(envelope.data) && !envelope.errors?.length
  }

  const runAction = async (action: ReviewAction, text = "") => {
    actionPending.value = true
    errorCode.value = null
    try {
      let envelope: GraphQLEnvelope<unknown>
      if (action === "claim") envelope = (await useGraphQL(ClaimReviewDocument, { id })) as GraphQLEnvelope<unknown>
      else if (action === "release")
        envelope = (await useGraphQL(ReleaseReviewDocument, { id })) as GraphQLEnvelope<unknown>
      else if (action === "rework")
        envelope = (await useGraphQL(RequestAdminReviewReworkDocument, {
          id,
          recommendations: text.trim()
        })) as GraphQLEnvelope<unknown>
      else if (action === "publish")
        envelope = (await useGraphQL(PublishAdminReviewManualDocument, {
          id,
          message: text.trim() || null
        })) as GraphQLEnvelope<unknown>
      else if (action === "reject")
        envelope = (await useGraphQL(RejectAdminReviewFinalDocument, {
          id,
          reason: text.trim() || null
        })) as GraphQLEnvelope<unknown>
      else
        envelope = (await useGraphQL(UnpublishAdminReviewDocument, {
          id,
          reason: text.trim()
        })) as GraphQLEnvelope<unknown>

      if (!remember(envelope)) return false
      await refresh()
      return true
    } finally {
      actionPending.value = false
    }
  }

  const reply = async (decisionId: string, text: string) => {
    const envelope = (await useGraphQL(ReplyInAdminReviewDecisionDocument, {
      decisionId,
      text: text.trim()
    })) as GraphQLEnvelope<unknown>
    if (!remember(envelope)) return false
    await refresh()
    return true
  }

  const note = async (input: CreateAdminReviewNoteInput) => {
    const envelope = (await useGraphQL(CreateAdminReviewNoteDocument, { input })) as GraphQLEnvelope<unknown>
    if (!remember(envelope)) return false
    await refresh()
    return true
  }

  return {
    item: computed(() => data.value ?? null),
    pending,
    failed: computed(() => Boolean(error.value)),
    viewerRole,
    canDecide,
    requestId,
    errorCode,
    actionPending,
    refresh,
    runAction,
    reply,
    note
  }
}
