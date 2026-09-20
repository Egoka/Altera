<script setup lang="ts">
  import { GET_HOME_FEED } from "~/query"
  import { captionKey, feedRequestId, homeSection, toHomeSections } from "~/utils/homeFeed"

  /**
   * Главная: три подборки из всех рубрик в порядке ответа `feed` (`home.md` §5, журнал §20.1).
   * Порядок и состав зон решает сервер — страница их только рисует.
   */
  const { locale, t } = useI18n()

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

  useHead({ title: "Altera" })
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
    action-to="/pricing" />
</template>
