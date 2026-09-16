<script setup lang="ts">
  import type { ArticleCardFragment } from "~/graphql/generated/graphql"

  defineProps<{ article: ArticleCardFragment }>()
</script>

<template>
  <ArticleCard :article="article" variant="lede" />
</template>
