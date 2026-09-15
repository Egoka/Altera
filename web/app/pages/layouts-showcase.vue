<script setup lang="ts">
  import type { ArticleCardFragment } from "~/graphql/generated/graphql"
  import { ARTICLE_LAYOUTS, capacityOf, validateLayout } from "~/utils/articleLayouts"

  // Витрина раскладок: только для разработки. Показывает каждую комбинацию из
  // реестра на одинаковом наборе материалов, чтобы их можно было сравнить
  // между собой, а не искать по ленте.
  definePageMeta({ layout: "default" })
  useSeoMeta({ robots: "noindex, nofollow" })

  const titles = [
    "Внутренних часов не существует",
    "Скука",
    "Что осталось от площади после того, как с неё убрали машины",
    "Натюрморт как отчёт о ценах",
    "Город, который читают ногами",
    "Тишина в записи"
  ]
  const authors = ["Анна Верещагина", "Пётр Ланской", "Мария Кольцова", "Егор Соловьёв"]
  const sections = [
    { name: "Идеи", slug: "ideas" },
    { name: "Искусство", slug: "art" },
    { name: "Города", slug: "cities" },
    { name: "Наука", slug: "science" }
  ]

  const makeArticle = (i: number): ArticleCardFragment => ({
    id: `demo-${i}`,
    title: titles[i % titles.length]!,
    slug: `demo-${i}`,
    dek: "Демонстрационный дек: одно предложение, по которому видно, как ведёт себя вторая строка.",
    excerpt: "",
    featuredImage: `https://picsum.photos/900/600?random=${i + 40}`,
    publishedAt: "2026-09-13",
    author: { name: authors[i % authors.length]!, slug: `demo-author-${i}`, photoUrl: "" },
    section: sections[i % sections.length]!
  })

  const demoFor = (count: number) => Array.from({ length: count }, (_, i) => makeArticle(i))

  const rows = ARTICLE_LAYOUTS.map((layout) => ({
    layout,
    capacity: capacityOf(layout),
    errors: validateLayout(layout),
    articles: demoFor(capacityOf(layout))
  }))
</script>

<template>
  <div class="py-16">
    <h1 class="font-waterway text-3xl tracking-widest mb-4 text-zinc-900 dark:text-zinc-300">Раскладки групп</h1>
    <p class="font-garamond-libre text-card-dek text-zinc-600 dark:text-zinc-400 mb-16 max-w-2xl">
      Каждая комбинация из реестра на одинаковом наборе материалов. Страница только для разработки.
    </p>

    <div v-for="row in rows" :key="row.layout.id" class="mb-24">
      <div
        class="mb-6 flex flex-row flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <span class="font-cormorant text-meta tracking-meta font-semibold text-zinc-900 dark:text-zinc-300">
          {{ row.layout.id }}
        </span>
        <span class="font-cormorant text-meta tracking-meta text-zinc-600 dark:text-zinc-400">
          {{ row.capacity }} материалов · {{ row.layout.cells.length }}
          {{ row.layout.cells.length === 1 ? "ряд" : "ряда" }} · {{ row.layout.traits.anchor }} ·
          {{ row.layout.traits.dominant }}<template v-if="row.layout.traits.accent"> · нарушение</template>
        </span>
        <span v-if="row.errors.length" class="font-sans text-xs text-red-700">{{ row.errors.join("; ") }}</span>
      </div>

      <!-- Матрица областей: видно, из чего собрана раскладка -->
      <pre class="mb-6 font-mono text-xs leading-5 text-zinc-500 dark:text-zinc-500">{{
        row.layout.cells.join("\n")
      }}</pre>

      <ArticleGroup :articles="row.articles" :layout="row.layout.id" />
    </div>
  </div>
</template>
