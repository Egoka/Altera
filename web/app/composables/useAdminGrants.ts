import {
  GetAdminGrantsDocument,
  GrantPlanDocument,
  RevokePlanDocument,
  type GetAdminGrantsQuery,
  type GrantPlanInput,
  type RevokePlanInput
} from "~/graphql/generated/graphql"

interface GraphQLErrorLike {
  extensions?: Record<string, unknown> | null
}

interface GraphQLEnvelope<T> {
  data?: T | null
  errors?: readonly GraphQLErrorLike[]
}

export type AdminGrantRow = GetAdminGrantsQuery["adminGrants"][number]

function readRequestId(errors: readonly GraphQLErrorLike[] | undefined): string | null {
  const requestId = errors?.[0]?.extensions?.requestId
  return typeof requestId === "string" ? requestId : null
}

export const useAdminGrants = () => {
  const requestId = useState<string | null>("admin.grants.requestId", () => null)
  const mutationPending = ref(false)

  const load = async (): Promise<AdminGrantRow[]> => {
    const envelope = (await useGraphQL(GetAdminGrantsDocument, {})) as GraphQLEnvelope<GetAdminGrantsQuery>
    if (!envelope.data?.adminGrants || envelope.errors?.length) {
      requestId.value = readRequestId(envelope.errors)
      throw createError({ statusCode: 500, statusMessage: "Admin grants are unavailable" })
    }
    requestId.value = null
    return envelope.data.adminGrants
  }

  const { data, pending, error, refresh } = useAsyncData("admin-grants", load, {
    default: () => [],
    lazy: true,
    server: false
  })

  const runMutation = async <T>(request: () => Promise<GraphQLEnvelope<T>>, select: (data: T) => unknown) => {
    mutationPending.value = true
    try {
      const envelope = await request()
      if (!envelope.data || envelope.errors?.length || !select(envelope.data)) {
        requestId.value = readRequestId(envelope.errors)
        return false
      }
      requestId.value = null
      await refresh()
      return true
    } finally {
      mutationPending.value = false
    }
  }

  const grant = (input: GrantPlanInput) =>
    runMutation(
      () => useGraphQL(GrantPlanDocument, { input }),
      (result) => result.grantPlan
    )
  const revoke = (input: RevokePlanInput) =>
    runMutation(
      () => useGraphQL(RevokePlanDocument, { input }),
      (result) => result.revokePlan
    )

  return {
    grants: data,
    pending: computed(() => pending.value || mutationPending.value),
    // `useAsyncData` держит в `error` значение `undefined`, а не `null`: сравнение с `null` включало
    // признак отказа навсегда (nuxt@4 `asyncData.js`: `_errors[key] ??= void 0`).
    failed: computed(() => Boolean(error.value)),
    requestId,
    refresh,
    grant,
    revoke
  }
}
