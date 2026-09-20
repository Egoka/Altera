<script setup lang="ts">
  /**
   * Заголовок списочной страницы: название, счётчик и словесная подпись принципа
   * порядка (`authors-index.md` §6). Шапки рубрики и тега привязаны к сущностям и
   * живут отдельно.
   */
  defineProps<{
    title: string
    count?: string
    description?: string
    caption?: string
    actionLabel?: string
    actionTo?: string
  }>()
</script>

<template>
  <header class="pt-12 pb-8">
    <h1 class="font-waterway text-4xl tracking-widest text-zinc-950 sm:text-5xl dark:text-zinc-100">
      {{ title }}
    </h1>
    <p v-if="count" class="mt-3 font-sans text-xs font-bold uppercase text-zinc-600 dark:text-zinc-400">
      {{ count }}
    </p>
    <p v-if="description" class="mt-4 max-w-3xl font-garamond-libre text-xl text-zinc-600 dark:text-zinc-300">
      {{ description }}
    </p>
    <p v-if="caption" class="mt-4 font-sans text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
      {{ caption }}
    </p>
    <NuxtLink
      v-if="actionLabel && actionTo"
      :to="actionTo"
      class="mt-6 inline-flex border-b-2 border-orange-600 pb-1 font-serif font-semibold text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
      {{ actionLabel }}
    </NuxtLink>
  </header>
</template>
