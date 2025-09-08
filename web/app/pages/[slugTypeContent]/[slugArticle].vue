<script setup lang="ts">
  import { useRoute } from "vue-router"
  const route = useRoute()
</script>

<template>
  <div>
    <HeaderTag :tag="{ name: route.params.slugArticle }" />
  </div>
</template>

<style scoped></style>
