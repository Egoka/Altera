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
    </figure>

    <div>
      <NuxtLink
        :to="slug"
        class="font-garamond-libre text-lg sm:text-xl font-medium text-zinc-900 dark:text-zinc-300 leading-1">
        {{ article.title }}
      </NuxtLink>
      <div ref="bottomRef" class="mt-3 flex justify-between flex-wrap gap-x-3 flex-row items-start">
        <ShowAuthor :link="author" :name="article.author.name" class="block" />
        <ShowType :link="contentType" :name="article.contentType.name" class="block" />
      </div>
    </div>
  </article>
</template>

<style scoped></style>
