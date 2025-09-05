<script setup lang="ts">
  import type { ArticleResponse } from "~/types/article"

  definePageMeta({
    layout: "default"
  })

  // Определяем ширину окна для адаптивного макета
  const { width } = useWindowSize()

  // Вычисляем количество колонок в зависимости от ширины экрана
  const getColumnsCount = computed(() => {
    if (width.value < 768) return 1 // md breakpoint
    if (width.value < 1024) return 2 // lg breakpoint
    return 3
  })

  const getItemStyles = (index: number) => {
    const columnsCount = getColumnsCount.value
    const styles = ["pt-8"]

    // Границы между рядами
    styles.push("border-zinc-200 dark:border-zinc-800")

    // if (columnsCount === 1) {}

    if (columnsCount === 2) {
      if (index % 2 === 0) styles.push("mr-6")
      else styles.push("px-6 border-l")
    }

    if (columnsCount === 3) {
      const positionInRow = index % 3
      if (positionInRow === 0) styles.push("mr-6")
      else if (positionInRow === 1) styles.push("px-6 border-l")
      else styles.push("pl-6 border-l")
    }
    return styles
  }

  // Моковые данные тега для тестирования
  const tag = {
    id: "1",
    name: "Технологии",
    slug: "technology",
    description: "Последние новости и статьи о технологиях, инновациях и цифровых трендах",
    color: "#3B82F6",
    articleCount: 45,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z"
  }

  // Моковые данные для 20 статей с этим тегом
  const articles: ArticleResponse[] = Array.from({ length: 20 }, (_, index) => ({
    id: `article-${index + 1}`,
    title: `Технологическая статья ${index + 1} - Инновации в IT`,
    slug: `article-${index + 1}-tech-innovations`,
    dek: `Это увлекательная статья о технологических инновациях ${index + 1}, которая исследует последние тренды в IT.`,
    excerpt: `Эта статья рассматривает современные технологические решения, их влияние на бизнес и общество, а также перспективы развития в ближайшем будущем.`,
    featuredImage: `https://picsum.photos/400/300?random=${index + 30}`,
    publishedAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
    author: {
      name: `Анна Петрова`,
      slug: `author-${index + 1}`,
      photoUrl: `https://picsum.photos/100/100?random=${index + 200}`
    },
    contentType: {
      name: "Технологии",
      slug: "technology"
    }
  }))
</script>

<template>
  <div>
    <HeaderTag :tag="tag" />
    <section class="px-8 sm:px-10 py-12">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 max-w-7xl m-auto">
        <div v-for="(article, index) in articles" :key="`tag-${index + 1}`" :class="getItemStyles(index)">
          <div
            :class="[
              'pb-8',
              'pb-8 border-b border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-400',

              'transition-colors duration-500'
            ]">
            <ArticleSmall :article="article" />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
