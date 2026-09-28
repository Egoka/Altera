<script setup lang="ts">
  /**
   * Баннер состояния редактора (`docs/spec/30-account/author/article-edit.md` §5 зона 2):
   * истёкший план, проверка, доработка, отклонена редакцией, офлайн. Блок отделяется воздухом и
   * фоном, а не линейкой.
   */
  withDefaults(defineProps<{ tone?: "neutral" | "accent"; testId?: string }>(), {
    tone: "neutral",
    testId: undefined
  })
</script>

<template>
  <section
    role="status"
    :data-testid="testId"
    class="px-5 py-4 text-sm leading-6"
    :class="
      tone === 'accent'
        ? 'bg-orange-50 text-zinc-900 dark:bg-orange-950/40 dark:text-zinc-100'
        : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200'
    ">
    <slot />
  </section>
</template>
