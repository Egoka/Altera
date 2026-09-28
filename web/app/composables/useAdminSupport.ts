import {
  AnswerSupportRequestDocument,
  GetAdminSupportRequestDocument,
  GetAdminSupportRequestsDocument,
  type AdminSupportRequestFiltersInput,
  type GetAdminSupportRequestQuery,
  type GetAdminSupportRequestsQuery,
  type SupportRequestStatus,
  type SupportTopic
} from "~/graphql/generated/graphql"

interface GraphQLErrorLike {
  extensions?: Record<string, unknown> | null
}

interface GraphQLEnvelope<T> {
  data?: T | null
  errors?: readonly GraphQLErrorLike[]
}

export type AdminSupportList = GetAdminSupportRequestsQuery["adminSupportRequests"]
export type AdminSupportRow = AdminSupportList["items"][number]
export type AdminSupportCard = NonNullable<GetAdminSupportRequestQuery["adminSupportRequest"]>

/** Темы обращений справочника `contact.md` §3 — фильтр очереди. */
export const SUPPORT_TOPICS: readonly SupportTopic[] = [
  "general",
  "broken_link",
  "refund",
  "copyright",
  "restore",
  "other"
]

const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string): string | null => {
  const value = errors?.[0]?.extensions?.[key]
  return typeof value === "string" ? value : null
}

const firstQueryValue = (value: unknown): string | null => {
  const single = Array.isArray(value) ? value[0] : value
  return typeof single === "string" && single.trim() ? single.trim() : null
}

const parseStatus = (value: unknown): SupportRequestStatus | null => {
  const single = firstQueryValue(value)
  return single === "received" || single === "answered" ? single : null
}

const parseTopic = (value: unknown): SupportTopic | null => {
  const single = firstQueryValue(value)
  return SUPPORT_TOPICS.find((topic) => topic === single) ?? null
}

/** Карточка обращения и отметка ответа: коды ошибок нужны обоим экранам раздела. */
export const useAdminSupport = () => {
  const requestId = useState<string | null>("admin.support.requestId", () => null)
  const errorCode = useState<string | null>("admin.support.errorCode", () => null)
  const actionPending = ref(false)

  const loadCard = async (id: string): Promise<AdminSupportCard | null> => {
    const envelope = (await useGraphQL(GetAdminSupportRequestDocument, {
      id
    })) as GraphQLEnvelope<GetAdminSupportRequestQuery>
    if (envelope.errors?.length) {
      requestId.value = readExtension(envelope.errors, "requestId")
      errorCode.value = readExtension(envelope.errors, "code")
      if (errorCode.value === "NOT_FOUND") {
        throw createError({ statusCode: 404, statusMessage: "Support request not found" })
      }
      throw createError({ statusCode: 500, statusMessage: "Support request card is unavailable" })
    }
    requestId.value = null
    errorCode.value = null
    return envelope.data?.adminSupportRequest ?? null
  }

  const answer = async (id: string) => {
    actionPending.value = true
    errorCode.value = null
    try {
      const envelope = (await useGraphQL(AnswerSupportRequestDocument, { id })) as GraphQLEnvelope<{
        answerSupportRequest: { id: string; status: SupportRequestStatus; answeredAt?: string | null }
      }>
      if (!envelope.data || envelope.errors?.length) {
        requestId.value = readExtension(envelope.errors, "requestId")
        errorCode.value = readExtension(envelope.errors, "code")
        return null
      }
      requestId.value = null
      return envelope.data.answerSupportRequest
    } finally {
      actionPending.value = false
    }
  }

  return { requestId, errorCode, actionPending, loadCard, answer }
}

/** Очередь обращений: фильтры и страница живут в URL, как в остальных разделах админки. */
export const useAdminSupportQueue = () => {
  const route = useRoute()
  const { requestId, errorCode, actionPending, answer } = useAdminSupport()

  const page = computed(() => {
    const parsed = Number(firstQueryValue(route.query.page) ?? 1)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
  })

  const filters = computed<AdminSupportRequestFiltersInput>(() => {
    const topic = parseTopic(route.query.topic)
    return { status: parseStatus(route.query.status), topic: topic ? [topic] : null }
  })

  const load = async (): Promise<AdminSupportList> => {
    const envelope = (await useGraphQL(GetAdminSupportRequestsDocument, {
      filters: filters.value,
      pagination: { page: page.value, limit: 20 }
    })) as GraphQLEnvelope<GetAdminSupportRequestsQuery>

    if (!envelope.data?.adminSupportRequests || envelope.errors?.length) {
      requestId.value = readExtension(envelope.errors, "requestId")
      errorCode.value = readExtension(envelope.errors, "code")
      throw createError({ statusCode: 500, statusMessage: "Support queue is unavailable" })
    }
    requestId.value = null
    errorCode.value = null
    return envelope.data.adminSupportRequests
  }

  const { data, pending, error, refresh } = useAsyncData("admin-support-queue", load, {
    default: () => null,
    lazy: true,
    server: false,
    watch: [filters, page]
  })

  return {
    items: computed(() => data.value?.items ?? []),
    openCount: computed(() => data.value?.openCount ?? 0),
    pagination: computed(() => data.value?.pagination ?? null),
    pending: computed(() => pending.value || actionPending.value),
    // `useAsyncData` держит в `error` значение `undefined`, а не `null` (см. `useAdminMail`).
    failed: computed(() => Boolean(error.value)),
    requestId,
    errorCode,
    filters,
    page,
    refresh,
    answer
  }
}
