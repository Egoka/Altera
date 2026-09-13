<script setup lang="ts">
  import type { ArticleResponse } from "~/types/article"
  import type { CardMeta } from "~/types/layout"

  const props = defineProps<{
    article: ArticleResponse
    /** Ведущий слот группы — заголовок на ступень крупнее. */
    scale?: "lead"
    /** Служебная строка после автора: рубрика (по умолчанию) или дата. */
    meta?: CardMeta
  }>()
  const slug = computed(() => `/${props.article.contentType.slug}/${props.article.slug}`)
  const contentType = computed(() => `/${props.article.contentType.slug}`)
  const author = computed(() => `/authors/${props.article.author.slug}`)
</script>

<template>
  <article>
    <figure class="mb-4">
      <NuxtLink :to="slug" class="block group">
        <NuxtImg
          :src="article.featuredImage"
          :alt="article.title"
          class="w-full aspect-3/2 object-cover rounded-sm transition-transform duration-300" />
      </NuxtLink>
    </figure>

    <div>
      <NuxtLink
        :to="slug"
        :class="[
          'font-garamond-libre font-bold text-zinc-900 transition-colors dark:text-zinc-300',
          scale === 'lead' ? 'text-card md:text-title' : 'text-card'
        ]">
        {{ article.title }}
      </NuxtLink>
      <div class="mt-1 flex flex-row flex-wrap items-baseline gap-x-2 gap-y-1">
        <ShowAuthor :link="author" :name="article.author.name" />
        <span class="font-cormorant text-meta text-zinc-600 dark:text-zinc-400" aria-hidden="true">·</span>
        <ShowDate v-if="meta === 'date'" :time="article.publishedAt" />
        <ShowType v-else :link="contentType" :name="article.contentType.name" />
      </div>
    </div>
  </article>
</template>

<style scoped></style>
