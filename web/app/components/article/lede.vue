<script setup lang="ts">
  import type { ArticleResponse } from "~/types/article"

  const props = defineProps<{
    article: ArticleResponse
  }>()
  const slug = computed(() => `/articles/${props.article.slug}`)
  const contentType = computed(() => `/types/${props.article.contentType.slug}`)
  const author = computed(() => `/authors/${props.article.author.slug}`)
</script>

<template>
  <article class="lede-article">
    <figure class="lede-figure mb-8">
      <NuxtLink :to="slug" class="block group">
        <NuxtImg
          :src="article.featuredImage"
          :alt="article.title"
          class="w-full h-64 sm:h-80 md:h-96 lg:h-[350px] object-cover rounded-md transition-transform duration-300" />
      </NuxtLink>
      <figcaption class="text-sm text-gray-500 dark:text-gray-400 font-light mt-3">
        <NuxtLink :to="contentType" class="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
          {{ article.contentType.name }}
        </NuxtLink>
      </figcaption>
    </figure>

    <div class="lede-title mb-6 text-center">
      <NuxtLink
        :to="slug"
        class="font-garamond-libre text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors leading-normal">
        {{ article.title }}
      </NuxtLink>
    </div>

    <p
      class="lede-dek font-garamond-libre text-lg sm:text-xl text-gray-700 dark:text-gray-300 mb-6 text-center leading-normal max-w-3xl mx-auto">
      {{ article.dek }}
    </p>

    <div class="homepage-metadata text-center">
      <div class="byline">
        <NuxtLink
          :to="author"
          class="font-waterway text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 uppercase tracking-wider">
          {{ article.author.name }}
        </NuxtLink>
      </div>
    </div>
  </article>
</template>

<style scoped></style>
