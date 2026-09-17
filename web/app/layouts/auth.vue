<script setup lang="ts">
  import AppHeader from "@/components/app/header.vue"
  import AppFooter from "@/components/app/footer.vue"

  useHead({
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })
</script>

<template>
  <div>
    <AppHeader />
    <main class="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <slot />
    </main>
    <AppFooter />
  </div>
</template>

<style scoped></style>
