<script setup lang="ts">
  /**
   * `StateScreen` (`docs/spec/30-account/reader/archived-state.md` §6): центрированный экран
   * одного состояния — заголовок, пояснение и действия под ним. Компонент появляется вместе с
   * первым экраном, которому он нужен; спецификация предполагает его и на страницах «не
   * найдено» и «материал снят» — их перевод выполняется своей задачей, а не этой.
   */
  withDefaults(defineProps<{ title: string; testid?: string }>(), { testid: "state-screen" })
</script>

<template>
  <section :data-testid="testid" class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-20">
    <h1 class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">{{ title }}</h1>

    <div class="flex flex-col gap-4 font-sans text-base text-zinc-700 dark:text-zinc-300">
      <slot />
    </div>

    <div class="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
      <slot name="actions" />
    </div>
  </section>
</template>
