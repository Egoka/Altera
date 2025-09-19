<script setup lang="ts">
  import type { ArticleResponse } from "~/types/article"

  const props = defineProps<{
    articles: ArticleResponse[]
    position?: "left" | "center" | "right"
  }>()
  const MAX_COUNT = 5
  const articles = computed(() => props.articles.slice(0, MAX_COUNT) || [])
  const position = computed(() => props.position ?? "left")

  // Определяем, нужен ли разделитель для блока
  const needsBorder = (index: number) => {
    const area = getItemArea(index)
    const count = articles.value.length

    if (position.value === "right") {
      // При position right: разделитель нужен элементам в левой части (не в области 'a')
      if (count === 5 || count === 4) return area !== "a"
      if (count === 3) return area !== "a"
      if (count === 2) return area !== "a"
      return false
    } else if (position.value === "center") {
      // При position center: разделитель нужен элементам, которые не находятся в последней колонке
      if (count === 5 || count === 4) return area !== "d" && area !== "e"
      if (count === 3) return area !== "b" && area !== "c"
      if (count === 2) return area !== "b"
      return false
    } else {
      // При position left: разделитель нужен элементам, которые не находятся в последней колонке
      if (count === 5 || count === 4) return area !== "d" && area !== "e"
      if (count === 3) return area === "a"
      if (count === 2) return area === "a"
      return false
    }
  }

  // Вычисляем стили сетки в зависимости от количества статей
  const gridStyles = computed(() => {
    const count = articles.value.length
    const layouts = {
      5: {
        left: { cols: 4, areas: `"a a b d"\n"a a c e"` },
        center: { cols: 4, areas: `"b a a d"\n"c a a e"` },
        right: { cols: 4, areas: `"b d a a"\n"c e a a"` }
      },
      4: {
        left: { cols: 4, areas: `"a a b d"\n"a a c d"` },
        center: { cols: 4, areas: `"b a a d"\n"c a a d"` },
        right: { cols: 4, areas: `"b d a a"\n"c d a a"` }
      },
      3: {
        left: { cols: 3, areas: `"a a b"\n"a a c"` },
        center: { cols: 3, areas: `"a a b"\n"a a c"` },
        right: { cols: 3, areas: `"b a a"\n"c a a"` }
      },
      2: {
        left: { cols: 3, areas: `"a a b"\n"a a b"` },
        center: { cols: 3, areas: `"a a b"\n"a a b"` },
        right: { cols: 3, areas: `"b a a"\n"b a a"` }
      }
    }

    const layout = layouts[count as keyof typeof layouts]
    if (!layout) {
      return {
        "grid-template-columns": "1fr",
        "grid-template-rows": "1fr",
        "grid-template-areas": '"a"'
      }
    }

    const currentLayout = layout[position.value as keyof typeof layout] || layout.left

    return {
      "grid-template-columns": `repeat(${currentLayout.cols}, 1fr)`,
      "grid-template-rows": "repeat(2, 1fr)",
      "grid-template-areas": currentLayout.areas
    }
  })

  // Вычисляем grid-area для каждого блока
  const getItemArea = (index: number) => {
    const count = articles.value.length
    const areaMappings = {
      5: ["a", "b", "c", "d", "e"],
      4: ["a", "b", "c", "d"],
      3: ["a", "b", "c"],
      2: ["a", "b"]
    }

    return areaMappings[count as keyof typeof areaMappings]?.[index] ?? "a"
  }
</script>

<template>
  <section class="py-12 border-b border-zinc-200 dark:border-zinc-700">
    <div class="hidden lg:grid lg:gap-x-6" :style="gridStyles">
      <div
        v-for="(article, index) in articles"
        :key="article.id"
        :style="{ 'grid-area': getItemArea(index) }"
        :class="`w-full ${needsBorder(index) ? 'border-r border-zinc-200 dark:border-zinc-700 pr-6' : ''}`">
        <ArticleLarge v-if="index === 0" :article="article" class="m-auto max-w-3xl" />
        <ArticleSmall
          v-else
          :article
          :class="!(index % 2) ? 'pt-4 mt-2 border-t border-zinc-200 dark:border-zinc-700' : ''" />
      </div>
    </div>

    <div class="hidden sm:grid lg:hidden grid-cols-2 gap-x-4">
      <div
        v-for="(article, index) in articles"
        :key="`tablet-${article.id}`"
        :class="`w-full ${index === 0 ? 'col-span-2 ' : ''}${index !== 0 && index % 2 ? 'pr-4 border-r border-zinc-200 dark:border-zinc-700' : ''}`">
        <ArticleLarge
          v-if="index === 0"
          :article
          class="m-auto max-w-3xl pb-6 mb-6 border-b border-zinc-200 dark:border-zinc-700" />
        <ArticleSmall
          v-else
          :article
          :class="`${4 === index || 3 === index ? 'pt-4 mt-2 border-t border-zinc-200 dark:border-zinc-700' : ''}`" />
      </div>
    </div>

    <div class="grid sm:hidden grid-cols-1">
      <div v-for="(article, index) in articles" :key="`mobile-${article.id}`" class="w-full">
        <ArticleLarge v-if="index === 0" :article="article" class="m-auto max-w-md" />
        <ArticleSmall v-else :article="article" class="pt-4 mt-2 border-t border-zinc-200 dark:border-zinc-700" />
      </div>
    </div>
  </section>
</template>
