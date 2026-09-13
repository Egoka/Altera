<script setup lang="ts">
  import type { ArticleResponse } from "~/types/article"
  import type { CardMeta } from "~/types/layout"

  const props = defineProps<{
    article: ArticleResponse
    /** Служебная строка после автора: рубрика (по умолчанию) или дата. */
    meta?: CardMeta
  }>()
  const slug = computed(() => `/${props.article.contentType.slug}/${props.article.slug}`)
  const contentType = computed(() => `/${props.article.contentType.slug}`)
  const author = computed(() => `/authors/${props.article.author.slug}`)
</script>

<template>
  <article v-if="slug && article.title">
    <div class="flex flex-row items-start gap-6">
      <!-- Изображение (левая сторона) -->
      <figure class="relative flex flex-shrink-0 flex-col items-start">
        <NuxtLink :to="slug" class="block group">
          <NuxtImg
            :src="article.featuredImage"
            :alt="article.title"
            class="h-[75px] w-28 max-w-28 rounded-sm object-cover transition-transform duration-300" />
        </NuxtLink>
      </figure>

      <div class="flex flex-1 flex-col min-w-0">
        <NuxtLink
          :to="slug"
          class="font-garamond-libre text-card font-bold text-zinc-900 dark:text-zinc-300 transition-colors">
          {{ article.title }}
        </NuxtLink>
        <div class="mt-1 flex flex-row flex-wrap items-baseline gap-x-2 gap-y-1">
          <ShowAuthor :link="author" :name="article.author.name" />
          <span class="font-cormorant text-meta text-zinc-600 dark:text-zinc-400" aria-hidden="true">·</span>
          <ShowDate v-if="meta === 'date'" :time="article.publishedAt" />
          <ShowType v-else :link="contentType" :name="article.contentType.name" />
        </div>
      </div>
    </div>
  </article>
</template>
