<script setup lang="ts">
  defineProps<{ name: string; slug: string }>()
</script>

<template>
  <NuxtLink
    :to="`/authors/${slug}`"
    class="font-cormorant-sc text-sm font-semibold tracking-wide text-zinc-700 underline-offset-4 hover:text-orange-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-300 dark:hover:text-orange-400">
    {{ name }}
  </NuxtLink>
</template>
