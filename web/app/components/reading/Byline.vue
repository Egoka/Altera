<script setup lang="ts">
  import { computed } from "vue"
  const props = defineProps<{ name: string; slug: string }>()

  // Адрес страницы автора в локали страницы: на `/en` ссылка обязана вести на `/en/authors/…`
  // (стратегия `prefix_except_default`, журнал §20.5).
  const localePath = useLocalePath()
  const to = computed(() => localePath(`/authors/${props.slug}`))
</script>

<template>
  <NuxtLink
    :to="to"
    class="font-cormorant-sc text-sm font-semibold tracking-wide text-zinc-700 underline-offset-4 hover:text-orange-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-300 dark:hover:text-orange-400">
    {{ name }}
  </NuxtLink>
</template>
