<script setup lang="ts">
  withDefaults(defineProps<{ cards?: number }>(), { cards: 3 })
</script>

<template>
  <section aria-busy="true" aria-label="Материалы загружаются">
    <span class="sr-only">Материалы загружаются</span>
    <div class="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      <div v-for="card in cards" :key="card" class="animate-pulse motion-reduce:animate-none">
        <div class="aspect-3/2 bg-zinc-200 dark:bg-zinc-800"></div>
        <div class="mt-4 h-3 w-1/3 bg-zinc-200 dark:bg-zinc-800"></div>
        <div class="mt-3 h-7 w-full bg-zinc-200 dark:bg-zinc-800"></div>
        <div class="mt-2 h-7 w-4/5 bg-zinc-200 dark:bg-zinc-800"></div>
      </div>
    </div>
  </section>
</template>
