<script setup lang="ts">
  import type { FeedControlGroup } from "~/types/reading"
  import { GET_AUTHOR_CATALOG } from "~/query"
  import {
    errorRequestId,
    pageParam,
    requestLocale,
    rethrowNotFound,
    stringParam,
    throwOnFeedError,
    withQuery
  } from "~/utils/publicFeed"

  /**
   * Список авторов (`docs/spec/20-public/authors-index.md`): аккаунты с публикациями в
   * локали, до запуска рейтинга — по дате последней публикации (журнал §20.4, §20.8).
   * Истёкший план автора из каталога не убирает и в порядке не понижает; состояния плана
   * в публичном типе нет (ADR-0018). Подписка на автора — F-10, её здесь нет.
   */
  definePageMeta({ layout: "default" })

  const route = useRoute()
  const { locale, t } = useI18n()

  const page = computed(() => pageParam(route.query.page))
  const letter = computed(() => stringParam(route.query.letter))
  const section = computed(() => stringParam(route.query.section))
  const sort = computed(() => (route.query.sort === "name" ? "name" : "recent"))

  const {
    data: catalog,
    error,
    status
  } = await useAsyncData(
    () => `author-catalog:${locale.value}:${sort.value}:${section.value}:${letter.value}:${page.value}`,
    async () =>
      throwOnFeedError(
        await useGraphQL(GET_AUTHOR_CATALOG, {
          locale: requestLocale(locale.value),
          sort: sort.value,
          section: section.value,
          letter: letter.value,
          page: page.value
        })
      ),
    { watch: [locale, sort, section, letter, page] }
  )

  // Неверные параметры адреса — 404 (`authors-index.md` §8).
  rethrowNotFound(error.value)

  const requestId = computed(() => errorRequestId(error.value))
  const authors = computed(() => catalog.value?.authorCatalog.items ?? [])
  const pageInfo = computed(() => catalog.value?.authorCatalog.pageInfo ?? null)
  const letters = computed(() => catalog.value?.authorCatalog.letters ?? [])
  const filtered = computed(() => Boolean(section.value || letter.value))

  const pathTo = (params: { sort?: string; section?: string | null; letter?: string | null; page?: number }) =>
    withQuery("/authors", {
      sort: (params.sort ?? sort.value) === "recent" ? null : (params.sort ?? sort.value),
      section: params.section === undefined ? section.value : params.section,
      letter: params.letter === undefined ? letter.value : params.letter,
      page: params.page ?? 1
    })

  const controlGroups = computed<FeedControlGroup[]>(() => [
    {
      label: t("authorsIndex.sort"),
      options: [
        { slug: "recent", name: t("authorsIndex.sortRecent") },
        { slug: "name", name: t("authorsIndex.sortName") }
      ],
      active: sort.value,
      to: (value) => pathTo({ sort: value ?? "recent" })
    },
    ...(catalog.value?.sectionCatalog.length
      ? [
          {
            label: t("authorsIndex.filterSection"),
            options: catalog.value.sectionCatalog,
            active: section.value,
            to: (value: string | null) => pathTo({ section: value })
          }
        ]
      : []),
    ...(letters.value.length
      ? [
          {
            label: t("authorsIndex.letters"),
            options: letters.value.map((value) => ({ slug: value, name: value })),
            active: letter.value,
            to: (value: string | null) => pathTo({ letter: value })
          }
        ]
      : [])
  ])

  useHead(() => ({ title: t("authorsIndex.title") }))
</script>

<template>
  <div class="pb-16">
    <ReadingPageHeader
      :title="t('authorsIndex.title')"
      :count="pageInfo ? t('authorsIndex.count', { count: pageInfo.totalCount }) : undefined"
      :caption="sort === 'name' ? t('authorsIndex.captionName') : t('authorsIndex.captionRecent')"
      :action-label="t('authorsIndex.becomeAuthor')"
      action-to="/pricing" />

    <ReadingErrorState v-if="error" :request-id="requestId" />

    <template v-else>
      <ReadingFeedControls
        :groups="controlGroups"
        :reset-label="filtered ? t('authorsIndex.reset') : undefined"
        :reset-to="filtered ? '/authors' : undefined" />

      <ReadingLoadingSkeleton v-if="status === 'pending'" :cards="6" class="py-12" />

      <div v-else-if="authors.length" class="grid grid-cols-1 gap-x-12 gap-y-14 py-10 md:grid-cols-2 lg:grid-cols-3">
        <ReadingAuthorCard
          v-for="author in authors"
          :key="author.handle"
          :author="author"
          :count-label="t('authorsIndex.articleCount', { count: author.publishedCount })" />
      </div>

      <ReadingEmptyState
        v-else
        class="my-12"
        :title="filtered ? t('authorsIndex.emptyFilterTitle') : t('authorsIndex.emptyTitle')"
        :description="filtered ? undefined : t('authorsIndex.emptyDescription')"
        :action-label="filtered ? t('authorsIndex.reset') : t('authorsIndex.becomeAuthor')"
        :action-to="filtered ? '/authors' : '/pricing'" />

      <ReadingPagination
        v-if="pageInfo"
        :page="pageInfo.page"
        :total-pages="pageInfo.totalPages"
        :label="t('authorsIndex.pagination')"
        :to="(value) => pathTo({ page: value })" />
    </template>
  </div>
</template>
