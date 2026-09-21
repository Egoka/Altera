import { onMounted, readonly, ref } from "vue"
import { useGraphQL } from "~/composables/useGraphQL"
import { GET_NAVIGATION } from "~/query"

export interface PublicNavigationSection {
  id: string
  name: string
  nameEn?: string | null
  slug: string
  order: number
  articleCount: number
}

export interface PublicNavigationTag {
  name: string
  slug: string
  articleCount: number
}

/**
 * `enabled: false` оставляет меню пустым и не обращается к API: страница 500 и офлайн-страница
 * обязаны рисоваться без единого запроса (`error.md` §4, `offline.md` §4) — иначе шапка упадёт
 * вместе с тем, что уже сломалось.
 */
export const usePublicNavigation = (options: { enabled?: boolean } = {}) => {
  const enabled = options.enabled ?? true
  const sections = ref<PublicNavigationSection[]>([])
  const popularTags = ref<PublicNavigationTag[]>([])
  const status = ref<"idle" | "pending" | "success" | "error">("idle")

  const { locale } = useI18n()

  const load = async () => {
    status.value = "pending"
    try {
      const result = await useGraphQL(GET_NAVIGATION, { locale: locale.value === "en" ? "en" : "ru" })
      if (result.errors?.length || !result.data) throw new Error("Navigation GraphQL request failed")

      sections.value = result.data.publicSections
      popularTags.value = result.data.popularTags
      status.value = "success"
    } catch {
      sections.value = []
      popularTags.value = []
      status.value = "error"
    }
  }

  onMounted(() => {
    if (enabled) load()
  })

  return {
    sections: readonly(sections),
    popularTags: readonly(popularTags),
    status: readonly(status),
    refresh: load
  }
}
