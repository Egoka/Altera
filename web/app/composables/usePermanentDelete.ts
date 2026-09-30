import {
  DeletePermanentlyDocument,
  PermanentDeletePreviewDocument,
  type PermanentDeleteEntity,
  type PermanentDeletePreviewQuery
} from "~/graphql/generated/graphql"

/**
 * «Удалить навсегда» (T-076): усиленный диалог поверх уже заархивированной сущности,
 * доступный только `owner` (`docs/spec/10-flows/permanent-delete.md` §1–3). Composable — тонкая
 * обёртка над двумя операциями схемы: предпросмотр и необратимое удаление; коды ошибок
 * (`FORBIDDEN`/`NOT_FOUND`/`CONFLICT`/`VALIDATION_ERROR`) читает вызывающий экран через `errorCode`.
 */

interface GraphQLErrorLike {
  extensions?: Record<string, unknown> | null
  message?: string
}

interface GraphQLEnvelope<T> {
  data?: T | null
  errors?: readonly GraphQLErrorLike[]
}

export type PermanentDeletePreview = PermanentDeletePreviewQuery["permanentDeletePreview"]

const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string): string | null => {
  const value = errors?.[0]?.extensions?.[key]
  return typeof value === "string" ? value : null
}

export const usePermanentDelete = () => {
  const loading = ref(false)
  const preview = ref<PermanentDeletePreview | null>(null)
  const errorCode = ref<string | null>(null)
  const requestId = ref<string | null>(null)

  const remember = (errors: readonly GraphQLErrorLike[] | undefined) => {
    errorCode.value = readExtension(errors, "code")
    requestId.value = readExtension(errors, "requestId")
  }

  const clear = () => {
    errorCode.value = null
    requestId.value = null
  }

  const loadPreview = async (entity: PermanentDeleteEntity, id: string): Promise<PermanentDeletePreview> => {
    loading.value = true
    clear()
    try {
      const envelope = (await useGraphQL(PermanentDeletePreviewDocument, {
        entity,
        id
      })) as GraphQLEnvelope<PermanentDeletePreviewQuery>
      if (!envelope.data?.permanentDeletePreview || envelope.errors?.length) {
        remember(envelope.errors)
        throw new Error(envelope.errors?.[0]?.message ?? "permanentDeletePreview failed")
      }
      preview.value = envelope.data.permanentDeletePreview
      return preview.value
    } finally {
      loading.value = false
    }
  }

  const deletePermanently = async (
    entity: PermanentDeleteEntity,
    id: string,
    confirmedName: string,
    reason: string
  ): Promise<boolean> => {
    loading.value = true
    clear()
    try {
      const envelope = (await useGraphQL(DeletePermanentlyDocument, {
        entity,
        id,
        confirmedName,
        reason
      })) as GraphQLEnvelope<{ deletePermanently: boolean }>
      if (!envelope.data?.deletePermanently || envelope.errors?.length) {
        remember(envelope.errors)
        throw new Error(envelope.errors?.[0]?.message ?? "deletePermanently failed")
      }
      return envelope.data.deletePermanently
    } finally {
      loading.value = false
    }
  }

  return { preview, loading, errorCode, requestId, loadPreview, deletePermanently }
}
