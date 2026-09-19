import type { ExecutionResult } from "graphql"
import type { GetAdminCategoriesQuery, GetTaxonomyAuditQuery, TaxonomyStatus } from "~/graphql/generated/graphql"
import {
  ArchiveFormatDocument,
  ArchiveSectionDocument,
  CreateFormatDocument,
  CreateSectionDocument,
  GetAdminCategoriesDocument,
  GetTaxonomyAuditDocument,
  ReorderSectionsDocument,
  RestoreFormatDocument,
  RestoreSectionDocument,
  UpdateFormatDocument,
  UpdateSectionDocument
} from "~/graphql/generated/graphql"

type Section = GetAdminCategoriesQuery["sections"]["sections"][number]
type Format = GetAdminCategoriesQuery["formats"]["formats"][number]
type AuditEntry = GetTaxonomyAuditQuery["taxonomyAudit"][number]
type EntityStatus = TaxonomyStatus | "all"

const graphQLError = (result: ExecutionResult<unknown>) => {
  const error = result.errors?.[0]
  return {
    message: error?.message ?? "GraphQL request failed",
    requestId: typeof error?.extensions?.requestId === "string" ? error.extensions.requestId : null
  }
}

export const useAdminCategories = () => {
  const sections = useState<Section[]>("admin.categories.sections", () => [])
  const formats = useState<Format[]>("admin.categories.formats", () => [])
  const loading = ref(false)
  const failed = ref(false)
  const requestId = ref<string | null>(null)

  const run = async <T>(promise: Promise<ExecutionResult<T>>) => {
    const result = await promise
    if (result.errors?.length || !result.data) {
      const failure = graphQLError(result)
      requestId.value = failure.requestId
      failed.value = true
      throw new Error(failure.message)
    }
    failed.value = false
    requestId.value = null
    return result.data
  }

  const statusFilter = (status: EntityStatus) => (status === "all" ? undefined : [status])

  const refresh = async (status: EntityStatus = "active") => {
    loading.value = true
    try {
      const data = await run(
        useGraphQL(GetAdminCategoriesDocument, {
          sectionPagination: { page: 1, limit: 100 },
          sectionSort: { field: "order", direction: "ASC" },
          sectionFilters: { base: {}, status: statusFilter(status) },
          formatPagination: { page: 1, limit: 100 },
          formatSort: { field: "name", direction: "ASC" },
          formatFilters: { status: statusFilter(status) }
        })
      )
      sections.value = data.sections.sections
      formats.value = data.formats.formats
    } catch {
      failed.value = true
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

  const saveSection = async (section: Partial<Section> & { name: string; nameEn: string; slug: string }) => {
    const input = {
      name: section.name,
      nameEn: section.nameEn,
      slug: section.slug,
      description: section.description,
      descriptionEn: section.descriptionEn,
      seoTitle: section.seoTitle,
      seoTitleEn: section.seoTitleEn,
      seoDescription: section.seoDescription,
      seoDescriptionEn: section.seoDescriptionEn,
      order: section.order ?? sections.value.length + 1
    }
    if (section.id) await mutate(useGraphQL(UpdateSectionDocument, { id: section.id, input }))
    else await mutate(useGraphQL(CreateSectionDocument, { input }))
    await refresh("all")
  }

  const archiveSection = async (id: string, successorId: string, reason: string) => {
    await mutate(useGraphQL(ArchiveSectionDocument, { id, successorId, reason }))
    await refresh("all")
  }

  const restoreSection = async (id: string) => {
    await mutate(useGraphQL(RestoreSectionDocument, { id }))
    await refresh("all")
  }

  const moveSection = async (id: string, direction: -1 | 1) => {
    const ordered = [...sections.value].sort((left, right) => left.order - right.order)
    const index = ordered.findIndex((section) => section.id === id)
    const other = ordered[index + direction]
    const current = ordered[index]
    if (!current || !other) return
    await mutate(
      useGraphQL(ReorderSectionsDocument, {
        input: {
          items: [
            { id: current.id, order: other.order },
            { id: other.id, order: current.order }
          ]
        }
      })
    )
    await refresh("all")
  }

  const saveFormat = async (format: Partial<Format> & { name: string; slug: string }) => {
    const input = {
      name: format.name,
      nameEn: format.nameEn,
      slug: format.slug,
      description: format.description,
      descriptionEn: format.descriptionEn
    }
    if (format.id) await mutate(useGraphQL(UpdateFormatDocument, { id: format.id, input }))
    else await mutate(useGraphQL(CreateFormatDocument, { input }))
    await refresh("all")
  }

  const archiveFormat = async (id: string) => {
    await mutate(useGraphQL(ArchiveFormatDocument, { id }))
    await refresh("all")
  }

  const restoreFormat = async (id: string) => {
    await mutate(useGraphQL(RestoreFormatDocument, { id }))
    await refresh("all")
  }

  const loadAudit = async (entityType: "Section" | "Format", entityId: string): Promise<AuditEntry[]> => {
    const data = await run(useGraphQL(GetTaxonomyAuditDocument, { entityType, entityId }))
    return data.taxonomyAudit
  }

  return {
    sections,
    formats,
    loading,
    failed,
    requestId,
    refresh,
    saveSection,
    archiveSection,
    restoreSection,
    moveSection,
    saveFormat,
    archiveFormat,
    restoreFormat,
    loadAudit
  }
}
