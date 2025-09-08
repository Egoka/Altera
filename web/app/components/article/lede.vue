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
  <article class="lede-article flex flex-col gap-6">
    <figure class="">
      <NuxtLink :to="slug" class="block group">
        <NuxtImg
          :src="article.featuredImage"
          :alt="article.title"
          class="w-full h-64 sm:h-80 md:h-96 lg:h-[350px] object-cover rounded-sm transition-transform duration-300" />
      </NuxtLink>
    </figure>

    <div class="text-center">
      <NuxtLink
        :to="slug"
        class="font-garamond-libre text-2xl sm:text-3xl md:text-4xl font-bold text-zinc-900 dark:text-zinc-300 transition-colors leading-tight">
        {{ article.title }}
      </NuxtLink>
    </div>

    <p
      class="lede-dek font-garamond-libre text-lg sm:text-xl text-zinc-700 dark:text-zinc-300 text-center leading-normal max-w-3xl mx-auto">
      {{ article.dek }}
    </p>

    <div class="text-center">
      <ShowAuthor :link="author" :name="article.author.name" class="block" />
      <ShowType :link="contentType" :name="article.contentType.name" class="block mt-1" />
    </div>
  </article>
</template>

<style scoped></style>
