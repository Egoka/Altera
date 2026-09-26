import {
  GetAdminMailDocument,
  GetAdminMailsDocument,
  ResendMailDocument,
  ResendMailsDocument,
  type AdminMailFiltersInput,
  type GetAdminMailQuery,
  type GetAdminMailsQuery
} from "~/graphql/generated/graphql"

interface GraphQLErrorLike {
  extensions?: Record<string, unknown> | null
}

interface GraphQLEnvelope<T> {
  data?: T | null
  errors?: readonly GraphQLErrorLike[]
}

export type AdminMailListResult = GetAdminMailsQuery["adminMails"]
export type AdminMailRow = AdminMailListResult["items"][number]
export type AdminMailCard = NonNullable<GetAdminMailQuery["adminMail"]>

/** Периоды списка: значение из URL `?period=`; по умолчанию сервер берёт 7 дней. */
export type AdminMailPeriod = "7d" | "30d"

const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string): string | null => {
  const value = errors?.[0]?.extensions?.[key]
  return typeof value === "string" ? value : null
}

const periodStart = (period: AdminMailPeriod): string => {
  const from = new Date()
  from.setUTCDate(from.getUTCDate() - (period === "30d" ? 30 : 7))
  return from.toISOString()
}

const firstQueryValue = (value: unknown): string | null => {
  const single = Array.isArray(value) ? value[0] : value
  return typeof single === "string" && single.trim() ? single.trim() : null
}

/** Общее состояние раздела: запрос карточки, повтор отправки и коды ошибок для состояний §9. */
export const useAdminMail = () => {
  const requestId = useState<string | null>("admin.mail.requestId", () => null)
  const errorCode = useState<string | null>("admin.mail.errorCode", () => null)
  const actionPending = ref(false)

  const loadCard = async (id: string): Promise<AdminMailCard | null> => {
    const envelope = (await useGraphQL(GetAdminMailDocument, { id })) as GraphQLEnvelope<GetAdminMailQuery>
    if (envelope.errors?.length) {
      requestId.value = readExtension(envelope.errors, "requestId")
      errorCode.value = readExtension(envelope.errors, "code")
      if (errorCode.value === "NOT_FOUND") {
        throw createError({ statusCode: 404, statusMessage: "Mail not found" })
      }
      throw createError({ statusCode: 500, statusMessage: "Admin mail card is unavailable" })
    }
    requestId.value = null
    errorCode.value = null
    return envelope.data?.adminMail ?? null
  }

  const runAction = async <T>(request: () => Promise<GraphQLEnvelope<T>>): Promise<T | null> => {
    actionPending.value = true
    errorCode.value = null
    try {
      const envelope = await request()
      if (!envelope.data || envelope.errors?.length) {
        requestId.value = readExtension(envelope.errors, "requestId")
        errorCode.value = readExtension(envelope.errors, "code")
        return null
      }
      requestId.value = null
      return envelope.data
    } finally {
      actionPending.value = false
    }
  }

  return {
    requestId,
    errorCode,
    actionPending,
    loadCard,
    resend: (id: string) => runAction(() => useGraphQL(ResendMailDocument, { id })),
    resendMany: (ids: string[]) => runAction(() => useGraphQL(ResendMailsDocument, { ids }))
  }
}

/** Список писем: фильтры и страница живут в URL (`docs/spec/40-admin/mail.md` §2). */
export const useAdminMailList = () => {
  const route = useRoute()
  const { requestId, errorCode, actionPending, resend, resendMany } = useAdminMail()

  const period = computed<AdminMailPeriod>(() => (firstQueryValue(route.query.period) === "30d" ? "30d" : "7d"))
  const page = computed(() => {
    const parsed = Number(firstQueryValue(route.query.page) ?? 1)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
  })

  const filters = computed<AdminMailFiltersInput>(() => ({
    template: firstQueryValue(route.query.template),
    status: firstQueryValue(route.query.status) ? [firstQueryValue(route.query.status) as "failed"] : null,
    recipient: firstQueryValue(route.query.recipient),
    objectId: firstQueryValue(route.query.object),
    query: firstQueryValue(route.query.q),
    period: { from: periodStart(period.value) }
  }))

  const load = async (): Promise<AdminMailListResult> => {
    const envelope = (await useGraphQL(GetAdminMailsDocument, {
      filters: filters.value,
      pagination: { page: page.value, limit: 20 }
    })) as GraphQLEnvelope<GetAdminMailsQuery>

    if (!envelope.data?.adminMails || envelope.errors?.length) {
      requestId.value = readExtension(envelope.errors, "requestId")
      errorCode.value = readExtension(envelope.errors, "code")
      throw createError({ statusCode: 500, statusMessage: "Admin mail history is unavailable" })
    }
    requestId.value = null
    errorCode.value = null
    return envelope.data.adminMails
  }

  const { data, pending, error, refresh } = useAsyncData("admin-mail-list", load, {
    default: () => null,
    lazy: true,
    server: false,
    watch: [filters, page]
  })

  return {
    items: computed(() => data.value?.items ?? []),
    access: computed(() => data.value?.access ?? null),
    providerWaiting: computed(() => data.value?.providerWaiting === true),
    // Повтор показывается по праву `job.retry` с сервера, а не по роли `owner` в клиенте (§5).
    viewerCanResend: computed(() => data.value?.viewerCanResend === true),
    pagination: computed(() => data.value?.pagination ?? null),
    pending: computed(() => pending.value || actionPending.value),
    // `useAsyncData` держит в `error` значение `undefined`, а не `null`: сравнение с `null` дало бы
    // вечное состояние ошибки и скрыло таблицу (nuxt@4 `asyncData.js`: `_errors[key] ??= void 0`).
    failed: computed(() => Boolean(error.value)),
    requestId,
    errorCode,
    period,
    page,
    refresh,
    resend,
    resendMany
  }
}
