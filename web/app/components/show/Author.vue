<script setup lang="ts">
  defineProps<{
    link: Date | string
    name?: string
  }>()
</script>

<template>
  <NuxtLink
    :to="link"
    :class="[
      'font-cormorant font-normal uppercase tracking-wide',
      'text-zinc-600 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400',
      'transition-colors duration-500'
    ]">
    {{ name }}
  </NuxtLink>
</template>

<style scoped></style>
