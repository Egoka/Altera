import type { ComputedRef, Ref } from "vue"
import { computed } from "vue"
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

export type PublicNavigationStatus = "idle" | "pending" | "success" | "error"

export interface PublicNavigation {
  sections: ComputedRef<readonly PublicNavigationSection[]>
  popularTags: ComputedRef<readonly PublicNavigationTag[]>
  status: Ref<PublicNavigationStatus> | ComputedRef<PublicNavigationStatus>
  refresh: () => Promise<void>
}

interface NavigationData {
  sections: PublicNavigationSection[]
  popularTags: PublicNavigationTag[]
}

const EMPTY: NavigationData = { sections: [], popularTags: [] }

/**
 * Рубрики и популярные теги шапки.
 *
 * Запрос идёт при отрисовке страницы, а не после монтирования: меню обязано присутствовать в
 * ответе SSR (`section-feed.md` §2) — без этого его не видит ни поисковая система, ни читатель
 * с выключенным JavaScript. Локаль входит и в ключ, и в аргумент запроса: рубрика публична
 * только там, где у неё есть материал этого языка (журнал §20.9).
 *
 * `enabled: false` оставляет меню пустым и не обращается к API: страница 500 и офлайн-страница
 * обязаны рисоваться без единого запроса (`error.md` §4, `offline.md` §4) — иначе шапка упадёт
 * вместе с тем, что уже сломалось.
 */
export const usePublicNavigation = async (options: { enabled?: boolean } = {}): Promise<PublicNavigation> => {
  if (options.enabled === false) {
    return {
      sections: computed(() => EMPTY.sections),
      popularTags: computed(() => EMPTY.popularTags),
      status: computed<PublicNavigationStatus>(() => "idle"),
      refresh: async () => {}
    }
  }

  const { locale } = useI18n()

  const { data, status, refresh } = await useAsyncData(
    () => `public-navigation:${locale.value}`,
    async () => {
      const result = await useGraphQL(GET_NAVIGATION, { locale: locale.value === "en" ? "en" : "ru" })
      if (result.errors?.length || !result.data) throw new Error("Navigation GraphQL request failed")

      return {
        sections: result.data.publicSections,
        popularTags: result.data.popularTags
      } satisfies NavigationData
    },
    // Отказ навигации не ломает страницу: шапка остаётся с пустым меню (`error.md` §4).
    { watch: [locale], default: () => EMPTY }
  )

  return {
    sections: computed(() => data.value?.sections ?? EMPTY.sections),
    popularTags: computed(() => data.value?.popularTags ?? EMPTY.popularTags),
    status: status as Ref<PublicNavigationStatus>,
    refresh: async () => {
      await refresh()
    }
  }
}
