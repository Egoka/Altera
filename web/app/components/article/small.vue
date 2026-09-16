<script setup lang="ts">
  import type { ArticleCardFragment } from "~/graphql/generated/graphql"
  import type { CardMeta } from "~/types/layout"

  defineProps<{ article: ArticleCardFragment; meta?: CardMeta }>()
</script>

<template>
  <ArticleCard :article="article" variant="small" />
</template>
