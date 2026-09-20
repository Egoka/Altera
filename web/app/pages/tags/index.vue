<script setup lang="ts">
  import type { FeedControlGroup } from "~/types/reading"
  import { GET_TAG_CATALOG } from "~/query"
  import {
    errorRequestId,
    pageParam,
    requestLocale,
    stringParam,
    throwOnFeedError,
    withQuery
  } from "~/utils/publicFeed"

  /**
   * Список тегов (`docs/spec/20-public/tags-index.md`): облако популярных, поиск по началу
   * слова, алфавитный указатель, сортировка и пагинация. Теги — свободные слова авторов
   * (ADR-0005), поэтому список длинный; порога по числу материалов нет (журнал §20.10).
   */
  definePageMeta({ layout: "default" })

  const route = useRoute()
  const router = useRouter()
  const { locale, t } = useI18n()

  const page = computed(() => pageParam(route.query.page))
  const letter = computed(() => stringParam(route.query.letter))
  const sort = computed(() => (route.query.sort === "name" ? "name" : "popular"))
  const query = computed(() => stringParam(route.query.q))

  const {
    data: catalog,
    error,
    status
  } = await useAsyncData(
    () => `tag-catalog:${locale.value}:${query.value}:${letter.value}:${sort.value}:${page.value}`,
    async () =>
      throwOnFeedError(
        await useGraphQL(GET_TAG_CATALOG, {
          locale: requestLocale(locale.value),
          q: query.value,
          letter: letter.value,
          sort: sort.value,
          page: page.value
        })
      ),
    { watch: [locale, query, letter, sort, page] }
  )

  const requestId = computed(() => errorRequestId(error.value))
  const tags = computed(() => catalog.value?.tagCatalog.items ?? [])
  const pageInfo = computed(() => catalog.value?.tagCatalog.pageInfo ?? null)
  const letters = computed(() => catalog.value?.tagCatalog.letters ?? [])

  const pathTo = (params: { q?: string | null; letter?: string | null; sort?: string; page?: number }) =>
    withQuery("/tags", {
      q: params.q === undefined ? query.value : params.q,
      letter: params.letter === undefined ? letter.value : params.letter,
      sort: (params.sort ?? sort.value) === "popular" ? null : (params.sort ?? sort.value),
      page: params.page ?? 1
    })

  /**
   * Поиск фильтрует по вводу с задержкой и пишет запрос в адрес: строка поиска —
   * состояние страницы, её должно быть видно в URL и можно переслать.
   */
  const search = ref(query.value ?? "")
  watch(query, (value) => {
    search.value = value ?? ""
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const SEARCH_DELAY_MS = 300
  const MIN_QUERY_LENGTH = 2
  watch(search, (value) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const trimmed = value.trim()
      // Один знак фильтром ещё не является: короче двух не отправляем (§3).
      const next = trimmed.length >= MIN_QUERY_LENGTH ? trimmed : null
      if (next === query.value) return
      router.replace(pathTo({ q: next }))
    }, SEARCH_DELAY_MS)
  })
  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
  })

  const controlGroups = computed<FeedControlGroup[]>(() => [
    {
      label: t("tagsIndex.sort"),
      options: [
        { slug: "popular", name: t("tagsIndex.sortPopular") },
        { slug: "name", name: t("tagsIndex.sortName") }
      ],
      active: sort.value,
      to: (value) => pathTo({ sort: value ?? "popular" })
    },
    ...(letters.value.length
      ? [
          {
            label: t("tagsIndex.letters"),
            options: letters.value.map((value) => ({ slug: value, name: value })),
            active: letter.value,
            to: (value: string | null) => pathTo({ letter: value })
          }
        ]
      : [])
  ])

  useHead(() => ({ title: t("tagsIndex.title") }))
</script>

<template>
  <div class="pb-16">
    <ReadingPageHeader
      :title="t('tagsIndex.title')"
      :count="pageInfo ? t('tagsIndex.count', { count: pageInfo.totalCount }) : undefined" />

    <ReadingErrorState v-if="error" :request-id="requestId" />

    <template v-else>
      <!-- Облако популярных остаётся на месте, пока список перезагружается. -->
      <section v-if="catalog?.popularTags.length" class="pb-8">
        <h2 class="mb-4 font-sans text-xs font-bold uppercase text-zinc-500 dark:text-zinc-500">
          {{ t("tagsIndex.popular") }}
        </h2>
        <ReadingTagChips :tags="catalog.popularTags" sized />
      </section>

      <div class="border-y border-zinc-200 py-6 dark:border-zinc-800">
        <Input
          v-model="search"
          mode="underlined"
          class="ring-0 border-0 bg-transparent dark:bg-transparent"
          class-input="!font-garamond-libre text-zinc-600 text-2xl h-max"
          :placeholder="t('tagsIndex.searchPlaceholder')" />
      </div>

      <ReadingFeedControls :groups="controlGroups" />

      <ReadingLoadingSkeleton v-if="status === 'pending'" :cards="6" class="py-12" />

      <section v-else-if="tags.length" class="py-10">
        <ReadingTagList :tags="tags" :grouped="sort === 'name'" />
      </section>

      <ReadingEmptyState
        v-else
        class="my-12"
        :title="query || letter ? t('tagsIndex.emptyQueryTitle') : t('tagsIndex.emptyTitle')"
        :action-label="query || letter ? t('tagsIndex.reset') : undefined"
        :action-to="query || letter ? '/tags' : undefined" />

      <ReadingPagination
        v-if="pageInfo"
        :page="pageInfo.page"
        :total-pages="pageInfo.totalPages"
        :label="t('tagsIndex.pagination')"
        :to="(value) => pathTo({ page: value })" />
    </template>
  </div>
</template>
