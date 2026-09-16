<script setup lang="ts">
  import type { PopularArticleFragment } from "~/graphql/generated/graphql"

  defineProps<{ index: number; article: PopularArticleFragment }>()
</script>

<template>
  <ArticleCard :article="article" variant="rank" :rank="index + 1" />
</template>
