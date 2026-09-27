<script setup lang="ts">
  import { computed } from "vue"
  const props = defineProps<{ name: string; slug: string }>()

  // Лента рубрики в локали страницы (журнал §20.5).
  const localePath = useLocalePath()
  const to = computed(() => localePath(`/${props.slug}`))
</script>

<template>
  <NuxtLink
    :to="to"
    class="font-cormorant-sc text-xs font-semibold uppercase tracking-[0.16em] text-orange-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-orange-400">
    {{ name }}
  </NuxtLink>
</template>
