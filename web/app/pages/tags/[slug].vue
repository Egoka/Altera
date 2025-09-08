<script setup lang="ts">
  import type { ArticleResponse } from "~/types/article"

  definePageMeta({
    layout: "default"
  })

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
      <GridTags :items="articles">
        <template #default="{ item: article }">
          <ArticleSmall :article="article" />
        </template>
      </GridTags>
    </section>
  </div>
</template>
