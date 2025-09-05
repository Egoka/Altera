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
  <article v-if="slug && article.title">
    <div class="flex flex-row gap-6 items-start">
      <div class="h-20 max-h-24 flex flex-col flex-1 min-w-0">
        <div class="mb-2 leading-4">
          <NuxtLink
            :to="slug"
            class="font-garamond-libre text-md font-medium text-zinc-900 dark:text-zinc-300 transition-colors mb-5">
            {{ article.title }}
          </NuxtLink>
        </div>
        <div ref="bottomRef" class="mt-auto flex justify-start flex-wrap gap-x-5 flex-row items-start">
          <ShowAuthor :link="author" :name="article.author.name" class="block" />
          <ShowType :link="contentType" :name="article.contentType.name" class="block" />
        </div>
      </div>

      <!-- Изображение (правая сторона) -->
      <figure class="relative flex-shrink-0 flex flex-col items-end">
        <NuxtLink :to="slug" class="block group">
          <NuxtImg
            :src="article.featuredImage"
            :alt="article.title"
            class="max-w-28 w-28 h-20 rounded-sm object-cover transition-transform duration-300" />
        </NuxtLink>
      </figure>
    </div>
  </article>
</template>
