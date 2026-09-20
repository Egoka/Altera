<script setup lang="ts">
  import type { ReadingArticle } from "~/types/reading"

  defineProps<{ article: ReadingArticle }>()
</script>

<template>
  <ArticleCard :article="article" variant="lede" />
</template>
