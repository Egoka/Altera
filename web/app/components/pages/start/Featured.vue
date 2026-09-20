<script setup lang="ts">
  import type { ReadingArticle } from "~/types/reading"

  /**
   * Главный топ: первая карточка `lede`, четыре `large` (`home.md` §5 зона 2). Материалов
   * меньше пяти — показываются те, что есть; пустой список сюда не приходит, пустую зону
   * сервер в ответ не кладёт.
   */
  const props = defineProps<{ articles: ReadingArticle[]; caption?: string }>()

  const mainArticle = computed(() => props.articles[0])
  // Флагман идёт во всю ширину отдельным открывающим событием,
  // остальные четыре — рядом под ним (решение владельца).
  const secondaryArticles = computed(() => props.articles.slice(1, 5))
</script>

<template>
  <section class="featured-articles pt-10 pb-24 border-b border-zinc-200 dark:border-zinc-800">
    <p
      v-if="caption"
      class="mb-8 text-center font-sans text-[0.6875rem] font-semibold uppercase tracking-wider text-zinc-500">
      {{ caption }}
    </p>

    <!-- Флагман: изображение во всю ширину контейнера, под ним по центральной оси
         заголовок, дек и мета. Ось рифмуется с логотипом по центру в шапке. -->
    <div v-if="mainArticle">
      <ArticleLede :article="mainArticle" />
    </div>

    <!-- Флагман от остальной ленты отделяет только воздух: линейку владелец
         снял при живом ревью 2026-09-13 -->
    <ul
      v-if="secondaryArticles.length"
      class="mt-16 grid grid-cols-1 gap-y-10 pt-16 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-4 lg:gap-x-12">
      <li v-for="article in secondaryArticles" :key="article.id">
        <ArticleBase :article="article" />
      </li>
    </ul>
  </section>
</template>
