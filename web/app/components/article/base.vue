<script setup lang="ts">
  import type { ArticleResponse } from "~/types/article"
  import type { CardMeta } from "~/types/layout"

  const props = defineProps<{
    article: ArticleResponse
    /** Ведущий слот группы — заголовок на ступень крупнее. */
    scale?: "lead"
    /** Служебная строка: части по порядку, по умолчанию автор · рубрика. */
    meta?: CardMeta
  }>()
  const slug = computed(() => `/${props.article.contentType.slug}/${props.article.slug}`)
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
        <ArticleMeta :article="article" :parts="meta" />
      </div>
    </div>
  </article>
</template>

<style scoped></style>
