<script setup lang="ts">
  import type { ArticleResponse } from "~/types/article"
  import type User from "~/types/user"
  import { formatArticleMonth } from "~/utils/articleDate"
  import { DEMO_DEMANDED, DEMO_LATEST } from "~/utils/demoFeed"
  import { buildFeedGroups, groupByMonth } from "~/utils/feedGroups"
  import { AUTHOR_RHYTHM } from "~/utils/feedRhythm"

  definePageMeta({
    layout: "default"
  })

  // Моковые данные пользователя для тестирования
  const mockUser: User = {
    id: "1",
    name: "Кот",
    email: "graeme.wood@example.com",
    bio: "Graeme Wood is a distinguished staff writer at The Atlantic and the acclaimed author of The Way of the Strangers: Encounters With the Islamic State, a groundbreaking work that delves deep into the psychology and motivations of ISIS members. He joined the magazine in 2006 after an extraordinary journey that saw him working as a translator, courier, and bootlegger in the dangerous regions of northern Iraq during some of the most tumultuous periods of the Iraq War. His early experiences in conflict zones shaped his unique perspective on international affairs and human nature. Since joining The Atlantic, Wood has established himself as one of the publication's most intrepid foreign correspondents, reporting from every continent except Antarctica on subjects as diverse as foreign policy, international security, cultural anthropology, and even professional wrestling. His reporting has taken him to war zones in Syria, Yemen, and Libya, where he has interviewed everyone from government officials to rebel leaders, providing readers with unprecedented insights into complex geopolitical situations. Wood's expertise extends beyond traditional journalism; he has conducted extensive research on radicalization processes, religious extremism, and the social dynamics that drive individuals toward violent ideologies. His work has been recognized with numerous awards and has influenced policy discussions at the highest levels of government. He is a respected member of the Council on Foreign Relations, where he contributes to important discussions on international security and foreign policy. Additionally, he serves as a contributing editor at The New Republic, where he continues to shape public discourse on critical global issues. Wood's writing is characterized by its depth, nuance, and willingness to explore uncomfortable truths about human nature and international relations. Graeme Wood is a distinguished staff writer at The Atlantic and the acclaimed author of The Way of the Strangers: Encounters With the Islamic State, a groundbreaking work that delves deep into the psychology and motivations of ISIS members. He joined the magazine in 2006 after an extraordinary journey that saw him working as a translator, courier, and bootlegger in the dangerous regions of northern Iraq during some of the most tumultuous periods of the Iraq War. His early experiences in conflict zones shaped his unique perspective on international affairs and human nature. Since joining The Atlantic, Wood has established himself as one of the publication's most intrepid foreign correspondents, reporting from every continent except Antarctica on subjects as diverse as foreign policy, international security, cultural anthropology, and even professional wrestling. His reporting has taken him to war zones in Syria, Yemen, and Libya, where he has interviewed everyone from government officials to rebel leaders, providing readers with unprecedented insights into complex geopolitical situations. Wood's expertise extends beyond traditional journalism; he has conducted extensive research on radicalization processes, religious extremism, and the social dynamics that drive individuals toward violent ideologies. His work has been recognized with numerous awards and has influenced policy discussions at the highest levels of government. He is a respected member of the Council on Foreign Relations, where he contributes to important discussions on international security and foreign policy. Additionally, he serves as a contributing editor at The New Republic, where he continues to shape public discourse on critical global issues. Wood's writing is characterized by its depth, nuance, and willingness to explore uncomfortable truths about human nature and international relations.",
    // bio: "<h3>Professional Background</h3><p>Graeme Wood is a <strong>distinguished staff writer</strong> at <em>The Atlantic</em> and the acclaimed author of <em>The Way of the Strangers: Encounters With the Islamic State</em>, a groundbreaking work that delves deep into the psychology and motivations of ISIS members.</p><h3>Early Career & Experience</h3><p>He joined the magazine in 2006 after an extraordinary journey that saw him working as a <strong>translator, courier, and bootlegger</strong> in the dangerous regions of northern Iraq during some of the most tumultuous periods of the Iraq War. His early experiences in conflict zones shaped his unique perspective on international affairs and human nature.</p><h3>International Reporting</h3><p>Since joining <em>The Atlantic</em>, Wood has established himself as one of the publication's most <strong>intrepid foreign correspondents</strong>, reporting from every continent except Antarctica on subjects as diverse as:</p><ul><li>Foreign policy and international relations</li><li>International security and conflict zones</li><li>Cultural anthropology and social dynamics</li><li>Professional wrestling and popular culture</li></ul><h3>War Zone Coverage</h3><p>His reporting has taken him to war zones in <strong>Syria, Yemen, and Libya</strong>, where he has interviewed everyone from government officials to rebel leaders, providing readers with unprecedented insights into complex geopolitical situations.</p><h3>Research & Expertise</h3><p>Wood's expertise extends beyond traditional journalism; he has conducted extensive research on:</p><ul><li>Radicalization processes and prevention</li><li>Religious extremism and its root causes</li><li>Social dynamics driving violent ideologies</li><li>Psychological factors in terrorism</li></ul><h3>Recognition & Influence</h3><p>His work has been recognized with <strong>numerous awards</strong> and has influenced policy discussions at the highest levels of government. He is a respected member of the <em>Council on Foreign Relations</em>, where he contributes to important discussions on international security and foreign policy.</p><h3>Current Role</h3><p>Additionally, he serves as a <strong>contributing editor</strong> at <em>The New Republic</em>, where he continues to shape public discourse on critical global issues.</p><h3>Writing Style</h3><p>Wood's writing is characterized by its <strong>depth, nuance, and willingness</strong> to explore uncomfortable truths about human nature and international relations.</p>",
    photoUrl: "https://i.pinimg.com/736x/ce/5e/f8/ce5ef87618c1299f6730f4ee196a14ee.jpg",
    role: "user",
    slug: "graeme-wood",
    socialLinks: {
      twitter: "https://twitter.com/graemewood",
      linkedin: "https://linkedin.com/in/graemewood"
    },
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  }

  // Используем моковые данные вместо API запроса
  const user = computed<User>(() => mockUser)

  /**
   * Демо-лента автора: одна страница из 24 материалов главной с подстановкой автора
   * из мока; даты детерминированы — по дню назад от фиксированной точки, так что
   * хроника делится на два месяца. Каждый месяц собирается своим кругом ритма
   * автора из однорядных раскладок (`author.md` §5).
   */
  const PAGE_SIZE = 24
  const firstDay = Date.UTC(2026, 8, 13, 12)
  const articles: ArticleResponse[] = [...DEMO_LATEST, ...DEMO_DEMANDED].slice(0, PAGE_SIZE).map((article, index) => ({
    ...article,
    id: `author-${index + 1}`,
    publishedAt: new Date(firstDay - index * 24 * 60 * 60 * 1000).toISOString(),
    author: { name: mockUser.name, slug: mockUser.slug, photoUrl: mockUser.photoUrl }
  }))

  const { locale } = useI18n()
  const months = computed(() =>
    groupByMonth(articles, (article) => article.publishedAt).map((month) => ({
      key: month.key,
      label: formatArticleMonth(month.key, locale.value),
      groups: buildFeedGroups(month.items, AUTHOR_RHYTHM)
    }))
  )
</script>

<template>
  <div>
    <HeaderUser v-if="user" :user="user" />

    <!-- Хроника автора: месяцы публикации с подписью и линейкой, внутри — однорядные
         группы, порядок чтения совпадает с порядком по дате; в служебной строке
         рубрика и дата, автор — в шапке. -->
    <section class="pt-4 pb-16">
      <!-- Первый месяц без верхней линейки: его уже отделяет линейка шапки автора -->
      <section
        v-for="month in months"
        :key="month.key"
        class="mt-10 border-t border-zinc-200 pt-4 first:mt-0 first:border-0 first:pt-0 dark:border-zinc-800">
        <h2
          v-if="month.label"
          class="font-sans text-xs/6 font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
          {{ month.label }}
        </h2>
        <ArticleGroup
          v-for="group in month.groups"
          :key="group.id"
          :articles="group.articles"
          :layout="group.layout"
          :meta="['type', 'date']" />
      </section>
    </section>
  </div>
</template>

<style scoped></style>
