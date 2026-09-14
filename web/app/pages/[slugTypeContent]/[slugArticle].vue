<script setup lang="ts">
  const route = useRoute()
  const slugArticle = computed(() => String(route.params.slugArticle ?? ""))
</script>

<template>
  <div>
    <HeaderTag :tag="{ name: slugArticle }" />
  </div>
</template>

<style scoped></style>
