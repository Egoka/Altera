<script setup lang="ts">
  import { GET_ARTICLE } from "~/query"
  import { getArticleRouteState } from "~/utils/articleRouteVisibility"

  definePageMeta({
    layout: "default"
  })

  const route = useRoute()
  const slugArticle = computed(() => String(route.params.slugArticle ?? ""))
  const localePath = useLocalePath()
  const { t } = useI18n()

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
</script>

<template>
  <section v-if="state.kind === 'gone'" class="mx-auto max-w-3xl py-24 text-center" aria-labelledby="gone-title">
    <p class="font-sans text-sm font-bold tracking-widest text-zinc-500">410</p>
    <h1 id="gone-title" class="mt-4 font-serif text-4xl font-semibold">{{ t("article.goneTitle") }}</h1>
    <p class="mx-auto mt-4 max-w-xl text-zinc-600 dark:text-zinc-400">{{ t("article.goneDescription") }}</p>
    <NuxtLink class="mt-8 inline-block underline underline-offset-4" :to="localePath('/')">
      {{ t("article.goneHome") }}
    </NuxtLink>
  </section>
  <div v-else-if="article">
    <HeaderTag :tag="{ name: article.title }" />
  </div>
</template>

<style scoped></style>
