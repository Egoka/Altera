<script setup lang="ts">
  import { getLayout, validateRhythm } from "~/utils/articleLayouts"
  import { DEMO_DEMANDED } from "~/utils/demoFeed"
  import { DEMANDED_RHYTHM } from "~/utils/feedRhythm"

  const demandedArticles = DEMO_DEMANDED

  /** Ритм ленты живёт в `feedRhythm` рядом с ритмом «Нового» и проверяется тестом. */
  const rhythm = DEMANDED_RHYTHM

  const groups = computed(() => {
    let cursor = 0
    return rhythm
      .map((id) => {
        const layout = getLayout(id)
        if (!layout) return null
        const slice = demandedArticles.slice(cursor, cursor + layout.slots.length)
        cursor += layout.slots.length
        return slice.length ? { id, layout: id, articles: slice } : null
      })
      .filter((g): g is { id: string; layout: string; articles: typeof demandedArticles } => g !== null)
  })

  if (import.meta.dev) {
    const errors = validateRhythm(rhythm, demandedArticles.length)
    if (errors.length) console.error("[Demanded]", errors.join("; "))
  }
</script>

<template>
  <section class="demanded-articles pt-24 border-t border-zinc-200 dark:border-zinc-800">
    <div>
      <h2 class="font-waterway text-3xl tracking-widest mb-10 text-zinc-900 dark:text-zinc-300">Востребованное</h2>
      <ArticleGroup v-for="group in groups" :key="group.id" :articles="group.articles" :layout="group.layout" />
    </div>
  </section>
</template>
