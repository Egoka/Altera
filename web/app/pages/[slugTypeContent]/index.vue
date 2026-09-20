<script setup lang="ts">
  import type { FeedControlGroup } from "~/types/reading"
  import { GET_SECTION_FEED } from "~/query"
  import { buildFeedGroups } from "~/utils/feedGroups"
  import { SECTION_RHYTHM } from "~/utils/feedRhythm"
  import { toReadingArticle } from "~/utils/homeFeed"
  import {
    errorRequestId,
    pageParam,
    requestLocale,
    stringParam,
    throwOnFeedError,
    withQuery
  } from "~/utils/publicFeed"

  /**
   * Лента рубрики (`docs/spec/20-public/section-feed.md`): шапка рубрики, панель фильтров,
   * группы реестра раскладок по ритму рубрики, пагинация и ряд других рубрик.
   *
   * Пустой рубрики не бывает — она не публична до первой публикации (журнал §20.9), поэтому
   * пустое состояние здесь означает только «фильтр ничего не нашёл».
   */
  definePageMeta({ layout: "default" })

  const route = useRoute()
  const { locale, t } = useI18n()

  const slug = computed(() => String(route.params.slugTypeContent ?? ""))
  const page = computed(() => pageParam(route.query.page))
  const format = computed(() => stringParam(route.query.format))
  const tag = computed(() => stringParam(route.query.tag))

  const {
    data: feed,
    error,
    status
  } = await useAsyncData(
    () => `section-feed:${locale.value}:${slug.value}:${page.value}:${format.value}:${tag.value}`,
    async () =>
      throwOnFeedError(
        await useGraphQL(GET_SECTION_FEED, {
          locale: requestLocale(locale.value),
          slug: slug.value,
          page: page.value,
          format: format.value,
          tag: tag.value
        })
      ).feed,
    { watch: [locale, slug, page, format, tag] }
  )

  /**
   * Архивированная рубрика и прежний слаг ведут на нынешний адрес (ADR-0004,
   * `admin-sections.md` #2). Фильтры и страница в преемника не переносятся: у другой
   * рубрики другие форматы и теги, и сохранённый срез показал бы не то, что обещает.
   */
  const followRedirect = (value: typeof feed.value) =>
    value?.redirect ? navigateTo(`/${value.redirect.slug}`, { redirectCode: 301, replace: true }) : undefined

  // На сервере переход выполняется до рендера — ответом становится сам 301; watch
  // повторяет его при клиентской навигации на другой слаг.
  await followRedirect(feed.value)
  watch(feed, followRedirect)

  const section = computed(() => feed.value?.section ?? null)
  const articles = computed(() => (feed.value?.items ?? []).map(toReadingArticle))
  const groups = computed(() => buildFeedGroups(articles.value, SECTION_RHYTHM))
  const pageInfo = computed(() => feed.value?.pageInfo ?? null)
  const filtered = computed(() => Boolean(format.value || tag.value))
  const requestId = computed(() => errorRequestId(error.value))

  const pathTo = (params: { format?: string | null; tag?: string | null; page?: number }) =>
    withQuery(`/${slug.value}`, {
      format: params.format === undefined ? format.value : params.format,
      tag: params.tag === undefined ? tag.value : params.tag,
      page: params.page ?? 1
    })

  /** Выбор фильтра всегда сбрасывает страницу на первую: номер из другого среза бессмыслен. */
  const controlGroups = computed<FeedControlGroup[]>(() => {
    const groupsOfFilters: FeedControlGroup[] = []
    const formats = feed.value?.formats ?? []
    const topTags = feed.value?.topTags ?? []
    if (formats.length) {
      groupsOfFilters.push({
        label: t("sectionFeed.filterFormat"),
        options: formats,
        active: format.value,
        to: (value) => pathTo({ format: value })
      })
    }
    if (topTags.length) {
      groupsOfFilters.push({
        label: t("sectionFeed.filterTag"),
        options: topTags,
        active: tag.value,
        to: (value) => pathTo({ tag: value })
      })
    }
    return groupsOfFilters
  })

  useHead(() => ({ title: section.value?.name }))
</script>

<template>
  <ReadingErrorState v-if="error" :request-id="requestId" />

  <div v-else-if="section">
    <HeaderType :section="section" :count-label="t('sectionFeed.articleCount', { count: section.articleCount })" />

    <ReadingFeedControls
      v-if="controlGroups.length"
      :caption="t('home.captionByDate')"
      :groups="controlGroups"
      :reset-label="filtered ? t('sectionFeed.reset') : undefined"
      :reset-to="filtered ? `/${slug}` : undefined" />

    <ReadingLoadingSkeleton v-if="status === 'pending'" :cards="6" class="py-12" />

    <!-- Список рубрики — группы реестра раскладок во всю ширину контейнера, служебная
         строка карточек показывает дату: рубрика и так в шапке. -->
    <section v-else-if="articles.length" class="pt-4 pb-4">
      <ArticleGroup
        v-for="group in groups"
        :key="group.id"
        :articles="group.articles"
        :layout="group.layout"
        :meta="['author', 'date']" />
    </section>

    <ReadingEmptyState
      v-else
      class="my-12"
      :title="t('sectionFeed.emptyTitle')"
      :description="t('sectionFeed.emptyDescription')"
      :action-label="t('sectionFeed.reset')"
      :action-to="`/${slug}`" />

    <ReadingPagination
      v-if="pageInfo"
      :page="pageInfo.page"
      :total-pages="pageInfo.totalPages"
      :label="t('sectionFeed.pagination')"
      :to="(value) => pathTo({ page: value })" />

    <!-- Зона «другие рубрики»: непустые рубрики локали со счётчиками. -->
    <section v-if="feed?.otherSections.length" class="border-t border-zinc-200 py-8 dark:border-zinc-800">
      <h2 class="font-sans text-xs font-bold uppercase text-zinc-500 dark:text-zinc-500">
        {{ t("sectionFeed.otherSections") }}
      </h2>
      <div class="mt-4 flex gap-x-8 gap-y-3 overflow-x-auto md:flex-wrap md:overflow-visible">
        <NuxtLink
          v-for="other in feed.otherSections"
          :key="other.slug"
          :to="`/${other.slug}`"
          class="shrink-0 font-garamond-libre text-lg text-zinc-700 transition-colors duration-300 hover:text-red-700 dark:text-zinc-300 dark:hover:text-red-400">
          {{ other.name }}
          <span class="font-sans text-xs text-zinc-500">{{ other.count }}</span>
        </NuxtLink>
      </div>
    </section>
  </div>

  <ReadingLoadingSkeleton v-else :cards="6" class="py-12" />
</template>
