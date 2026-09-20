<script setup lang="ts">
  /**
   * Шапка ленты тега. Описания у тега нет (ADR-0005); счётчик и решётку владелец убрал
   * решением 2026-09-14 (`tag-feed.md` §12), поэтому зона показывает только название.
   */
  defineProps<{ tag: { name: string } }>()
</script>

<template>
  <header class="w-full border-b border-zinc-200 dark:border-zinc-800">
    <div class="w-full pt-12 pb-8 sm:pt-10 sm:pb-6 md:pt-14 md:pb-10">
      <h1
        class="font-waterway text-center text-3xl font-bold tracking-widest text-zinc-900 md:text-left md:text-4xl dark:text-zinc-100">
        {{ tag.name }}
      </h1>
    </div>
  </header>
</template>

<style scoped></style>
