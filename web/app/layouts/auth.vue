<script setup lang="ts">
  import AppHeader from "@/components/app/header.vue"
  import AppFooter from "@/components/app/footer.vue"
</script>

<template>
  <div>
    <AppHeader />
    <main class="size-56 bg-primary">
      <slot />
    </main>
    <AppFooter />
  </div>
</template>

<style scoped></style>
