<script setup lang="ts">
  import type { ArticleCardFragment } from "~/graphql/generated/graphql"
  import type { CardMeta } from "~/types/layout"

  const props = defineProps<{
    article: ArticleCardFragment
    /** Служебная строка: части по порядку, по умолчанию автор · рубрика. */
    meta?: CardMeta
  }>()
  const slug = computed(() => (props.article.section ? `/${props.article.section.slug}/${props.article.slug}` : ""))
</script>

<template>
  <article v-if="slug && article.title">
    <div class="flex flex-row items-start gap-6">
      <!-- Изображение (левая сторона) -->
      <figure class="relative flex flex-shrink-0 flex-col items-start">
        <NuxtLink :to="slug" class="block group">
          <NuxtImg
            :src="article.featuredImage ?? undefined"
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
          <ArticleMeta :article="article" :parts="meta" />
        </div>
      </div>
    </div>
  </article>
</template>
