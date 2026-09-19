<script setup lang="ts">
  definePageMeta({
    i18n: false,
    layout: "auth",
    requiresAuth: true
  })

  const { t } = useI18n()
  const route = useRoute()
  const sectionId = typeof route.query.section === "string" ? route.query.section : undefined

  await createArticleDraftAndOpenEditor(sectionId)
</script>

<template>
  <main class="mx-auto flex min-h-[50vh] max-w-3xl items-center justify-center px-4" aria-live="polite">
    <p>{{ t("common.loading") }}</p>
  </main>
</template>
