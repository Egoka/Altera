<script setup lang="ts">
  defineProps<{ name: string; slug: string }>()
</script>

<template>
  <NuxtLink
    :to="`/${slug}`"
    class="font-cormorant-sc text-xs font-semibold uppercase tracking-[0.16em] text-orange-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-orange-400">
    {{ name }}
  </NuxtLink>
</template>
