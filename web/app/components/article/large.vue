<script setup lang="ts">
  import type { CardMeta } from "~/types/layout"
  import type { ReadingArticle } from "~/types/reading"

  defineProps<{ article: ReadingArticle; scale?: "lead"; meta?: CardMeta }>()
</script>

<template>
  <ArticleCard :article="article" variant="large" media="beside" />
</template>
