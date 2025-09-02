<script setup lang="ts">
  import type { PopularArticleData } from "~/types/article"

  // Props для тестирования (опционально)
  interface Props {
    articles?: PopularArticleData[]
  }

  const props = withDefaults(defineProps<Props>(), {
    articles: () => []
  })

  // Статичные тестовые данные для популярных статей
  const mockPopularArticles = [
    {
      id: "1",
      title: "Микросервисная архитектура: от теории к практике",
      slug: "microservices-architecture-practice",
      author: {
        name: "Дмитрий Соколов",
        slug: "dmitry-sokolov"
      }
    },
    {
      id: "2",
      title: "React 18: новые возможности и лучшие практики",
      slug: "react-18-new-features",
      author: {
        name: "Мария Иванова",
        slug: "maria-ivanova"
      }
    },
    {
      id: "3",
      title: "DevOps культура: как построить эффективную команду",
      slug: "devops-culture-effective-team",
      author: {
        name: "Сергей Козлов",
        slug: "sergey-kozlov"
      }
    },
    {
      id: "4",
      title: "Безопасность веб-приложений в 2024 году",
      slug: "web-security-2024",
      author: {
        name: "Елена Сидорова",
        slug: "elena-sidorova"
      }
    },
    {
      id: "5",
      title: "Искусственный интеллект в современной разработке",
      slug: "ai-in-modern-development",
      author: {
        name: "Анна Петрова",
        slug: "anna-petrova"
      }
    },
    {
      id: "6",
      title: "Kubernetes в production: опыт внедрения",
      slug: "kubernetes-production-experience",
      author: {
        name: "Александр Волков",
        slug: "alexander-volkov"
      }
    },
    {
      id: "7",
      title: "GraphQL vs REST: когда использовать каждый подход",
      slug: "graphql-vs-rest-comparison",
      author: {
        name: "Ольга Смирнова",
        slug: "olga-smirnova"
      }
    },
    {
      id: "8",
      title: "TypeScript 5.0: что нового в последней версии",
      slug: "typescript-5-new-features",
      author: {
        name: "Павел Федоров",
        slug: "pavel-fedorov"
      }
    },
    {
      id: "9",
      title: "Мониторинг и логирование в Node.js приложениях",
      slug: "nodejs-monitoring-logging",
      author: {
        name: "Наталья Кузнецова",
        slug: "natalia-kuznetsova"
      }
    },
    {
      id: "10",
      title: "Frontend архитектура для крупных проектов",
      slug: "frontend-architecture-large-projects",
      author: {
        name: "Игорь Морозов",
        slug: "igor-morozov"
      }
    }
  ]

  // TODO: В будущем заменить на GraphQL запрос
  // const { data: popularData } = await useAsyncQuery(GET_POPULAR_ARTICLES)
  // const articles = computed(() => props.articles.length > 0 ? props.articles : popularData.value?.popularArticles || [])

  // Используем тестовые данные
  const articles = computed(() => (props.articles.length > 0 ? props.articles : mockPopularArticles))
</script>

<template>
  <section class="latest-articles pt-8">
    <div class="mx-auto px-8 max-w-7xl">
      <h2 class="font-waterway text-3xl font-bold tracking-widest sm:mb-8 text-gray-900 dark:text-white">Популярное</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 divide-gray-200 dark:divide-gray-700">
        <div
          v-for="(article, index) in articles"
          :key="article.id"
          class="flex items-start py-6 border-gray-200 dark:border-gray-800"
          :class="[!(index % 2) ? 'md:pr-6 lg:pr-8 md:border-r' : 'md:pl-6 lg:pl-8']">
          <ArticleText :index :article />
        </div>
      </div>

      <div v-if="articles.length === 0" class="animate-pulse mt-5">
        <div class="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 divide-gray-200 dark:divide-gray-700">
          <div
            v-for="n in 10"
            :key="n"
            class="flex items-start py-6 space-x-3 border-gray-200 dark:border-gray-800"
            :class="[n % 2 ? 'md:pr-6 lg:pr-8 md:border-r' : 'md:pl-6 lg:pl-8']">
            <div class="min-w-14 w-6 h-10 bg-gray-200 dark:bg-gray-700 rounded flex-shrink-0"></div>
            <div class="flex-1 space-y-2">
              <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
              <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped></style>
