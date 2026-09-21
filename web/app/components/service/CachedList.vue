<script setup lang="ts">
  import type { CachedPage } from "~/composables/useOfflinePage"

  /**
   * Список сохранённого из Cache Storage (`offline.md` §6). `ArticleCard` здесь не годится:
   * его поля приходят из API, которого офлайн нет — у строки есть только заголовок, рубрика
   * и дата посещения.
   */
  withDefaults(defineProps<{ pages: readonly CachedPage[]; locale?: "ru" | "en" }>(), { locale: "ru" })
  const { t } = useI18n()
</script>

<template>
  <section class="mx-auto mt-14 max-w-2xl" aria-labelledby="cached-list-title" data-testid="cached-list">
    <h2 id="cached-list-title" class="font-sans text-xs uppercase tracking-wider text-zinc-500">
      {{ t("service.offlineSavedTitle") }}
    </h2>

    <p
      v-if="!pages.length"
      data-testid="cached-list-empty"
      class="mt-4 font-garamond-libre text-lg text-zinc-600 dark:text-zinc-400">
      {{ t("service.offlineSavedEmpty") }}
    </p>

    <ul v-else class="mt-4">
      <li v-for="page in pages" :key="page.path" class="border-t border-zinc-200 py-4 dark:border-zinc-800">
        <a
          :href="page.path"
          class="font-garamond-libre text-xl font-bold text-zinc-950 underline-offset-4 hover:text-orange-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
          {{ page.title }}
        </a>
        <p class="mt-1 flex flex-wrap items-center gap-x-2 font-sans text-sm text-zinc-500">
          <span v-if="page.section">{{ page.section }}</span>
          <span v-if="page.section && page.visitedAt" aria-hidden="true">·</span>
          <ReadingDateStamp v-if="page.visitedAt" :time="page.visitedAt" :locale="locale" />
        </p>
      </li>
    </ul>
  </section>
</template>
