import {
  CreateLegalDraftDocument,
  GetAdminLegalKindsDocument,
  GetAdminLegalVersionDocument,
  GetAdminLegalVersionsDocument,
  PublishLegalVersionDocument,
  type CreateLegalDraftInput,
  type GetAdminLegalKindsQuery,
  type GetAdminLegalVersionQuery,
  type GetAdminLegalVersionsQuery,
  type GetAdminLegalVersionsQueryVariables,
  type LegalTextKind,
  type Locale,
  type PublishLegalVersionInput
} from "~/graphql/generated/graphql"

export type AdminLegalKind = GetAdminLegalKindsQuery["adminLegalKinds"][number]
export type AdminLegalVersionRow = GetAdminLegalVersionsQuery["adminLegalVersions"][number]
export type AdminLegalVersionDetail = NonNullable<GetAdminLegalVersionQuery["adminLegalVersion"]>

interface GraphQLErrorLike {
  extensions?: Record<string, unknown> | null
}

/** Отказ мутации: `CONFLICT` — объект изменил другой `owner` (§9), остальное — ошибка с `requestId`. */
export interface AdminLegalFailure {
  code: string | null
  field: string | null
  requestId: string | null
}

const failureOf = (errors: readonly GraphQLErrorLike[] | undefined): AdminLegalFailure => {
  const extensions = errors?.[0]?.extensions
  const read = (key: string) => (typeof extensions?.[key] === "string" ? (extensions[key] as string) : null)
  return { code: read("code"), field: read("field"), requestId: read("requestId") }
}

/**
 * Чтение раздела — в браузере (`server: false` у соседних разделов): данные зависят от сессии
 * сотрудника и не кешируются. Каждая загрузка ведёт свои флаги состояния §9.
 */
export const useAdminLegal = () => {
  const loading = ref(false)
  const failed = ref(false)
  const requestId = ref<string | null>(null)
  const saving = ref(false)
  const failure = ref<AdminLegalFailure | null>(null)

  const read = async <T>(request: () => Promise<{ data?: T | null; errors?: readonly GraphQLErrorLike[] }>) => {
    loading.value = true
    try {
      const result = await request()
      if (!result.data || result.errors?.length) {
        failed.value = true
        requestId.value = failureOf(result.errors).requestId
        return null
      }
      failed.value = false
      requestId.value = null
      return result.data
    } catch {
      failed.value = true
      requestId.value = null
      return null
    } finally {
      loading.value = false
    }
  }

  const write = async <T>(request: () => Promise<{ data?: T | null; errors?: readonly GraphQLErrorLike[] }>) => {
    saving.value = true
    failure.value = null
    try {
      const result = await request()
      if (!result.data || result.errors?.length) {
        failure.value = failureOf(result.errors)
        return null
      }
      return result.data
    } catch {
      failure.value = { code: null, field: null, requestId: null }
      return null
    } finally {
      saving.value = false
    }
  }

  const loadKinds = async () => (await read(() => useGraphQL(GetAdminLegalKindsDocument, {})))?.adminLegalKinds ?? null

  const loadVersions = async (filter: GetAdminLegalVersionsQueryVariables) =>
    (await read(() => useGraphQL(GetAdminLegalVersionsDocument, filter)))?.adminLegalVersions ?? null

  /** `undefined` — ошибка загрузки, `null` — версии нет (404). */
  const loadVersion = async (kind: LegalTextKind, locale: Locale, version: number) => {
    const data = await read(() => useGraphQL(GetAdminLegalVersionDocument, { kind, locale, version }))
    return data ? data.adminLegalVersion : undefined
  }

  const saveDraft = async (input: CreateLegalDraftInput) =>
    (await write(() => useGraphQL(CreateLegalDraftDocument, { input })))?.createLegalDraft ?? null

  const publish = async (input: PublishLegalVersionInput) =>
    (await write(() => useGraphQL(PublishLegalVersionDocument, { input })))?.publishLegalVersion ?? null

  return { loading, failed, requestId, saving, failure, loadKinds, loadVersions, loadVersion, saveDraft, publish }
}
