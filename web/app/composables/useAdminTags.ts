import type { ExecutionResult } from "graphql"
import type { GetAdminTagsQuery, GetTaxonomyAuditQuery, TaxonomyStatus } from "~/graphql/generated/graphql"
import {
  ArchiveTagDocument,
  GetAdminTagsDocument,
  GetTaxonomyAuditDocument,
  MergeTagsDocument,
  RestoreTagDocument
} from "~/graphql/generated/graphql"

export type AdminTag = GetAdminTagsQuery["tags"]["tags"][number]
type AuditEntry = GetTaxonomyAuditQuery["taxonomyAudit"][number]
export type AdminTagStatus = TaxonomyStatus | "all"

/** Максимум источников массового слияния и архивирования (`40-admin/tags.md` §6). */
export const TAG_BULK_LIMIT = 50

interface GraphQLFailure {
  message: string
  code: string | null
  requestId: string | null
}

const graphQLFailure = (result: ExecutionResult<unknown>): GraphQLFailure => {
  const error = result.errors?.[0]
  return {
    message: error?.message ?? "GraphQL request failed",
    code: typeof error?.extensions?.code === "string" ? error.extensions.code : null,
    requestId: typeof error?.extensions?.requestId === "string" ? error.extensions.requestId : null
  }
}

export const useAdminTags = () => {
  const tags = useState<AdminTag[]>("admin.tags.items", () => [])
  const loading = ref(false)
  const failed = ref(false)
  const conflict = ref(false)
  const forbidden = ref(false)
  const requestId = ref<string | null>(null)

  const run = async <T>(promise: Promise<ExecutionResult<T>>) => {
    const result = await promise
    if (result.errors?.length || !result.data) {
      const failure = graphQLFailure(result)
      requestId.value = failure.requestId
      // Конфликт и запрет — отдельные состояния раздела (`40-admin/tags.md` §9):
      // список остаётся на экране, выбор не сбрасывается, меняется только пояснение.
      conflict.value = failure.code === "CONFLICT"
      forbidden.value = failure.code === "FORBIDDEN"
      failed.value = !conflict.value && !forbidden.value
      throw new Error(failure.message)
    }
    failed.value = false
    conflict.value = false
    forbidden.value = false
    requestId.value = null
    return result.data
  }

  const statusFilter = (status: AdminTagStatus) => (status === "all" ? undefined : [status])

  const refresh = async (status: AdminTagStatus = "active") => {
    loading.value = true
    try {
      const data = await run(
        useGraphQL(GetAdminTagsDocument, {
          pagination: { page: 1, limit: 100 },
          sort: { field: "_count.articles", direction: "DESC" },
          filters: { base: {}, status: statusFilter(status) }
        })
      )
      tags.value = data.tags.tags
    } catch {
      // Причину уже записал `run`: список сохраняется, чтобы выбор пережил ошибку.
    } finally {
      loading.value = false
    }
  }

  const mutate = async <T>(promise: Promise<ExecutionResult<T>>) => {
    loading.value = true
    try {
      return await run(promise)
    } finally {
      loading.value = false
    }
  }

  const merge = async (sourceTagIds: string[], targetTagId: string, status: AdminTagStatus) => {
    await mutate(useGraphQL(MergeTagsDocument, { input: { sourceTagIds, targetTagId } }))
    await refresh(status)
  }

  const archive = async (id: string, status: AdminTagStatus) => {
    await mutate(useGraphQL(ArchiveTagDocument, { id }))
    await refresh(status)
  }

  const restore = async (id: string, status: AdminTagStatus) => {
    await mutate(useGraphQL(RestoreTagDocument, { id }))
    await refresh(status)
  }

  const loadAudit = async (entityId: string): Promise<AuditEntry[]> => {
    const data = await run(useGraphQL(GetTaxonomyAuditDocument, { entityType: "Tag", entityId }))
    return data.taxonomyAudit
  }

  return { tags, loading, failed, conflict, forbidden, requestId, refresh, merge, archive, restore, loadAudit }
}
