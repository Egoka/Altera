<script setup lang="ts">
  import type { CardMeta, SlotMedia, SlotSpec } from "~/types/layout"
  import type { ReadingArticle } from "~/types/reading"
  import {
    getLayout,
    mdColsOf,
    mdMediaFor,
    mdSpanFor,
    rowSpanFor,
    slotOrder,
    toGridStyle,
    validateLayout
  } from "~/utils/articleLayouts"

  const props = defineProps<{
    articles: ReadingArticle[]
    /** Идентификатор раскладки из реестра `articleLayouts`. */
    layout: string
    /** Служебная строка карточек: рубрика (по умолчанию) или дата — для лент внутри рубрики. */
    meta?: CardMeta
  }>()

  const layout = computed(() => getLayout(props.layout))

  // Кривая матрица ломает сетку молча: браузер отбрасывает grid-template-areas
  // целиком и без ошибки. В разработке падаем громко.
  if (import.meta.dev) {
    const found = getLayout(props.layout)
    const errors = found ? validateLayout(found) : [`раскладка «${props.layout}» не найдена в реестре`]
    if (errors.length) console.error("[ArticleGroup]", errors.join("; "))
  }

  /** Материалов ровно столько, сколько слотов у раскладки: тихого усечения нет. */
  const articles = computed(() => (layout.value ? props.articles.slice(0, layout.value.slots.length) : []))
  const slots = computed<SlotSpec[]>(() => layout.value?.slots ?? [])
  const gridStyles = computed(() => (layout.value ? toGridStyle(layout.value) : {}))
  const order = computed(() => (layout.value ? slotOrder(layout.value) : []))

  // resolveComponent, а не строка: строковое имя в <component :is> Nuxt не
  // резолвит — обёртки отрисовываются пустыми и без ошибки.
  const componentFor = (slot?: SlotSpec, media: SlotMedia | undefined = slot?.media) => {
    if (!slot) return resolveComponent("ArticleSmall")
    if (slot.variant === "small") return resolveComponent("ArticleSmall")
    if (slot.variant === "large" && media === "above") return resolveComponent("ArticleBase")
    return resolveComponent("ArticleLarge")
  }

  const mdCols = computed(() => (layout.value ? mdColsOf(layout.value) : 2))
  const mdSpan = (index: number) => (layout.value ? mdSpanFor(layout.value, order.value[index] ?? "") : 1)
  /** Композиция слота на средних экранах может отличаться от широких (`md.media`). */
  const mdMedia = (index: number) => (layout.value ? mdMediaFor(layout.value, order.value[index] ?? "") : undefined)
  /** Слот на несколько рядов встаёт по центру своей области, а не прижимается к верху. */
  const centered = (index: number) => (layout.value ? rowSpanFor(layout.value, order.value[index] ?? "") > 1 : false)
</script>

<template>
  <section v-if="layout" class="py-8" :data-layout="layout.id">
    <!-- Широкие экраны: раскладка целиком выводится из матрицы областей -->
    <div class="hidden lg:grid lg:gap-x-8 lg:gap-y-18" :style="gridStyles">
      <div
        v-for="(article, index) in articles"
        :key="article.id"
        :style="{ 'grid-area': order[index] }"
        class="w-full"
        :class="{ 'self-center': centered(index) }">
        <component :is="componentFor(slots[index])" :article="article" :scale="slots[index]?.scale" :meta="meta" />
      </div>
    </div>

    <!-- Средние экраны: спаны из раскладки, порядок слотов тот же -->
    <div
      class="hidden gap-x-8 gap-y-10 sm:grid lg:hidden"
      :style="{ 'grid-template-columns': `repeat(${mdCols}, minmax(0, 1fr))` }">
      <div
        v-for="(article, index) in articles"
        :key="`md-${article.id}`"
        class="w-full"
        :style="{ 'grid-column': `span ${Math.min(mdSpan(index), mdCols)}` }">
        <component :is="componentFor(slots[index], mdMedia(index))" :article="article" :meta="meta" />
      </div>
    </div>

    <!-- Узкие экраны: одна колонка, сложные раскладки схлопываются -->
    <div class="grid grid-cols-1 gap-y-10 sm:hidden">
      <div v-for="(article, index) in articles" :key="`sm-${article.id}`" class="w-full">
        <component :is="componentFor(slots[index])" :article="article" :meta="meta" />
      </div>
    </div>
  </section>
</template>
