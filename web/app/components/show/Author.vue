<script setup lang="ts">
  defineProps<{
    link: Date | string
    name?: string
  }>()
</script>

<template>
  <!-- Автор в служебной строке — тем же кикером, что рубрика и дата: прописные системным
       sans (владелец, 2026-09-14) -->
  <NuxtLink
    :to="link"
    :class="[
      'font-sans uppercase text-xs/6 font-bold',
      'text-zinc-600 dark:text-zinc-400 hover:text-red-700 dark:hover:text-red-400',
      'transition-colors duration-500'
    ]">
    {{ name }}
  </NuxtLink>
</template>

<style scoped></style>
