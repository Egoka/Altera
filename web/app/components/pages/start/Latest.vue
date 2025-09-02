<script setup lang="ts">
  // Статичные тестовые данные для Latest Articles (Последние статьи)
  const latestArticles = [
    {
      id: "6",
      title: "TypeScript 5.0: новые возможности и улучшения",
      slug: "typescript-5-new-features",
      dek: "Обзор ключевых нововведений в TypeScript 5.0",
      excerpt: "Изучаем новые возможности TypeScript 5.0: декораторы, const type parameters и другие улучшения.",
      featuredImage: "https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=800&h=400&fit=crop",
      publishedAt: "2024-01-20T08:30:00Z",
      author: {
        name: "Алексей Волков",
        slug: "alexey-volkov",
        photoUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "Frontend",
        slug: "frontend"
      },
      sectionTags: [
        { name: "TypeScript", slug: "typescript" },
        { name: "JavaScript", slug: "javascript" }
      ]
    },
    {
      id: "7",
      title: "Docker контейнеризация: от основ до продвинутых техник",
      slug: "docker-containerization-advanced",
      dek: "Полное руководство по Docker",
      excerpt: "От базовых концепций до продвинутых техник оптимизации Docker контейнеров.",
      featuredImage: "https://images.unsplash.com/photo-1605745341112-85968b19335b?w=800&h=400&fit=crop",
      publishedAt: "2024-01-18T15:45:00Z",
      author: {
        name: "Ольга Морозова",
        slug: "olga-morozova",
        photoUrl: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "DevOps",
        slug: "devops"
      },
      sectionTags: [
        { name: "Docker", slug: "docker" },
        { name: "Контейнеризация", slug: "containerization" }
      ]
    },
    {
      id: "8",
      title: "GraphQL vs REST: когда что использовать",
      slug: "graphql-vs-rest-comparison",
      dek: "Сравнение подходов к API",
      excerpt: "Детальное сравнение GraphQL и REST API с практическими примерами использования.",
      featuredImage: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&h=400&fit=crop",
      publishedAt: "2024-01-16T12:20:00Z",
      author: {
        name: "Игорь Смирнов",
        slug: "igor-smirnov",
        photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "Backend",
        slug: "backend"
      },
      sectionTags: [
        { name: "GraphQL", slug: "graphql" },
        { name: "REST", slug: "rest" },
        { name: "API", slug: "api" }
      ]
    },
    {
      id: "9",
      title: "Vue.js 3 Composition API: полное руководство",
      slug: "vue-3-composition-api-guide",
      dek: "Освоение Composition API",
      excerpt: "Подробное руководство по использованию Composition API в Vue.js 3 с практическими примерами.",
      featuredImage: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&h=400&fit=crop",
      publishedAt: "2024-01-14T10:15:00Z",
      author: {
        name: "Екатерина Новикова",
        slug: "ekaterina-novikova",
        photoUrl: "https://images.unsplash.com/photo-1494790108755-2616b612b786?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "Frontend",
        slug: "frontend"
      },
      sectionTags: [
        { name: "Vue.js", slug: "vuejs" },
        { name: "JavaScript", slug: "javascript" }
      ]
    },
    {
      id: "10",
      title: "Kubernetes для начинающих",
      slug: "kubernetes-beginners-guide",
      dek: "Основы оркестрации контейнеров",
      excerpt: "Пошаговое руководство по развертыванию и управлению приложениями в Kubernetes.",
      featuredImage: "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=800&h=400&fit=crop",
      publishedAt: "2024-01-12T16:30:00Z",
      author: {
        name: "Денис Лебедев",
        slug: "denis-lebedev",
        photoUrl: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "DevOps",
        slug: "devops"
      },
      sectionTags: [
        { name: "Kubernetes", slug: "kubernetes" },
        { name: "Оркестрация", slug: "orchestration" }
      ]
    },
    {
      id: "11",
      title: "Node.js производительность: оптимизация и мониторинг",
      slug: "nodejs-performance-optimization",
      dek: "Техники повышения производительности",
      excerpt: "Практические методы оптимизации производительности Node.js приложений.",
      featuredImage: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&h=400&fit=crop",
      publishedAt: "2024-01-10T14:00:00Z",
      author: {
        name: "Андрей Козлов",
        slug: "andrey-kozlov",
        photoUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "Backend",
        slug: "backend"
      },
      sectionTags: [
        { name: "Node.js", slug: "nodejs" },
        { name: "Производительность", slug: "performance" }
      ]
    },
    {
      id: "12",
      title: "CSS Grid и Flexbox: современная верстка",
      slug: "css-grid-flexbox-modern-layout",
      dek: "Освоение современных CSS техник",
      excerpt: "Подробное руководство по использованию CSS Grid и Flexbox для создания адаптивных макетов.",
      featuredImage: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=400&fit=crop",
      publishedAt: "2024-01-08T11:45:00Z",
      author: {
        name: "Наталья Соколова",
        slug: "natalya-sokolova",
        photoUrl: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "Frontend",
        slug: "frontend"
      },
      sectionTags: [
        { name: "CSS", slug: "css" },
        { name: "Верстка", slug: "layout" }
      ]
    },
    {
      id: "13",
      title: "PostgreSQL оптимизация запросов",
      slug: "postgresql-query-optimization",
      dek: "Повышение производительности БД",
      excerpt: "Техники оптимизации запросов PostgreSQL для улучшения производительности приложений.",
      featuredImage: "https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=800&h=400&fit=crop",
      publishedAt: "2024-01-06T09:20:00Z",
      author: {
        name: "Михаил Петров",
        slug: "mikhail-petrov",
        photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "Базы данных",
        slug: "databases"
      },
      sectionTags: [
        { name: "PostgreSQL", slug: "postgresql" },
        { name: "SQL", slug: "sql" }
      ]
    },
    {
      id: "14",
      title: "Git workflow: эффективные стратегии ветвления",
      slug: "git-workflow-branching-strategies",
      dek: "Лучшие практики Git",
      excerpt: "Обзор популярных стратегий ветвления Git и их применение в реальных проектах.",
      featuredImage: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=800&h=400&fit=crop",
      publishedAt: "2024-01-04T13:15:00Z",
      author: {
        name: "Татьяна Иванова",
        slug: "tatyana-ivanova",
        photoUrl: "https://images.unsplash.com/photo-1494790108755-2616b612b786?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "Инструменты",
        slug: "tools"
      },
      sectionTags: [
        { name: "Git", slug: "git" },
        { name: "Версионирование", slug: "versioning" }
      ]
    },
    {
      id: "15",
      title: "Webpack 5: настройка и оптимизация",
      slug: "webpack-5-configuration-optimization",
      dek: "Современная сборка проектов",
      excerpt: "Подробное руководство по настройке и оптимизации Webpack 5 для современных веб-проектов.",
      featuredImage: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=400&fit=crop",
      publishedAt: "2024-01-02T16:00:00Z",
      author: {
        name: "Сергей Морозов",
        slug: "sergey-morozov",
        photoUrl: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "Инструменты",
        slug: "tools"
      },
      sectionTags: [
        { name: "Webpack", slug: "webpack" },
        { name: "Сборка", slug: "build" }
      ]
    },
    {
      id: "16",
      title: "React Hooks: продвинутые паттерны",
      slug: "react-hooks-advanced-patterns",
      dek: "Создание кастомных хуков",
      excerpt: "Изучаем продвинутые паттерны использования React Hooks и создание кастомных хуков.",
      featuredImage: "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=800&h=400&fit=crop",
      publishedAt: "2024-01-01T10:30:00Z",
      author: {
        name: "Анна Сидорова",
        slug: "anna-sidorova",
        photoUrl: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "Frontend",
        slug: "frontend"
      },
      sectionTags: [
        { name: "React", slug: "react" },
        { name: "Hooks", slug: "hooks" }
      ]
    },
    {
      id: "17",
      title: "MongoDB агрегации: сложные запросы",
      slug: "mongodb-aggregation-complex-queries",
      dek: "Мощные возможности MongoDB",
      excerpt: "Изучаем возможности MongoDB Aggregation Framework для выполнения сложных запросов.",
      featuredImage: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&h=400&fit=crop",
      publishedAt: "2023-12-30T14:45:00Z",
      author: {
        name: "Дмитрий Волков",
        slug: "dmitry-volkov",
        photoUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "Базы данных",
        slug: "databases"
      },
      sectionTags: [
        { name: "MongoDB", slug: "mongodb" },
        { name: "NoSQL", slug: "nosql" }
      ]
    },
    {
      id: "18",
      title: "Jest тестирование: от основ до продвинутых техник",
      slug: "jest-testing-advanced-techniques",
      dek: "Полное покрытие тестами",
      excerpt: "Подробное руководство по тестированию с Jest: от базовых тестов до продвинутых техник.",
      featuredImage: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=400&fit=crop",
      publishedAt: "2023-12-28T11:20:00Z",
      author: {
        name: "Елена Козлова",
        slug: "elena-kozlova",
        photoUrl: "https://images.unsplash.com/photo-1494790108755-2616b612b786?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "Тестирование",
        slug: "testing"
      },
      sectionTags: [
        { name: "Jest", slug: "jest" },
        { name: "Тестирование", slug: "testing" }
      ]
    },
    {
      id: "19",
      title: "Redis кэширование: стратегии и паттерны",
      slug: "redis-caching-strategies-patterns",
      dek: "Оптимизация производительности",
      excerpt: "Изучаем различные стратегии кэширования с Redis и их применение в реальных проектах.",
      featuredImage: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=800&h=400&fit=crop",
      publishedAt: "2023-12-26T15:10:00Z",
      author: {
        name: "Игорь Морозов",
        slug: "igor-morozov",
        photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "Backend",
        slug: "backend"
      },
      sectionTags: [
        { name: "Redis", slug: "redis" },
        { name: "Кэширование", slug: "caching" }
      ]
    },
    {
      id: "20",
      title: "WebSocket реального времени",
      slug: "websocket-real-time-communication",
      dek: "Двусторонняя связь в веб-приложениях",
      excerpt: "Практическое руководство по реализации WebSocket для создания приложений реального времени.",
      featuredImage: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=400&fit=crop",
      publishedAt: "2023-12-24T12:30:00Z",
      author: {
        name: "Мария Лебедева",
        slug: "maria-lebedeva",
        photoUrl: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=face"
      },
      contentType: {
        name: "Backend",
        slug: "backend"
      },
      sectionTags: [
        { name: "WebSocket", slug: "websocket" },
        { name: "Real-time", slug: "realtime" }
      ]
    }
  ]

  // Конфигурация групп статей: количество статей и позиция для каждой группы
  const groupConfig = [
    { count: 5, position: "center" as const },
    { count: 3, position: "left" as const },
    { count: 5, position: "right" as const },
    { count: 3, position: "center" as const },
    { count: 3, position: "left" as const },
    { count: 2, position: "right" as const }
  ]

  // Функция для распределения статей по группам согласно конфигурации
  const distributeArticles = (
    articles: any[],
    config: Array<{ count: number; position: "center" | "left" | "right" }>
  ) => {
    const groups = []
    let currentIndex = 0

    for (const group of config) {
      if (currentIndex >= articles.length) break

      const groupArticles = articles.slice(currentIndex, currentIndex + group.count)
      groups.push({
        articles: groupArticles,
        position: group.position
      })

      currentIndex += group.count
    }

    return groups
  }

  // Распределяем статьи по группам
  const articleGroups = distributeArticles(latestArticles, groupConfig)
</script>

<template>
  <section class="latest-articles pt-8">
    <div class="mx-auto px-8 max-w-7xl">
      <h2 class="font-waterway text-3xl font-bold tracking-widest sm:mb-8 text-gray-900 dark:text-white">Новое</h2>
      <ArticleGroup
        v-for="(group, index) in articleGroups"
        :key="index"
        :articles="group.articles"
        :position="group.position" />
    </div>
  </section>
</template>
