<script setup lang="ts">
  import type { ReadingArticle } from "~/types/reading"

  /**
   * «Популярное за неделю»: карточки `rank` с номерами (`home.md` §5 зона 4). До запуска
   * контура вовлечённости сервер эту подборку не отдаёт, и зона на странице не появляется.
   */
  defineProps<{ articles: ReadingArticle[]; caption?: string }>()

  const { t } = useI18n()
</script>

<template>
  <section class="popular-articles pt-24 border-t border-zinc-200 dark:border-zinc-800">
    <div>
      <h2 class="font-waterway text-3xl tracking-widest text-zinc-900 dark:text-zinc-300">
        {{ t("home.popular") }}
      </h2>
      <p
        v-if="caption"
        class="mt-2 mb-10 font-sans text-[0.6875rem] font-semibold uppercase tracking-wider text-zinc-500">
        {{ caption }}
      </p>
      <!-- Под списком воздух в 96 px: столько же у соседних зон над содержимым под их
           линейкой, и линейка встаёт посередине (владелец, 2026-09-14) -->
      <div class="mb-24 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 divide-zinc-200 dark:divide-zinc-800">
        <div
          v-for="(article, index) in articles"
          :key="article.id"
          class="flex items-start py-6 border-zinc-200 dark:border-zinc-800"
          :class="[!(index % 2) ? 'md:pr-6 lg:pr-8 md:border-r' : 'md:pl-6 lg:pl-8']">
          <ArticleText :index :article />
        </div>
      </div>
    </div>
  </section>
</template>
