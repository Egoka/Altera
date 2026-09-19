<script setup lang="ts">
  import CategoriesIndex from "../categories/index.vue"

  definePageMeta({
    layout: "admin",
    middleware: ["admin", "taxonomy"],
    i18n: false
  })

  useSeoMeta({ robots: "noindex, nofollow" })
</script>

<template>
  <CategoriesIndex />
</template>
