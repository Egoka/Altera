<script setup lang="ts">
  import { GET_AUTHOR_PAGE } from "~/query"
  import { formatArticleMonth, formatPublishingSince } from "~/utils/articleDate"
  import { buildFeedGroups, groupByMonth } from "~/utils/feedGroups"
  import { AUTHOR_RHYTHM } from "~/utils/feedRhythm"
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
   * Страница автора (`docs/spec/20-public/author.md`): профиль без ПДн и хроника его
   * опубликованных материалов локали. Страница есть только у аккаунта с публикациями (§1):
   * неизвестный хэндл и аккаунт без них — 404, архивированный — 410 (§8, журнал §28.2),
   * прежний и записанный не в том регистре хэндл — 301 на канонический (§3).
   *
   * Подписка на автора и число подписчиков — этап 3 (F-10, §6), их здесь нет. Мета, canonical,
   * hreflang, Open Graph и JSON-LD (§10) ставит T-100 вместе с остальными публичными страницами.
   */
  definePageMeta({ layout: "default" })

  const route = useRoute()
  const { locale, t } = useI18n()
  const localePath = useLocalePath()
  const switchLocalePath = useSwitchLocalePath()

  const handle = computed(() => String(route.params.slug ?? ""))
  const page = computed(() => pageParam(route.query.page))

  const {
    data: authorPage,
    error,
    status
  } = await useAsyncData(
    () => `author-page:${locale.value}:${handle.value}:${page.value}`,
    async () =>
      throwOnFeedError(
        await useGraphQL(GET_AUTHOR_PAGE, {
          handle: handle.value,
          locale: requestLocale(locale.value),
          page: page.value
        })
      ),
    { watch: [locale, handle, page] }
  )

  // Неизвестный хэндл, аккаунт без публикаций и страница за последней — 404 страницы #21.
  rethrowNotFound(error.value)

  /**
   * Снятый с публикации профиль остаётся настоящим ответом 410: адрес был публичным, и
   * страница #22 объясняет, что его больше нет (журнал §28.2).
   */
  const isGone = computed(() => (error.value as { statusCode?: number } | null)?.statusCode === 410)
  if (isGone.value) {
    const event = useRequestEvent()
    if (event) setResponseStatus(event, 410)
    useSeoMeta({ robots: "noindex, nofollow" })
  }

  const author = computed(() => authorPage.value?.author ?? null)
  const feed = computed(() => authorPage.value?.feed ?? null)

  /**
   * Переезд адреса: прежний хэндл ведёт на нынешний (`routes.md` #7), а запись не в том
   * регистре — на канонический (§3). Оба случая отвечают 301, а не рисуют вторую копию
   * страницы по чужому адресу.
   */
  const canonicalHandle = (value: typeof authorPage.value) =>
    value?.author.redirect ??
    value?.feed.redirect?.slug ??
    (value && value.author.handle !== handle.value ? value.author.handle : null)

  const followRedirect = (value: typeof authorPage.value) => {
    const target = canonicalHandle(value)
    return target ? navigateTo(localePath(`/authors/${target}`), { redirectCode: 301, replace: true }) : undefined
  }

  // На сервере переход выполняется до рендера — ответом становится сам 301.
  await followRedirect(authorPage.value)
  watch(authorPage, followRedirect)

  const articles = computed(() => (feed.value?.items ?? []).map(toReadingArticle))
  const pageInfo = computed(() => feed.value?.pageInfo ?? null)
  const requestId = computed(() => errorRequestId(error.value))

  /**
   * Хроника: материалы делятся по месяцам публикации, каждый месяц собирается своим кругом
   * однорядных раскладок ритма автора, чтобы порядок чтения слева направо совпадал с
   * порядком по дате (§5 зона 4, решения владельца 2026-09-13).
   */
  const months = computed(() =>
    groupByMonth(articles.value, (article) => article.publishedAt ?? "").map((month) => ({
      key: month.key,
      label: formatArticleMonth(month.key, locale.value),
      groups: buildFeedGroups(month.items, AUTHOR_RHYTHM)
    }))
  )

  const sinceLabel = computed(() => {
    const month = formatPublishingSince(author.value?.firstPublishedAt ?? "", locale.value)
    return month ? t("authorPage.since", { month }) : null
  })

  /** Адрес страницы для листания — всегда канонический хэндл профиля. */
  const pagePath = computed(() => `/authors/${author.value?.handle ?? handle.value}`)

  // Пусто в локали: материалы другого языка не подмешиваются (журнал §20.5), поэтому
  // действие пустого состояния — переключатель языка, а не чужая лента.
  const otherLocalePath = computed(() => switchLocalePath(locale.value === "ru" ? "en" : "ru"))

  useHead(() => ({ title: author.value?.name }))
</script>

<template>
  <section v-if="isGone" class="mx-auto max-w-3xl py-24 text-center" aria-labelledby="author-gone-title">
    <p class="font-sans text-sm font-bold tracking-widest text-zinc-500">410</p>
    <h1 id="author-gone-title" class="mt-4 font-serif text-4xl font-semibold">{{ t("authorPage.goneTitle") }}</h1>
    <p class="mx-auto mt-4 max-w-xl text-zinc-600 dark:text-zinc-400">{{ t("authorPage.goneDescription") }}</p>
    <NuxtLink class="mt-6 inline-block underline underline-offset-4" :to="localePath('/authors')">
      {{ t("authorPage.goneAction") }}
    </NuxtLink>
  </section>

  <ReadingErrorState v-else-if="error" :request-id="requestId" />

  <div v-else-if="author" class="pb-16">
    <ReadingAuthorHeader
      :author="author"
      :since-label="sinceLabel"
      :count-label="t('authorPage.articleCount', { count: author.publishedCount })" />

    <!-- Панель ленты автора до запуска движка рейтинга — только подпись (журнал §20.4). -->
    <ReadingFeedControls :caption="t('authorPage.captionByDate')" :groups="[]" />

    <ReadingLoadingSkeleton v-if="status === 'pending'" :cards="6" class="py-12" />

    <template v-else-if="articles.length">
      <!-- Первый месяц без верхней линейки: его уже отделяет панель ленты. -->
      <section
        v-for="month in months"
        :key="month.key"
        class="mt-10 border-t border-zinc-200 pt-4 first:mt-6 first:border-0 first:pt-0 dark:border-zinc-800">
        <h2
          v-if="month.label"
          class="font-sans text-xs/6 font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
          {{ month.label }}
        </h2>
        <ArticleGroup
          v-for="group in month.groups"
          :key="group.id"
          :articles="group.articles"
          :layout="group.layout"
          :meta="['type', 'date']" />
      </section>
    </template>

    <ReadingEmptyState
      v-else
      class="my-12"
      :title="t('authorPage.emptyTitle')"
      :description="t('authorPage.emptyDescription')"
      :action-label="t('authorPage.emptyAction')"
      :action-to="otherLocalePath" />

    <ReadingPagination
      v-if="pageInfo"
      :page="pageInfo.page"
      :total-pages="pageInfo.totalPages"
      :label="t('authorPage.pagination')"
      :to="(value) => withQuery(pagePath, { page: value })" />
  </div>

  <ReadingLoadingSkeleton v-else :cards="6" class="py-12" />
</template>
