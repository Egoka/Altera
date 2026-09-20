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

export const usePublicNavigation = () => {
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

  onMounted(load)

  return {
    sections: readonly(sections),
    popularTags: readonly(popularTags),
    status: readonly(status),
    refresh: load
  }
}
