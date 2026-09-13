<script setup lang="ts">
  import type { ArticleResponse } from "~/types/article"

  const props = defineProps<{
    article: ArticleResponse
  }>()
  const slug = computed(() => `/${props.article.contentType.slug}/${props.article.slug}`)
  const contentType = computed(() => `/${props.article.contentType.slug}`)
  const author = computed(() => `/authors/${props.article.author.slug}`)
</script>

<template>
  <article class="lede-article flex flex-col">
    <figure class="mb-10">
      <NuxtLink :to="slug" class="block group">
        <NuxtImg
          :src="article.featuredImage"
          :alt="article.title"
          class="w-full aspect-2/1 object-cover rounded-sm transition-transform duration-300" />
      </NuxtLink>
    </figure>

    <div class="text-center">
      <NuxtLink
        :to="slug"
        class="font-garamond-libre text-title md:text-hero font-bold text-zinc-900 dark:text-zinc-300 transition-colors block max-w-4xl mx-auto">
        {{ article.title }}
      </NuxtLink>
    </div>

    <p
      class="lede-dek mt-1 font-garamond-libre text-card md:text-lede-dek font-normal text-zinc-600 dark:text-zinc-400 text-center max-w-3xl mx-auto line-clamp-2">
      {{ article.dek }}
    </p>

    <div class="mt-5 flex flex-row flex-wrap items-baseline justify-center gap-x-2 gap-y-1">
      <ShowAuthor :link="author" :name="article.author.name" />
      <span class="font-cormorant text-meta text-zinc-600 dark:text-zinc-400" aria-hidden="true">·</span>
      <ShowType :link="contentType" :name="article.contentType.name" />
    </div>
  </article>
</template>

<style scoped></style>
