<script setup lang="ts">
  defineProps<{
    link: Date | string
    name?: string
  }>()
</script>

<template>
  <NuxtLink
    :to="`/tags/${link}`"
    :class="[
      'inline-block px-3 py-1 rounded-md',
      'border border-zinc-100 dark:border-zinc-900',
      'text-sm text-zinc-600 dark:text-zinc-500',
      'transition-colors duration-500',
      'hover:text-zinc-900 hover:border-zinc-300 hover:dark:text-zinc-200 hover:dark:border-zinc-700'
    ]">
    <!--    class="hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-800 dark:hover:text-primary-300 transition-colors"-->
    {{ name }}
  </NuxtLink>
</template>

<style scoped></style>
