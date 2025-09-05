<script setup lang="ts">
  import type { ArticleListItem, Pagination } from "~/query/types"
  import type User from "~/types/user"

  definePageMeta({
    layout: "default"
  })

  const route = useRoute()
  const slug = route.params.slug as string

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

  // Моковые данные статей
  const mockArticles: ArticleListItem[] = [
    {
      id: "1",
      title: "The Way of the Strangers: Encounters With the Islamic State",
      slug: "way-of-strangers-islamic-state",
      dek: "A deep dive into the psychology and motivations of ISIS members ",
      excerpt:
        "An exploration of what drives individuals to join extremist organizations and how they justify their actions.",
      featuredImage: "https://picsum.photos/400/225?random=21",
      publishedAt: "2024-01-15T00:00:00Z",
      updatedAt: "2024-01-15T00:00:00Z",
      author: {
        name: "Graeme Wood",
        slug: "graeme-wood",
        photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&crop=face"
      },
      contentType: {
        name: "Article",
        slug: "article"
      },
      sectionTags: [
        { name: "Foreign Policy", slug: "foreign-policy" },
        { name: "Middle East", slug: "middle-east" }
      ]
    },
    {
      id: "2",
      title: "The Psychology of Extremism: Understanding Radicalization",
      slug: "psychology-extremism-radicalization",
      dek: "Examining the social and psychological factors that lead to radicalization",
      excerpt: "A comprehensive analysis of how ordinary people become radicalized and what can be done to prevent it.",
      featuredImage: "https://picsum.photos/400/225?random=22",
      publishedAt: "2024-01-10T00:00:00Z",
      updatedAt: "2024-01-10T00:00:00Z",
      author: {
        name: "Graeme Wood",
        slug: "graeme-wood",
        photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&crop=face"
      },
      contentType: {
        name: "Analysis",
        slug: "analysis"
      },
      sectionTags: [
        { name: "Psychology", slug: "psychology" },
        { name: "Security", slug: "security" }
      ]
    },
    {
      id: "3",
      title: "Reporting from Conflict Zones: Lessons Learned",
      slug: "reporting-conflict-zones-lessons",
      dek: "Personal experiences and insights from years of war reporting",
      excerpt: "Reflections on the challenges and rewards of reporting from some of the world's most dangerous places.",
      featuredImage: "https://picsum.photos/400/225?random=23",
      publishedAt: "2024-01-05T00:00:00Z",
      updatedAt: "2024-01-05T00:00:00Z",
      author: {
        name: "Graeme Wood",
        slug: "graeme-wood",
        photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&crop=face"
      },
      contentType: {
        name: "Memoir",
        slug: "memoir"
      },
      sectionTags: [
        { name: "Journalism", slug: "journalism" },
        { name: "War", slug: "war" }
      ]
    }
  ]

  // Моковые данные статистики
  const mockStats = {
    totalArticles: 15,
    articlesThisMonth: 3,
    popularTags: ["Foreign Policy", "Middle East", "Psychology", "Security", "Journalism"]
  }

  console.log("slug", slug)

  // Используем моковые данные вместо API запроса
  const user = computed<User>(() => mockUser)
  const articles = computed<ArticleListItem[]>(() => mockArticles)
  const pagination = computed<Pagination>(() => ({
    totalCount: mockArticles.length,
    totalPages: 1,
    currentPage: 1
  }))
  const stats = computed(() => mockStats)
</script>

<template>
  <div>
    <HeaderUser v-if="user" :user="user" />

    <!-- Статистика автора -->
    <!--    <div v-if="stats" class="max-w-7xl mx-auto px-8 sm:px-10 py-8">-->
    <!--      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">-->
    <!--        <div class="bg-zinc-50 dark:bg-zinc-800 p-6 rounded-lg">-->
    <!--          <div class="text-3xl font-bold text-zinc-900 dark:text-zinc-100">{{ stats.totalArticles }}</div>-->
    <!--          <div class="text-zinc-600 dark:text-zinc-400">Всего статей</div>-->
    <!--        </div>-->
    <!--        <div class="bg-zinc-50 dark:bg-zinc-800 p-6 rounded-lg">-->
    <!--          <div class="text-3xl font-bold text-zinc-900 dark:text-zinc-100">{{ stats.articlesThisMonth }}</div>-->
    <!--          <div class="text-zinc-600 dark:text-zinc-400">Статей в этом месяце</div>-->
    <!--        </div>-->
    <!--        <div class="bg-zinc-50 dark:bg-zinc-800 p-6 rounded-lg">-->
    <!--          <div class="text-3xl font-bold text-zinc-900 dark:text-zinc-100">{{ stats.popularTags?.length || 0 }}</div>-->
    <!--          <div class="text-zinc-600 dark:text-zinc-400">Популярные теги</div>-->
    <!--        </div>-->
    <!--      </div>-->
    <!--    </div>-->

    <section class="px-8 sm:px-10 py-12">
      <div class="grid gap-8 max-w-3xl m-auto divide-y divide-zinc-200 dark:divide-zinc-800">
        <div v-for="(article, index) in articles" :key="`featured-${index + 1}`" class="pb-8">
          <ArticleAuthor :article="article" />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped></style>
