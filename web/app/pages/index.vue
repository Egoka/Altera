<script setup lang="ts">
  import { GET_HOME_FEED } from "~/query"
  import { captionKey, homeSection, toHomeSections } from "~/utils/homeFeed"
  import { feedRequestId } from "~/utils/publicFeed"

  /**
   * Главная: три подборки из всех рубрик в порядке ответа `feed` (`home.md` §5, журнал §20.1).
   * Порядок и состав зон решает сервер — страница их только рисует.
   */
  const { locale, t } = useI18n()
  // Приглашение авторам ведёт в ту же локаль, что и главная (журнал §20.5).
  const localePath = useLocalePath()

  const {
    data: feed,
    error,
    status
  } = await useAsyncData(
    () => `home-feed:${locale.value}`,
    async () => {
      const result = await useGraphQL(GET_HOME_FEED, { locale: locale.value === "en" ? "en" : "ru" })
      // Отказ подборок не выносится в 500: страница сохраняет шапку и футер (`home.md` §8).
      if (result.errors?.length || !result.data) {
        throw createError({
          statusCode: 500,
          statusMessage: "INTERNAL_ERROR",
          fatal: false,
          data: { requestId: feedRequestId(result.errors) }
        })
      }
      return result.data.feed
    },
    { watch: [locale] }
  )

  const sections = computed(() => toHomeSections(feed.value))
  const top = computed(() => homeSection(sections.value, "top"))
  const fresh = computed(() => homeSection(sections.value, "new"))
  const popular = computed(() => homeSection(sections.value, "popular"))
  const captionOf = (caption?: string) => (caption ? t(caption) : undefined)
  const requestId = computed(() => {
    const data = (error.value as { data?: { requestId?: string } } | null)?.data
    return typeof data?.requestId === "string" ? data.requestId : undefined
  })

  /**
   * SEO главной (`home.md` §10): название издания и слоган — существующий текст подвала, без
   * отдельного дубля в словаре. `WebSite` без `SearchAction`: поиск — этап 3 (§2 зона 1), адреса
   * у него ещё нет.
   */
  const origin = useRequestURL().origin
  const siteDescription = computed(() => t("footer.description"))
  const siteTitle = computed(() => `Altera — ${siteDescription.value.replace(/\.\s*$/, "")}`)
  const canonicalUrl = computed(() => `${origin}${locale.value === "en" ? "/en" : "/"}`)

  useSeoMeta({
    title: () => siteTitle.value,
    description: () => siteDescription.value,
    ogTitle: () => siteTitle.value,
    ogDescription: () => siteDescription.value,
    ogType: "website",
    robots: "index, follow"
  })

  useHead({
    link: () => [
      { rel: "canonical", href: canonicalUrl.value },
      { rel: "alternate", hreflang: "ru-RU", href: `${origin}/` },
      { rel: "alternate", hreflang: "en-US", href: `${origin}/en` },
      { rel: "alternate", hreflang: "x-default", href: `${origin}/` }
    ],
    script: () => [
      {
        type: "application/ld+json",
        innerHTML: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Altera",
          url: canonicalUrl.value,
          description: siteDescription.value
        })
      },
      {
        type: "application/ld+json",
        innerHTML: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Altera",
          url: origin
        })
      }
    ]
  })
</script>

<template>
  <ReadingErrorState v-if="error" :request-id="requestId" />

  <!-- Клиентская навигация показывает скелеты по зонам; SSR отдаёт готовую страницу. -->
  <ReadingLoadingSkeleton v-else-if="status === 'pending'" :cards="5" />

  <template v-else-if="sections.length">
    <PagesStartFeatured
      v-if="top"
      :articles="top.articles"
      :caption="captionOf(captionKey(top.caption))"
      data-section="top" />
    <PagesStartLatest
      v-if="fresh"
      :articles="fresh.articles"
      :caption="captionOf(captionKey(fresh.caption))"
      data-section="new" />
    <PagesStartPopular
      v-if="popular"
      class="mb-12"
      :articles="popular.articles"
      :caption="captionOf(captionKey(popular.caption))"
      data-section="popular" />
  </template>

  <ReadingEmptyState
    v-else
    :title="t('home.emptyTitle')"
    :description="t('home.emptyDescription')"
    :action-label="t('home.emptyAction')"
    :action-to="localePath('/pricing')" />
</template>
