<script setup lang="ts">
  const { t } = useI18n()
  definePageMeta({
    i18n: false,
    layout: "admin",
    middleware: ["admin"]
  })
</script>

<template>
  <div class="text-zinc-500 text-2xl font-mono flex justify-center items-center h-full w-full">
    {{ t("common.inDevelopment") }}
  </div>
</template>

<style scoped></style>
