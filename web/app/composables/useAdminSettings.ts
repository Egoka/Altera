import type { GetSystemSettingsQuery, SystemSettingsGroup } from "~/graphql/generated/graphql"
import { GetSystemSettingsDocument } from "~/graphql/generated/graphql"

export const useAdminSettings = () => {
  const settings = ref<GetSystemSettingsQuery["systemSettings"] | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  const requestId = ref<string | null>(null)

  const load = async (group: SystemSettingsGroup) => {
    loading.value = true
    try {
      const result = await useGraphQL(GetSystemSettingsDocument, { group })
      const error = result.errors?.[0]
      if (error || !result.data) {
        failed.value = true
        requestId.value = typeof error?.extensions?.requestId === "string" ? error.extensions.requestId : null
        return
      }
      settings.value = result.data.systemSettings
      failed.value = false
      requestId.value = null
    } catch {
      failed.value = true
      requestId.value = null
    } finally {
      loading.value = false
    }
  }

  return { settings, loading, failed, requestId, load }
}
