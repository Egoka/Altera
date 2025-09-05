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
  <article v-if="slug && article.title">
    <NuxtLink :to="slug" class="flex group space-x-3">
      <div>
        <span
          :class="[
            'min-w-14 w-6',
            'mt-1 flex-shrink-0',
            'font-waterway text-5xl md:text-4xl font-bold text-right',
            'text-zinc-400 dark:text-zinc-400 group-hover:text-zinc-600 group-hover:dark:text-zinc-300',
            'transition-colors duration-500'
          ]">
          {{ (index ?? 0) + 1 }}.
        </span>
      </div>
      <div class="flex-1 min-w-0">
        <h3
          class="font-garamond-libre text-xl lg:text-xl font-medium text-zinc-900 dark:text-zinc-300 transition-colors leading-tight line-clamp-2">
          {{ article.title }}
        </h3>
        <ShowAuthor :link="author" :name="article.author.name" />
      </div>
    </NuxtLink>
  </article>
</template>

<style scoped></style>
