<script setup lang="ts">
  import type { ArticleCardFragment } from "~/graphql/generated/graphql"
  import type { CardMeta } from "~/types/layout"

  // Служебная строка карточки: части в заданном порядке через точку-разделитель.
  // Один атом вместо трёх одинаковых блоков в карточках base, large и small.
  const props = withDefaults(
    defineProps<{
      article: ArticleCardFragment
      parts?: CardMeta
    }>(),
    { parts: () => ["author", "type"] }
  )

  const authorLink = computed(() => `/authors/${props.article.author.slug}`)
  const typeLink = computed(() => `/${props.article.contentType.slug}`)
</script>

<template>
  <template v-for="(part, index) in parts" :key="part">
    <span v-if="index > 0" class="font-sans text-xs/6 font-bold text-zinc-600 dark:text-zinc-400" aria-hidden="true"
      >·</span
    >
    <ShowAuthor v-if="part === 'author'" :link="authorLink" :name="article.author.name" />
    <ShowType v-else-if="part === 'type'" :link="typeLink" :name="article.contentType.name" />
    <ShowDate v-else-if="article.publishedAt" :time="article.publishedAt" />
  </template>
</template>
