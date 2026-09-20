<script setup lang="ts">
  /**
   * Колонки «тег — счётчик». При порядке по имени список группируется по первой букве:
   * облако чипов счётчик и группы не выражает, поэтому у каталога свой компонент.
   */
  const props = defineProps<{
    tags: readonly { slug: string; name: string; articleCount: number }[]
    grouped: boolean
  }>()

  const groups = computed(() => {
    if (!props.grouped) return [{ letter: "", tags: props.tags }]
    const buckets = new Map<string, { slug: string; name: string; articleCount: number }[]>()
    for (const tag of props.tags) {
      const letter = tag.name.trim().charAt(0).toLocaleUpperCase()
      const bucket = buckets.get(letter)
      if (bucket) bucket.push(tag)
      else buckets.set(letter, [tag])
    }
    return [...buckets].map(([letter, tags]) => ({ letter, tags }))
  })
</script>

<template>
  <div class="space-y-10">
    <section v-for="group in groups" :key="group.letter || 'all'">
      <h2
        v-if="group.letter"
        class="mb-4 font-sans text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
        {{ group.letter }}
      </h2>
      <ul class="grid grid-cols-1 gap-x-12 gap-y-3 md:grid-cols-2 lg:grid-cols-3">
        <li v-for="tag in group.tags" :key="tag.slug">
          <NuxtLink
            :to="`/tags/${tag.slug}`"
            class="flex items-baseline justify-between gap-4 font-garamond-libre text-lg text-zinc-800 transition-colors duration-300 hover:text-red-700 dark:text-zinc-200 dark:hover:text-red-400">
            <span>{{ tag.name }}</span>
            <span class="font-sans text-xs text-zinc-500 dark:text-zinc-500">{{ tag.articleCount }}</span>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
</template>
