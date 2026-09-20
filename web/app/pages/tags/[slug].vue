<script setup lang="ts">
  import { GET_TAG_FEED } from "~/query"
  import { toReadingArticle } from "~/utils/homeFeed"
  import {
    errorRequestId,
    pageParam,
    requestLocale,
    rethrowNotFound,
    throwOnFeedError,
    withQuery
  } from "~/utils/publicFeed"

  /**
   * Лента тега (`docs/spec/20-public/tag-feed.md`): ровный каталог равных карточек.
   * Тег сводит материалы разных рубрик, и между собой они равны, поэтому иерархии в
   * сетке нет, а служебная строка называет автора и рубрику.
   *
   * Панель ленты и «похожие теги» владелец оставил на отдельные заходы (§12), поэтому
   * страница ограничивается шапкой, каталогом и пагинацией.
   */
  definePageMeta({ layout: "default" })

  const route = useRoute()
  const { locale, t } = useI18n()

  const slug = computed(() => String(route.params.slug ?? ""))
  const page = computed(() => pageParam(route.query.page))

  const {
    data: feed,
    error,
    status
  } = await useAsyncData(
    () => `tag-feed:${locale.value}:${slug.value}:${page.value}`,
    async () =>
      throwOnFeedError(
        await useGraphQL(GET_TAG_FEED, {
          locale: requestLocale(locale.value),
          slug: slug.value,
          page: page.value
        })
      ).feed,
    { watch: [locale, slug, page] }
  )

  /** Слитый тег и прежний слаг ведут на целевой тег (ADR-0004, `admin-sections.md` #3). */
  // Неизвестный и архивированный тег — 404 страницы #21 (`tag-feed.md` §8).
  rethrowNotFound(error.value)

  const followRedirect = (value: typeof feed.value) =>
    value?.redirect ? navigateTo(`/tags/${value.redirect.slug}`, { redirectCode: 301, replace: true }) : undefined

  // На сервере переход выполняется до рендера — ответом становится сам 301.
  await followRedirect(feed.value)
  watch(feed, followRedirect)

  const tag = computed(() => feed.value?.tag ?? null)
  const articles = computed(() => (feed.value?.items ?? []).map(toReadingArticle))
  const pageInfo = computed(() => feed.value?.pageInfo ?? null)
  const requestId = computed(() => errorRequestId(error.value))

  useHead(() => ({ title: tag.value?.name }))
</script>

<template>
  <ReadingErrorState v-if="error" :request-id="requestId" />

  <div v-else-if="tag">
    <HeaderTag :tag="tag" />

    <ReadingLoadingSkeleton v-if="status === 'pending'" :cards="6" class="py-12" />

    <section v-else-if="articles.length" class="pt-12 pb-4">
      <ArticleCatalog :articles="articles" :meta="['author', 'type']" />
    </section>

    <!-- Пусто в локали: материалы другого языка не подмешиваются (журнал §20.5). -->
    <ReadingEmptyState
      v-else
      class="my-12"
      :title="t('tagFeed.emptyTitle')"
      :description="t('tagFeed.emptyDescription')"
      :action-label="t('tagFeed.emptyAction')"
      action-to="/tags" />

    <ReadingPagination
      v-if="pageInfo"
      :page="pageInfo.page"
      :total-pages="pageInfo.totalPages"
      :label="t('tagFeed.pagination')"
      :to="(value) => withQuery(`/tags/${slug}`, { page: value })" />
  </div>

  <ReadingLoadingSkeleton v-else :cards="6" class="py-12" />
</template>
