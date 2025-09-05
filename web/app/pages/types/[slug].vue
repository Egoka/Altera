<script setup lang="ts">
  import type ContentType from "~/types/contentType"
  import type { ArticleResponse } from "~/types/article"

  definePageMeta({
    layout: "default"
  })

  // Моковые данные для демонстрации
  const contentType: ContentType = {
    id: "1",
    name: "National Security",
    slug: "national-security",
    description: "The Atlantic's coverage of national security, military intelligence, global conflict, and more",
    iconUrl:
      // "images/Art.png",
      // "images/Sport.png",
      "https://cdn.theatlantic.com/thumbor/bsofsE3P6DEt6k04rWoKU6v9kD8=/0x0:960x960/200x200/media/img/collections/icon/Layer_1_1/original.png",
    order: 1,
    status: "active",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z"
  }

  // Моковые данные для 30 статей
  const articles: ArticleResponse[] = Array.from({ length: 30 }, (_, index) => ({
    id: `article-${index + 1}`,
    title: `Article Title ${index + 1} - National Security Analysis`,
    slug: `article-${index + 1}-national-security-analysis`,
    dek: `This is a compelling dek for article ${index + 1} that provides context about national security implications.`,
    excerpt: `This article explores the complex dynamics of national security in the modern world, examining various threats and strategic responses that shape our global security landscape.`,
    featuredImage: `https://picsum.photos/400/300?random=${index + 1}`,
    publishedAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
    author: {
      name: `Анна Петрова`,
      slug: `author-${index + 1}`,
      photoUrl: `https://picsum.photos/100/100?random=${index + 100}`
    },
    contentType: {
      name: contentType.name,
      slug: contentType.slug
    }
  }))
</script>

<template>
  <div>
    <HeaderType :contentType="contentType" />
    <section class="px-8 sm:px-10 py-12">
      <div class="grid gap-8 max-w-3xl m-auto divide-y divide-zinc-200 dark:divide-zinc-800">
        <div v-for="(article, index) in articles" :key="`featured-${index + 1}`" class="pb-8">
          <ArticleType :article="article" />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped></style>
