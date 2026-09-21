<script setup lang="ts">
  /**
   * `NoticeCard` (`legal-privacy.md` §6, `legal-license.md` §6): короткое пояснение рядом с
   * текстом — «ваши данные», «коротко». Карточка отделяется от текста фоном и воздухом.
   */
  withDefaults(defineProps<{ title?: string; tone?: "neutral" | "accent" }>(), {
    title: undefined,
    tone: "neutral"
  })
</script>

<template>
  <section
    class="px-5 py-4"
    :class="
      tone === 'accent'
        ? 'bg-orange-50 text-zinc-900 dark:bg-orange-950/40 dark:text-zinc-100'
        : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200'
    ">
    <h2 v-if="title" class="font-sans text-sm font-semibold tracking-wide">{{ title }}</h2>
    <div class="font-garamond-libre text-lg leading-relaxed" :class="{ 'mt-2': title }">
      <slot />
    </div>
  </section>
</template>
