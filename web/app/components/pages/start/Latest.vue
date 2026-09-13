<script setup lang="ts">
  import { getLayout, validateRhythm } from "~/utils/articleLayouts"
  import { DEMO_LATEST } from "~/utils/demoFeed"

  const latestArticles = DEMO_LATEST

  /**
   * Ритм ленты: явный список раскладок из реестра `articleLayouts`.
   * Явное перечисление честнее генератора — ритм ленты это редакционное
   * решение, оно должно читаться в одном месте и видеться в диффе.
   * Сумма вместимостей обязана совпасть с числом материалов, иначе
   * `validateRhythm` скажет об этом вслух (раньше хвост молча не рендерился).
   */
  const rhythm = ["hero-left", "quad-square", "break-inset", "trio-uneven", "trio-tall"]

  const groups = computed(() => {
    let cursor = 0
    return rhythm
      .map((id) => {
        const layout = getLayout(id)
        if (!layout) return null
        const slice = latestArticles.slice(cursor, cursor + layout.slots.length)
        cursor += layout.slots.length
        return slice.length ? { id, layout: id, articles: slice } : null
      })
      .filter((g): g is { id: string; layout: string; articles: typeof latestArticles } => g !== null)
  })

  if (import.meta.dev) {
    const errors = validateRhythm(rhythm, latestArticles.length)
    if (errors.length) console.error("[Latest]", errors.join("; "))
  }
</script>

<template>
  <section class="latest-articles pt-16">
    <div>
      <h2 class="font-waterway text-3xl tracking-widest mb-10 text-zinc-900 dark:text-zinc-300">Новое</h2>
      <ArticleGroup v-for="group in groups" :key="group.id" :articles="group.articles" :layout="group.layout" />
    </div>
  </section>
</template>
