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
    description:
      "Graeme Wood is a distinguished staff writer at The Atlantic and the acclaimed author of The Way of the Strangers: Encounters With the Islamic State, a groundbreaking work that delves deep into the psychology and motivations of ISIS members. He joined the magazine in 2006 after an extraordinary journey that saw him working as a translator, courier, and bootlegger in the dangerous regions of northern Iraq during some of the most tumultuous periods of the Iraq War. His early experiences in conflict zones shaped his unique perspective on international affairs and human nature. Since joining The Atlantic, Wood has established himself as one of the publication's most intrepid foreign correspondents, reporting from every continent except Antarctica on subjects as diverse as foreign policy, international security, cultural anthropology, and even professional wrestling. His reporting has taken him to war zones in Syria, Yemen, and Libya, where he has interviewed everyone from government officials to rebel leaders, providing readers with unprecedented insights into complex geopolitical situations. Wood's expertise extends beyond traditional journalism; he has conducted extensive research on radicalization processes, religious extremism, and the social dynamics that drive individuals toward violent ideologies. His work has been recognized with numerous awards and has influenced policy discussions at the highest levels of government. He is a respected member of the Council on Foreign Relations, where he contributes to important discussions on international security and foreign policy. Additionally, he serves as a contributing editor at The New Republic, where he continues to shape public discourse on critical global issues. Wood's writing is characterized by its depth, nuance, and willingness to explore uncomfortable truths about human nature and international relations. Graeme Wood is a distinguished staff writer at The Atlantic and the acclaimed author of The Way of the Strangers: Encounters With the Islamic State, a groundbreaking work that delves deep into the psychology and motivations of ISIS members. He joined the magazine in 2006 after an extraordinary journey that saw him working as a translator, courier, and bootlegger in the dangerous regions of northern Iraq during some of the most tumultuous periods of the Iraq War. His early experiences in conflict zones shaped his unique perspective on international affairs and human nature. Since joining The Atlantic, Wood has established himself as one of the publication's most intrepid foreign correspondents, reporting from every continent except Antarctica on subjects as diverse as foreign policy, international security, cultural anthropology, and even professional wrestling. His reporting has taken him to war zones in Syria, Yemen, and Libya, where he has interviewed everyone from government officials to rebel leaders, providing readers with unprecedented insights into complex geopolitical situations. Wood's expertise extends beyond traditional journalism; he has conducted extensive research on radicalization processes, religious extremism, and the social dynamics that drive individuals toward violent ideologies. His work has been recognized with numerous awards and has influenced policy discussions at the highest levels of government. He is a respected member of the Council on Foreign Relations, where he contributes to important discussions on international security and foreign policy. Additionally, he serves as a contributing editor at The New Republic, where he continues to shape public discourse on critical global issues. Wood's writing is characterized by its depth, nuance, and willingness to explore uncomfortable truths about human nature and international relations.",
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
      <div class="grid gap-8 max-w-3xl m-auto">
        <div
          v-for="(article, index) in articles"
          :key="`featured-${index + 1}`"
          :class="[
            'pb-8 border-b',
            'border-zinc-200 dark:border-zinc-800',
            'hover:border-zinc-400 dark:hover:border-zinc-400',
            'transition-colors duration-500'
          ]">
          <ArticleType :article="article" />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped></style>
