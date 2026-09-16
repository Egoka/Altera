<script setup lang="ts">
  import type { ArticleCardFragment } from "~/graphql/generated/graphql"
  import type { CardMeta } from "~/types/layout"

  defineProps<{ article: ArticleCardFragment; scale?: "lead" | "index"; meta?: CardMeta }>()
</script>

<template>
  <ArticleCard :article="article" variant="large" media="above" />
</template>
