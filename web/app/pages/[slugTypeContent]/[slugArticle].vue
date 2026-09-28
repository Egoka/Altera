<script setup lang="ts">
  import { GET_ARTICLE, GET_GONE_ARTICLE } from "~/query"
  import { getArticleRouteState, getGoneArticleRouteState } from "~/utils/articleRouteVisibility"

  definePageMeta({ layout: "default" })

  const route = useRoute()
  const slugArticle = computed(() => String(route.params.slugArticle ?? ""))
  const sectionSlug = computed(() => String(route.params.slugTypeContent ?? ""))
  const previewToken = computed(() => (typeof route.query?.preview === "string" ? route.query.preview : undefined))
  const localePath = useLocalePath()
  const { locale, t } = useI18n()

  // `fatal: true` нужен клиентскому переходу: иначе отказ API оставляет читателя на предыдущей
  // странице вместо предусмотренного публичным маршрутом экрана ошибки.
  const throwRouteError = (routeError: { statusCode: 403 | 404 | 500; code: string; requestId?: string }) => {
    throw createError({
      statusCode: routeError.statusCode,
      statusMessage: routeError.code,
      fatal: true,
      data: routeError.requestId ? { requestId: routeError.requestId } : undefined
    })
  }

  const { data: routeState, error: requestError } = await useAsyncData(
    () => `article-route:${locale.value}:${sectionSlug.value}:${slugArticle.value}:${previewToken.value ?? "public"}`,
    async () => {
      const variables = {
        locale: locale.value === "en" ? ("en" as const) : ("ru" as const),
        sectionSlug: sectionSlug.value,
        slug: slugArticle.value
      }
      const articleState = getArticleRouteState(
        await useGraphQL(GET_ARTICLE, { ...variables, preview: previewToken.value })
      )

      if (articleState.kind === "visible") return { ...articleState, goneArticle: null }
      if (articleState.kind === "error") throwRouteError(articleState)

      const goneState = getGoneArticleRouteState(await useGraphQL(GET_GONE_ARTICLE, variables))
      if (goneState.kind === "visible") {
        return { kind: "gone" as const, statusCode: 410 as const, goneArticle: goneState.article }
      }
      throwRouteError(goneState)
    }
  )

  if (requestError.value) throw requestError.value

  const state = computed(() => routeState.value!)
  const article = computed(() => (state.value.kind === "visible" ? state.value.article : null))
  const goneArticle = computed(() => (state.value.kind === "gone" ? state.value.goneArticle : null))

  const requestEvent = useRequestEvent()
  if (state.value.kind === "gone" && requestEvent) setResponseStatus(requestEvent, 410)
  if (article.value?.preview && requestEvent) setResponseHeader(requestEvent, "X-Robots-Tag", "noindex, nofollow")

  useSeoMeta({
    title: () => {
      if (goneArticle.value) return `${goneArticle.value.title} — ${t("article.goneTitle")} — Altera`
      return article.value ? `${article.value.title} — Altera` : "Altera"
    },
    description: () => article.value?.excerpt ?? article.value?.dek ?? undefined,
    robots: () => (state.value.kind === "gone" || article.value?.preview ? "noindex, nofollow" : undefined)
  })

  const formattedFirstPublishedAt = computed(() => {
    const value = goneArticle.value?.firstPublishedAt
    return value ? formatDate(value) : null
  })
  const publishedLabel = computed(() => {
    if (!article.value) return null
    const value = article.value.publishedAt ?? article.value.firstPublishedAt
    return value ? formatDate(value) : null
  })
  const updatedLabel = computed(() => {
    if (!article.value?.updatedAt || !article.value.publishedAt) return null
    return new Date(article.value.updatedAt).getTime() > new Date(article.value.publishedAt).getTime()
      ? formatDate(article.value.updatedAt)
      : null
  })
  const editPath = computed(() =>
    article.value?.preview && article.value.reeditUntil ? `/me/articles/${article.value.translationId}/edit` : null
  )

  function formatDate(value: string) {
    return new Intl.DateTimeFormat(locale.value, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }).format(new Date(value))
  }
</script>

<template>
  <section
    v-if="state.kind === 'gone'"
    class="mx-auto max-w-3xl px-5 py-24 text-center sm:px-8"
    aria-labelledby="gone-title">
    <p class="font-sans text-sm font-bold tracking-[0.2em] text-zinc-500">410</p>
    <h1 id="gone-title" class="mt-4 font-serif text-4xl font-semibold tracking-tight">
      {{ t("article.goneTitle") }}
    </h1>
    <h2 v-if="goneArticle" class="mt-6 font-serif text-3xl font-semibold">{{ goneArticle.title }}</h2>
    <p class="mx-auto mt-4 max-w-xl text-zinc-600 dark:text-zinc-400">{{ t("article.goneDescription") }}</p>
    <p v-if="formattedFirstPublishedAt" class="mt-4 text-sm text-zinc-500">
      {{ t("article.gonePublished") }} {{ formattedFirstPublishedAt }}
    </p>
    <nav v-if="goneArticle" class="mt-8 flex justify-center gap-6">
      <NuxtLink class="underline underline-offset-4" :to="localePath(`/authors/${goneArticle.author.handle}`)">
        {{ goneArticle.author.name }}
      </NuxtLink>
      <NuxtLink
        v-if="goneArticle.section"
        class="underline underline-offset-4"
        :to="localePath(`/${goneArticle.section.slug}`)">
        {{ goneArticle.section.name }}
      </NuxtLink>
    </nav>
    <NuxtLink class="mt-6 inline-block underline underline-offset-4" :to="localePath('/')">
      {{ t("article.goneHome") }}
    </NuxtLink>
  </section>

  <main v-else-if="article" class="pb-20">
    <ReadingPreviewBanner
      v-if="article.preview"
      :status="article.status"
      :reedit-until="article.reeditUntil"
      :edit-path="editPath" />

    <header class="mx-auto max-w-5xl px-5 pb-10 pt-16 sm:px-8 sm:pt-24">
      <div class="mx-auto max-w-3xl">
        <div class="flex flex-wrap items-center gap-3 font-sans text-xs font-semibold uppercase tracking-[0.2em]">
          <NuxtLink
            v-if="article.section"
            :to="localePath(`/${article.section.slug}`)"
            class="text-orange-800 hover:text-orange-600 dark:text-orange-300">
            {{ article.section.name }}
          </NuxtLink>
          <template v-if="article.format">
            <span class="text-zinc-300 dark:text-zinc-700" aria-hidden="true">/</span>
            <span class="text-zinc-500">{{ article.format.name }}</span>
          </template>
        </div>
        <h1
          class="mt-5 text-balance font-serif text-5xl/none font-semibold tracking-tight text-zinc-950 dark:text-white sm:text-7xl/none">
          {{ article.title }}
        </h1>
        <p
          v-if="article.dek"
          class="mt-7 max-w-2xl font-serif text-xl/8 text-zinc-600 dark:text-zinc-300 sm:text-2xl/9">
          {{ article.dek }}
        </p>

        <div
          class="mt-9 flex flex-col gap-5 border-t border-zinc-200 pt-5 font-sans text-sm dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-zinc-600 dark:text-zinc-400">
            <NuxtLink
              :to="localePath(`/authors/${article.author.slug}`)"
              class="font-semibold text-zinc-950 underline decoration-zinc-300 underline-offset-4 dark:text-white dark:decoration-zinc-700">
              {{ article.author.name }}
            </NuxtLink>
            <span aria-hidden="true">·</span>
            <span>{{ t("article.readingTime", { count: article.readingTime }) }}</span>
          </div>

          <div class="flex items-center gap-5">
            <NuxtLink
              v-if="article.sibling"
              :to="article.sibling.path"
              class="font-semibold text-zinc-700 underline decoration-zinc-300 underline-offset-4 hover:text-orange-800 dark:text-zinc-300 dark:decoration-zinc-700 dark:hover:text-orange-300">
              {{ article.sibling.locale === "en" ? t("article.language.en") : t("article.language.ru") }}
            </NuxtLink>
            <ReadingArticleBookmark
              :article-id="article.id"
              :login-path="`/login?next=${encodeURIComponent(route.path)}`" />
          </div>
        </div>
      </div>
    </header>

    <div v-if="article.cover" class="mx-auto mb-14 max-w-6xl px-5 sm:px-8">
      <MediaPicture
        :variants="article.cover.variants"
        :alt="article.cover.alt ?? ''"
        sizes="(min-width: 1280px) 1152px, 100vw"
        loading="eager"
        fetchpriority="high"
        img-class="block h-auto w-full bg-zinc-100 object-cover dark:bg-zinc-900" />
    </div>

    <ReadingArticleDocument :document="article.body" :assets="article.bodyAssets" />

    <footer class="mx-auto mt-10 max-w-3xl border-t border-zinc-200 px-5 pt-8 dark:border-zinc-800 sm:px-8">
      <div v-if="article.tags.length" class="flex flex-wrap gap-2" :aria-label="t('article.tags')">
        <NuxtLink
          v-for="tag in article.tags"
          :key="tag.slug"
          :to="localePath(`/tags/${tag.slug}`)"
          class="rounded-full border border-zinc-300 px-3 py-1 font-sans text-sm text-zinc-700 hover:border-orange-500 hover:text-orange-800 dark:border-zinc-700 dark:text-zinc-300">
          {{ tag.name }}
        </NuxtLink>
      </div>

      <p v-if="publishedLabel" class="mt-7 font-sans text-xs text-zinc-500">
        <span>
          {{
            t(article.isTranslation ? "article.translationPublished" : "article.published", { date: publishedLabel })
          }}
        </span>
        <span v-if="updatedLabel"> · {{ t("article.updated", { date: updatedLabel }) }}</span>
      </p>

      <aside v-if="article.author.bio" class="mt-10 border-l-2 border-orange-600 pl-5">
        <p class="font-sans text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
          {{ t("article.aboutAuthor") }}
        </p>
        <NuxtLink
          :to="localePath(`/authors/${article.author.slug}`)"
          class="mt-2 inline-block font-serif text-2xl font-semibold text-zinc-950 dark:text-white">
          {{ article.author.name }}
        </NuxtLink>
        <p class="mt-2 font-serif text-base/7 text-zinc-600 dark:text-zinc-400">{{ article.author.bio }}</p>
      </aside>
    </footer>
  </main>
</template>
