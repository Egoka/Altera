<script setup lang="ts">
  import type { PopularArticleData } from "~/types/article"
  const props = defineProps<{
    index: number
    article: PopularArticleData
  }>()
  const slug = computed(() => `/articles/${props.article.slug}`)
  const author = computed(() => `/authors/${props.article.author.slug}`)
</script>

<template>
  <article v-if="slug && article.title" class="flex space-x-3">
    <span
      class="min-w-14 font-waterway text-5xl md:text-4xl font-bold text-zinc-400 dark:text-zinc-400 w-6 text-right mt-1 flex-shrink-0">
      {{ (index ?? 0) + 1 }}.
    </span>
    <div class="flex-1 min-w-0">
      <NuxtLink :to="slug" class="block group">
        <h3
          class="font-garamond-libre text-xl lg:text-xl font-medium text-zinc-900 dark:text-zinc-300 transition-colors leading-tight line-clamp-2">
          {{ article.title }}
        </h3>
      </NuxtLink>
      <NuxtLink
        :to="author"
        class="font-waterway text-xs font-medium text-zinc-600 dark:text-zinc-400 uppercase tracking-widest transition-colors mt-1 inline-block">
        {{ article.author.name }}
      </NuxtLink>
    </div>
  </article>
</template>

<style scoped></style>
