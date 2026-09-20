<script setup lang="ts">
  import type { ReadingArticle } from "~/types/reading"

  defineProps<{ index: number; article: ReadingArticle }>()
</script>

<template>
  <ArticleCard :article="article" variant="rank" :rank="index + 1" />
</template>
