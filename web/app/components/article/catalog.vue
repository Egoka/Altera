<script setup lang="ts">
  import type { ArticleResponse } from "~/types/article"
  import type { CardMeta } from "~/types/layout"

  /**
   * Ровный каталог материалов: сеточный двойник `ArticleGroup`. Тот рисует
   * переменные раскладки реестра, этот — равные карточки в три, две и одну
   * колонку, как указатель.
   *
   * Разделительных линеек нет (владелец, 2026-09-14): ряды и колонки отделяет
   * только воздух, поэтому страница читается как ровная таблица снимков, а не
   * как набор ячеек в рамках.
   *
   * Колонки объявлены в CSS, ширина окна не измеряется: прежняя сетка тега
   * считала колонки в JavaScript, из-за чего сервер и клиент расходились и
   * консоль полнилась предупреждениями о гидрации.
   */
  defineProps<{
    articles: ArticleResponse[]
    /** Служебная строка карточки: части по порядку, по умолчанию автор · рубрика. */
    meta?: CardMeta
  }>()
</script>

<template>
  <div class="grid grid-cols-1 gap-x-12 gap-y-12 md:grid-cols-2 md:gap-y-16 lg:grid-cols-3">
    <ArticleBase v-for="article in articles" :key="article.id" :article="article" :meta="meta" scale="index" />
  </div>
</template>

<style scoped></style>
