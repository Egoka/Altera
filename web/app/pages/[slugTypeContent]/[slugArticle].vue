<script setup lang="ts">
  import { GET_ARTICLE, GET_GONE_ARTICLE } from "~/query"
  import { getArticleRouteState, getGoneArticleRouteState } from "~/utils/articleRouteVisibility"

  definePageMeta({
    layout: "default"
  })

  const route = useRoute()
  const slugArticle = computed(() => String(route.params.slugArticle ?? ""))
  const sectionSlug = computed(() => String(route.params.slugTypeContent ?? ""))
  const localePath = useLocalePath()
  const { locale, t } = useI18n()

  // `fatal: true` нужен клиентскому переходу: без него отказ API на уже открытом сайте не
  // показывает ни 404, ни 500, и читатель остаётся на прежней странице. `error.md` §3 обещает
  // страницу 500 на любом маршруте при `INTERNAL_ERROR`, `not-found.md` §3 — 404 по месту адреса.
  const throwRouteError = (routeError: { statusCode: 404 | 500; code: string; requestId?: string }) => {
    throw createError({
      statusCode: routeError.statusCode,
      statusMessage: routeError.code,
      fatal: true,
      data: routeError.requestId ? { requestId: routeError.requestId } : undefined
    })
  }

  const { data: routeState, error: requestError } = await useAsyncData(
    () => `article-route:${locale.value}:${sectionSlug.value}:${slugArticle.value}`,
    async () => {
      const goneResult = await useGraphQL(GET_GONE_ARTICLE, {
        locale: locale.value === "en" ? "en" : "ru",
        sectionSlug: sectionSlug.value,
        slug: slugArticle.value
      })
      const goneState = getGoneArticleRouteState(goneResult)
      if (goneState.kind === "visible") {
        return { kind: "gone" as const, statusCode: 410 as const, goneArticle: goneState.article }
      }
      if (goneState.statusCode !== 404) throwRouteError(goneState)

      const articleResult = await useGraphQL(GET_ARTICLE, { slug: slugArticle.value })
      const articleState = getArticleRouteState(articleResult)
      if (articleState.kind === "error") throwRouteError(articleState)
      return { ...articleState, goneArticle: null }
    }
  )

  if (requestError.value) throw requestError.value

  const state = computed(() => routeState.value!)

  if (state.value.kind === "gone") {
    const event = useRequestEvent()
    if (event) setResponseStatus(event, 410)
    useSeoMeta({ robots: "noindex, nofollow" })
  }

  const article = computed(() => (state.value.kind === "visible" ? state.value.article : null))
  const goneArticle = computed(() => (state.value.kind === "gone" ? state.value.goneArticle : null))

  if (state.value.kind === "gone") {
    useSeoMeta({
      title: () => `${goneArticle.value?.title ?? t("article.goneTitle")} — ${t("article.goneTitle")} — Altera`
    })
  }

  const formattedFirstPublishedAt = computed(() => {
    if (!goneArticle.value?.firstPublishedAt) return null
    return new Intl.DateTimeFormat(locale.value, { timeZone: "UTC" }).format(
      new Date(goneArticle.value.firstPublishedAt)
    )
  })
</script>

<template>
  <section v-if="state.kind === 'gone'" class="mx-auto max-w-3xl py-24 text-center" aria-labelledby="gone-title">
    <p class="font-sans text-sm font-bold tracking-widest text-zinc-500">410</p>
    <h1 id="gone-title" class="mt-4 font-serif text-4xl font-semibold">{{ t("article.goneTitle") }}</h1>
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
  <div v-else-if="article">
    <HeaderTag :tag="{ name: article.title }" />
    <div class="mx-auto flex max-w-3xl justify-end px-4 py-6">
      <ReadingArticleBookmark :article-id="article.id" :login-path="`/login?next=${route.fullPath}`" />
    </div>
  </div>
</template>

<style scoped></style>
