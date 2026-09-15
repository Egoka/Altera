<script setup lang="ts">
  import type { ArticleCardFragment, TagSummaryFragment } from "~/graphql/generated/graphql"
  import { DEMO_DEMANDED, DEMO_LATEST } from "~/utils/demoFeed"
  import { findDemoTag } from "~/utils/demoTags"

  definePageMeta({
    layout: "default"
  })

  const route = useRoute()

  /**
   * Тег берётся из маршрута по демо-справочнику: раньше страница любого слага
   * показывала «Технологии» из собственного мока, и `/tags/economics` врал в
   * заголовке. Описания у тега нет по ADR-0005, поэтому поле не заполняется.
   */
  const tag = computed<TagSummaryFragment>(() => {
    const demo = findDemoTag(String(route.params.slug ?? ""))
    return {
      id: demo.slug,
      name: demo.name,
      slug: demo.slug,
      description: null,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z"
    }
  })

  /**
   * Демо-лента тега: одна страница из 24 материалов главной. Даты детерминированы —
   * по дню назад от фиксированной точки, чтобы лента по новизне выглядела одинаково
   * при каждом запуске. Рубрика материалов не подменяется одной на всю страницу: под
   * тегом лежат материалы разных рубрик, и именно это делает кикер рубрики на
   * карточке осмысленным (`tag-feed.md` §4).
   */
  const PAGE_SIZE = 24
  const firstDay = Date.UTC(2026, 8, 13, 12)
  const articles: ArticleCardFragment[] = [...DEMO_LATEST, ...DEMO_DEMANDED]
    .slice(0, PAGE_SIZE)
    .map((article, index) => ({
      ...article,
      id: `tag-${index + 1}`,
      publishedAt: new Date(firstDay - index * 24 * 60 * 60 * 1000).toISOString()
    }))
</script>

<template>
  <div>
    <HeaderTag :tag="tag" />
    <!-- Лента тега — ровный каталог: тег сводит материалы разных рубрик, между собой
         они равны, поэтому иерархии в сетке нет. Служебная строка показывает автора и
         рубрику: сам тег назван в шапке. -->
    <section class="pt-12 pb-16">
      <ArticleCatalog :articles="articles" :meta="['author', 'type']" />
    </section>
  </div>
</template>

<style scoped></style>
