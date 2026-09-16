<script setup lang="ts">
  import { computed } from "vue"
  import { formatArticleDate } from "~/utils/articleDate"

  const props = withDefaults(defineProps<{ time: string; locale?: "ru" | "en" }>(), { locale: "ru" })
  const label = computed(() => formatArticleDate(props.time, props.locale))
</script>

<template>
  <time v-if="label" :datetime="time" class="font-sans text-xs text-zinc-500 dark:text-zinc-400">{{ label }}</time>
</template>
