<script setup lang="ts">
  import type ContentType from "~/types/contentType"
  import type { ArticleResponse } from "~/types/article"
  import { DEMO_DEMANDED, DEMO_LATEST } from "~/utils/demoFeed"
  import { buildFeedGroups } from "~/utils/feedGroups"
  import { SECTION_RHYTHM } from "~/utils/feedRhythm"

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

  /**
   * Демо-лента: одна страница из 24 материалов (`section-feed.md` §5), взятых из
   * материалов главной с подстановкой рубрики. Даты детерминированы — по дню назад
   * от фиксированной точки, чтобы лента по новизне выглядела одинаково при каждом
   * запуске. Группы собирает `buildFeedGroups` по ритму рубрики.
   */
  const PAGE_SIZE = 24
  const firstDay = Date.UTC(2026, 8, 13, 12)
  const articles: ArticleResponse[] = [...DEMO_LATEST, ...DEMO_DEMANDED].slice(0, PAGE_SIZE).map((article, index) => ({
    ...article,
    id: `section-${index + 1}`,
    publishedAt: new Date(firstDay - index * 24 * 60 * 60 * 1000).toISOString(),
    contentType: { name: contentType.name, slug: contentType.slug }
  }))
  const groups = buildFeedGroups(articles, SECTION_RHYTHM)
</script>

<template>
  <div>
    <HeaderType :contentType="contentType" />
    <!-- Список рубрики — группы реестра раскладок во всю ширину контейнера, служебная
         строка карточек показывает дату: рубрика и так в шапке. -->
    <section class="pt-4 pb-16">
      <ArticleGroup
        v-for="group in groups"
        :key="group.id"
        :articles="group.articles"
        :layout="group.layout"
        :meta="['author', 'date']" />
    </section>
  </div>
</template>

<style scoped></style>
