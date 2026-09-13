<script setup lang="ts">
  import { formatArticleDate } from "~/utils/articleDate"

  // Дата в служебной строке карточки: стиль прежней даты автора (прописные, sans,
  // полужирный), но в приглушённом тоне строки; красной становится только при
  // наведении (решение владельца 2026-09-13).
  const props = defineProps<{
    time: string
  }>()

  const { locale } = useI18n()
  const text = computed(() => formatArticleDate(props.time, locale.value))
</script>

<template>
  <time
    v-if="text"
    :datetime="time"
    :class="[
      'font-sans uppercase text-xs/6 font-bold',
      'text-zinc-600 dark:text-zinc-400 hover:text-red-700 dark:hover:text-red-400',
      'transition-colors duration-500'
    ]">
    {{ text }}
  </time>
</template>
