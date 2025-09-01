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
  <article>
    <figure class="mb-2">
      <NuxtLink :to="slug" class="block group">
        <NuxtImg
          :src="article.featuredImage"
          :alt="article.title"
          class="w-full h-52 object-cover rounded-sm transition-transform duration-300" />
      </NuxtLink>
      <figcaption class="text-xs text-gray-500 dark:text-gray-400 font-light mt-2">
        <NuxtLink :to="contentType" class="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
          {{ article.contentType.name }}
        </NuxtLink>
      </figcaption>
    </figure>

    <div>
      <NuxtLink
        :to="slug"
        class="font-garamond-libre text-lg sm:text-xl font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors leading-1">
        {{ article.title }}
      </NuxtLink>
      <div>
        <NuxtLink
          :to="author"
          class="font-waterway text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 uppercase tracking-wide">
          {{ article.author.name }}
        </NuxtLink>
      </div>
    </div>
  </article>
</template>

<style scoped></style>
