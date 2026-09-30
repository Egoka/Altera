import {
  AdminChangeEmailDocument,
  ArchiveAccountDocument,
  GetAdminUserAuditDocument,
  GetAdminUserDocument,
  GetAdminUsersDocument,
  RestoreAccountDocument,
  RevokeUserSessionsDocument,
  DecideAppealDocument,
  type AccountAppealDecision,
  type AccountArchiveMode,
  type AdminUserFiltersInput,
  type AdminUserPlanFilter,
  type AdminUserSort,
  type AdminUserStatus,
  type GetAdminUserAuditQuery,
  type GetAdminUserQuery,
  type GetAdminUsersQuery,
  type Role
} from "~/graphql/generated/graphql"
import type { ArchiveReasonCategory } from "~/utils/admin"

/**
 * Раздел админки «Пользователи» (`docs/spec/40-admin/users.md`) и flow #11
 * (`docs/spec/10-flows/archive-account.md`). Фильтры и страница живут в URL, как в остальных
 * разделах; коды ошибок нужны обоим экранам — список показывает `ErrorState` с `requestId`,
 * карточка ещё и конфликт «объект изменён другим администратором» (§9).
 */

interface GraphQLErrorLike {
  extensions?: Record<string, unknown> | null
}

interface GraphQLEnvelope<T> {
  data?: T | null
  errors?: readonly GraphQLErrorLike[]
}

export type AdminUserList = GetAdminUsersQuery["adminUsers"]
export type AdminUserRow = AdminUserList["items"][number]
export type AdminUserCard = NonNullable<GetAdminUserQuery["adminUser"]>
export type AdminUserAuditEntry = GetAdminUserAuditQuery["auditLog"]["entries"][number]

export const USER_STATUSES: readonly AdminUserStatus[] = ["active", "archived"]
export const USER_ARCHIVE_MODES: readonly AccountArchiveMode[] = ["self", "admin", "emergency"]
export const USER_PLANS: readonly AdminUserPlanFilter[] = ["free", "standard", "pro", "grant", "expired"]
export const USER_SORTS: readonly AdminUserSort[] = ["registered", "lastActive", "name", "publications"]
export const USER_ROLES: readonly Role[] = ["reader", "author"]

const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string): string | null => {
  const value = errors?.[0]?.extensions?.[key]
  return typeof value === "string" ? value : null
}

const firstQueryValue = (value: unknown): string | null => {
  const single = Array.isArray(value) ? value[0] : value
  return typeof single === "string" && single.trim() ? single.trim() : null
}

const pick = <T extends string>(allowed: readonly T[], value: unknown): T | null => {
  const single = firstQueryValue(value)
  return allowed.find((candidate) => candidate === single) ?? null
}

const parseFlag = (value: unknown): boolean | null => {
  const single = firstQueryValue(value)
  if (single === "yes") return true
  if (single === "no") return false
  return null
}

/** Фильтры и сортировка раздела из адреса страницы (§4): статус по умолчанию — «активен». */
export const parseUserFilters = (query: Record<string, unknown>): AdminUserFiltersInput => ({
  role: pick(USER_ROLES, query.role),
  status: pick(USER_STATUSES, query.status) ?? "active",
  archiveMode: pick(USER_ARCHIVE_MODES, query.mode),
  plan: pick(USER_PLANS, query.plan),
  registeredFrom: firstQueryValue(query.registeredFrom),
  registeredTo: firstQueryValue(query.registeredTo),
  lastActiveFrom: firstQueryValue(query.lastActiveFrom),
  hasPublications: parseFlag(query.published),
  search: firstQueryValue(query.q),
  sort: pick(USER_SORTS, query.sort) ?? "registered"
})

/** Карточка и действия: одна точка на все мутации раздела, чтобы экран не дублировал разбор ошибок. */
export const useAdminUser = () => {
  const requestId = useState<string | null>("admin.users.requestId", () => null)
  const errorCode = useState<string | null>("admin.users.errorCode", () => null)
  const actionPending = ref(false)

  const remember = (errors: readonly GraphQLErrorLike[] | undefined) => {
    requestId.value = readExtension(errors, "requestId")
    errorCode.value = readExtension(errors, "code")
  }

  const clear = () => {
    requestId.value = null
    errorCode.value = null
  }

  const loadCard = async (id: string): Promise<AdminUserCard | null> => {
    const envelope = (await useGraphQL(GetAdminUserDocument, { id })) as GraphQLEnvelope<GetAdminUserQuery>
    if (envelope.errors?.length) {
      remember(envelope.errors)
      if (errorCode.value === "FORBIDDEN") {
        throw createError({ statusCode: 403, statusMessage: "User card requires analyst, admin or owner role" })
      }
      throw createError({ statusCode: 500, statusMessage: "User card is unavailable" })
    }
    clear()
    // Неизвестный `id` и служебная запись отвечают одинаково: раздел их не знает (§2).
    if (!envelope.data?.adminUser) throw createError({ statusCode: 404, statusMessage: "User not found" })
    return envelope.data.adminUser
  }

  const loadAudit = async (id: string): Promise<AdminUserAuditEntry[]> => {
    const envelope = (await useGraphQL(GetAdminUserAuditDocument, {
      entityId: id
    })) as GraphQLEnvelope<GetAdminUserAuditQuery>
    // Вкладка аудита необязательна для карточки: своя зона журнала у роли может её не отдать (#39).
    if (!envelope.data?.auditLog || envelope.errors?.length) return []
    return envelope.data.auditLog.entries
  }

  const run = async <T>(call: () => Promise<GraphQLEnvelope<T>>): Promise<T | null> => {
    actionPending.value = true
    errorCode.value = null
    try {
      const envelope = await call()
      if (!envelope.data || envelope.errors?.length) {
        remember(envelope.errors)
        return null
      }
      requestId.value = null
      return envelope.data
    } finally {
      actionPending.value = false
    }
  }

  const archive = (input: {
    id: string
    reasonCategory: ArchiveReasonCategory
    internalReason: string
    publicMessage?: string | null
    mode?: AccountArchiveMode
  }) =>
    run(
      () =>
        useGraphQL(ArchiveAccountDocument, {
          id: input.id,
          reasonCategory: input.reasonCategory,
          internalReason: input.internalReason,
          publicMessage: input.publicMessage?.trim() ? input.publicMessage.trim() : null,
          mode: input.mode ?? "admin"
        }) as Promise<GraphQLEnvelope<{ archiveAccount: AdminUserCard }>>
    )

  const restore = (input: { id: string; reason: string }) =>
    run(() => useGraphQL(RestoreAccountDocument, input) as Promise<GraphQLEnvelope<{ restoreAccount: AdminUserCard }>>)

  const revokeSessions = (id: string) =>
    run(
      () =>
        useGraphQL(RevokeUserSessionsDocument, { id }) as Promise<
          GraphQLEnvelope<{ revokeUserSessions: { revokedCount: number } }>
        >
    )

  const changeEmail = (input: { id: string; newEmail: string; reason: string }) =>
    run(
      () =>
        useGraphQL(AdminChangeEmailDocument, input) as Promise<
          GraphQLEnvelope<{ adminChangeEmail: { emailMasked: string; changedAt: string } }>
        >
    )

  const decideAppeal = (input: { id: string; decision: AccountAppealDecision; reason: string }) =>
    run(
      () =>
        useGraphQL(DecideAppealDocument, input) as Promise<
          GraphQLEnvelope<{
            decideAppeal: { id: string | null; status: string; submittedAt: string | null; decidedAt: string | null }
          }>
        >
    )

  return {
    requestId,
    errorCode,
    actionPending,
    loadCard,
    loadAudit,
    archive,
    restore,
    revokeSessions,
    changeEmail,
    decideAppeal
  }
}

/** Список раздела: фильтры, сортировка и страница читаются из адреса (§4). */
export const useAdminUsersList = () => {
  const route = useRoute()
  const { requestId, errorCode } = useAdminUser()

  const page = computed(() => {
    const parsed = Number(firstQueryValue(route.query.page) ?? 1)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
  })

  const filters = computed<AdminUserFiltersInput>(() => parseUserFilters(route.query as Record<string, unknown>))

  const load = async (): Promise<AdminUserList> => {
    const envelope = (await useGraphQL(GetAdminUsersDocument, {
      filters: filters.value,
      pagination: { page: page.value, limit: 20 }
    })) as GraphQLEnvelope<GetAdminUsersQuery>

    if (!envelope.data?.adminUsers || envelope.errors?.length) {
      requestId.value = readExtension(envelope.errors, "requestId")
      errorCode.value = readExtension(envelope.errors, "code")
      throw createError({ statusCode: 500, statusMessage: "Users list is unavailable" })
    }
    requestId.value = null
    errorCode.value = null
    return envelope.data.adminUsers
  }

  const { data, pending, error, refresh } = useAsyncData("admin-users-list", load, {
    default: () => null,
    lazy: true,
    server: false,
    watch: [filters, page]
  })

  return {
    items: computed(() => data.value?.items ?? []),
    pagination: computed(() => data.value?.pagination ?? null),
    viewerRole: computed(() => data.value?.viewerRole ?? null),
    viewerCanManage: computed(() => data.value?.viewerCanManage ?? false),
    pending,
    // `useAsyncData` держит в `error` значение `undefined`, а не `null` (см. `useAdminMail`).
    failed: computed(() => Boolean(error.value)),
    requestId,
    errorCode,
    filters,
    page,
    refresh
  }
}
