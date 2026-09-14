<script setup lang="ts">
  defineProps<{
    link: string
    name?: string
  }>()
</script>

<template>
  <!-- Рубрика в служебной строке — кикер: прописные системным sans, как дата (видение §3,
       владелец 2026-09-14: заглавные капителью Cormorant смотрелись тяжело); имя автора
       остаётся капителью -->
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
