<script setup lang="ts">
  /**
   * `FeatureColumns` (`about.md` §5 зона 3, §6): три колонки «как это работает». На `lg` и `md` —
   * в ряд, ниже — одной колонкой (§9). Колонки отделены воздухом, без линеек.
   */
  defineProps<{ columns: readonly { key: string; title: string; text: string }[] }>()
</script>

<template>
  <ul class="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8" data-testid="about-columns">
    <li v-for="column in columns" :key="column.key" :data-testid="`about-column-${column.key}`">
      <h3 class="font-waterway text-2xl tracking-wide text-zinc-950 dark:text-zinc-100">{{ column.title }}</h3>
      <p class="mt-3 font-garamond-libre text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
        {{ column.text }}
      </p>
    </li>
  </ul>
</template>
