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

  const { data: envelope, error: requestError } = await useAsyncData(
    () => `article-route:${slugArticle.value}`,
    () => useGraphQL(GET_ARTICLE, { slug: slugArticle.value })
  )

  if (requestError.value) {
    throw createError({ statusCode: 500, statusMessage: "Internal server error" })
  }

  const state = computed(() => getArticleRouteState(envelope.value ?? {}))
  if (state.value.kind === "error") {
    throw createError({
      statusCode: state.value.statusCode,
      statusMessage: state.value.code,
      data: state.value.requestId ? { requestId: state.value.requestId } : undefined
    })
  }

  if (state.value.kind === "gone") {
    const event = useRequestEvent()
    if (event) setResponseStatus(event, 410)
    useSeoMeta({ robots: "noindex, nofollow" })
  }

  const article = computed(() => (state.value.kind === "visible" ? state.value.article : null))
  const goneArticle = ref<Awaited<ReturnType<typeof loadGoneArticle>>>(null)

  async function loadGoneArticle() {
    if (state.value.kind !== "gone") return null
    const result = await useGraphQL(GET_GONE_ARTICLE, {
      locale: locale.value === "en" ? "en" : "ru",
      sectionSlug: sectionSlug.value,
      slug: slugArticle.value
    })
    const goneState = getGoneArticleRouteState(result)
    if (goneState.kind === "error") {
      throw createError({
        statusCode: goneState.statusCode,
        statusMessage: goneState.code,
        data: goneState.requestId ? { requestId: goneState.requestId } : undefined
      })
    }
    return goneState.article
  }

  if (state.value.kind === "gone") {
    const { data: goneData, error: goneError } = await useAsyncData(
      () => `gone-article:${locale.value}:${sectionSlug.value}:${slugArticle.value}`,
      loadGoneArticle
    )
    if (goneError.value) throw goneError.value
    goneArticle.value = goneData.value ?? null
    useSeoMeta({ title: () => goneArticle.value?.title ?? t("article.goneTitle") })
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
  </div>
</template>

<style scoped></style>
