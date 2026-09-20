<script setup lang="ts">
  /** Ряд тегов-ссылок; в облаке каталога размер знака растёт со счётчиком в три ступени. */
  const props = withDefaults(
    defineProps<{ tags: readonly { slug: string; name: string; articleCount?: number }[]; sized?: boolean }>(),
    { sized: false }
  )

  const max = computed(() => Math.max(1, ...props.tags.map((tag) => tag.articleCount ?? 0)))
  const step = (count?: number) => {
    if (!props.sized || !count) return "text-base"
    const share = count / max.value
    if (share > 0.66) return "text-3xl"
    return share > 0.33 ? "text-xl" : "text-base"
  }
</script>

<template>
  <div v-if="tags.length" class="flex flex-wrap items-baseline gap-x-6 gap-y-3">
    <NuxtLink
      v-for="tag in tags"
      :key="tag.slug"
      :to="`/tags/${tag.slug}`"
      :class="[
        'font-garamond-libre text-zinc-700 transition-colors duration-300 hover:text-red-700 dark:text-zinc-300 dark:hover:text-red-400',
        step(tag.articleCount)
      ]">
      {{ tag.name }}
    </NuxtLink>
  </div>
</template>
