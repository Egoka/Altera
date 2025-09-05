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
      'font-sans font-bold text-xs/6 uppercase tracking-wider',
      'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300',
      'transition-colors duration-500'
    ]">
    {{ name }}
  </NuxtLink>
</template>

<style scoped></style>
