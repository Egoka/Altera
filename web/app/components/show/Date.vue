<script setup lang="ts">
  import { formatArticleDate } from "~/utils/articleDate"

  // Дата в служебной строке карточки: та же капитель и тон, что у автора и рубрики,
  // без ссылки. Красный `ShowTime` из старой карточки в эту строку не ложится.
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
    class="font-cormorant font-semibold text-meta tracking-meta text-zinc-600 dark:text-zinc-400">
    {{ text }}
  </time>
</template>
