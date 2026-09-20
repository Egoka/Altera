import {
  ArchiveStaffAccountDocument,
  AssignOwnerDocument,
  ChangeStaffRoleDocument,
  CreateStaffDocument,
  DeactivateOwnerDocument,
  GetAdminStaffDocument,
  GetAdminStaffMemberDocument,
  GetOwnersDocument,
  RestoreStaffAccountDocument,
  RevokeOwnerDocument,
  RevokeStaffRoleDocument,
  type AdminStaffFiltersInput,
  type AssignableStaffRole,
  type CreateStaffInput,
  type GetAdminStaffMemberQuery,
  type GetAdminStaffQuery,
  type GetOwnersQuery
} from "~/graphql/generated/graphql"
import { readStaffFilters } from "~/utils/adminStaffFilters"

interface GraphQLErrorLike {
  extensions?: Record<string, unknown> | null
}

interface GraphQLEnvelope<T> {
  data?: T | null
  errors?: readonly GraphQLErrorLike[]
}

export type AdminStaffRow = GetAdminStaffQuery["adminStaff"][number]
export type AdminStaffCard = NonNullable<GetAdminStaffMemberQuery["adminStaffMember"]>
export type AdminOwnerRow = GetOwnersQuery["owners"][number]

export interface StaffActionFailure {
  code: string | null
  requestId: string | null
}

function readExtension(errors: readonly GraphQLErrorLike[] | undefined, key: string): string | null {
  const value = errors?.[0]?.extensions?.[key]
  return typeof value === "string" ? value : null
}

export const useAdminStaff = () => {
  const route = useRoute()
  const filters = useState<AdminStaffFiltersInput>("admin.staff.filters", () =>
    readStaffFilters(route.query as Record<string, unknown>)
  )
  const failure = useState<StaffActionFailure | null>("admin.staff.failure", () => null)
  const mutationPending = ref(false)
  const card = ref<AdminStaffCard | null>(null)

  const load = async (): Promise<AdminStaffRow[]> => {
    const envelope = (await useGraphQL(GetAdminStaffDocument, {
      filters: filters.value
    })) as GraphQLEnvelope<GetAdminStaffQuery>
    if (!envelope.data?.adminStaff || envelope.errors?.length) {
      failure.value = {
        code: readExtension(envelope.errors, "code"),
        requestId: readExtension(envelope.errors, "requestId")
      }
      throw createError({ statusCode: 500, statusMessage: "Admin staff list is unavailable" })
    }
    failure.value = null
    return envelope.data.adminStaff
  }

  const { data, pending, error, refresh } = useAsyncData("admin-staff", load, {
    default: () => [],
    lazy: true,
    server: false,
    watch: [filters]
  })

  const owners = useAsyncData(
    "admin-staff-owners",
    async (): Promise<AdminOwnerRow[]> => {
      const envelope = (await useGraphQL(GetOwnersDocument, {})) as GraphQLEnvelope<GetOwnersQuery>
      // Список владельцев виден только владельцу: для admin это ожидаемый отказ, не ошибка списка.
      return envelope.data?.owners ?? []
    },
    { default: () => [], lazy: true, server: false }
  )

  const openCard = async (id: string): Promise<AdminStaffCard | null> => {
    const envelope = (await useGraphQL(GetAdminStaffMemberDocument, {
      id
    })) as GraphQLEnvelope<GetAdminStaffMemberQuery>
    card.value = envelope.data?.adminStaffMember ?? null
    if (!card.value) {
      failure.value = {
        code: readExtension(envelope.errors, "code"),
        requestId: readExtension(envelope.errors, "requestId")
      }
    }
    return card.value
  }

  const closeCard = () => {
    card.value = null
  }

  const runMutation = async <T>(request: () => Promise<GraphQLEnvelope<T>>, select: (data: T) => unknown) => {
    mutationPending.value = true
    try {
      const envelope = await request()
      if (!envelope.data || envelope.errors?.length || !select(envelope.data)) {
        failure.value = {
          code: readExtension(envelope.errors, "code"),
          requestId: readExtension(envelope.errors, "requestId")
        }
        return false
      }
      failure.value = null
      await refresh()
      await owners.refresh()
      if (card.value) await openCard(card.value.id)
      return true
    } finally {
      mutationPending.value = false
    }
  }

  const createStaff = (input: CreateStaffInput) =>
    runMutation(
      () => useGraphQL(CreateStaffDocument, { input }),
      (result) => result.createStaff
    )

  const changeRole = (input: { id: string; role: AssignableStaffRole; reason: string }) =>
    runMutation(
      () => useGraphQL(ChangeStaffRoleDocument, input),
      (result) => result.changeStaffRole
    )

  const revokeRole = (input: { id: string; reason: string }) =>
    runMutation(
      () => useGraphQL(RevokeStaffRoleDocument, input),
      (result) => result.revokeStaffRole
    )

  const assignOwner = (input: { id: string }) =>
    runMutation(
      () => useGraphQL(AssignOwnerDocument, input),
      (result) => result.assignOwner
    )

  const revokeOwner = (input: { id: string; reason: string }) =>
    runMutation(
      () => useGraphQL(RevokeOwnerDocument, input),
      (result) => result.revokeOwner
    )

  const deactivateOwner = (input: { id: string; reason: string }) =>
    runMutation(
      () => useGraphQL(DeactivateOwnerDocument, input),
      (result) => result.deactivateOwner
    )

  const archiveAccount = (input: { id: string; reason: string }) =>
    runMutation(
      () => useGraphQL(ArchiveStaffAccountDocument, input),
      (result) => result.archiveStaffAccount
    )

  const restoreAccount = (input: { id: string; reason: string }) =>
    runMutation(
      () => useGraphQL(RestoreStaffAccountDocument, input),
      (result) => result.restoreStaffAccount
    )

  return {
    staff: data,
    owners: owners.data,
    card,
    filters,
    failure,
    pending: computed(() => pending.value || mutationPending.value),
    // Nuxt 4 оставляет `error` равным `undefined`, пока ошибки нет: сравнение с null даёт ложный отказ.
    failed: computed(() => Boolean(error.value)),
    refresh,
    openCard,
    closeCard,
    createStaff,
    changeRole,
    revokeRole,
    assignOwner,
    revokeOwner,
    deactivateOwner,
    archiveAccount,
    restoreAccount
  }
}
