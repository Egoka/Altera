<script setup lang="ts">
  // Статичные тестовые данные для Featured Articles (Главные материалы)
  const features = [
    {
      id: "1",
      title: "Искусственный интеллект в современной разработке",
      slug: "ai-in-modern-development",
      dek: "Как ИИ меняет подход к созданию программного обеспечения",
      excerpt:
        "Исследуем влияние искусственного интеллекта на современные методы разработки, от автоматизации тестирования до генерации кода.",
      featuredImage: "https://picsum.photos/800/400?random=1",
      publishedAt: "2024-01-15T10:00:00Z",
      author: {
        name: "Анна Петрова",
        slug: "anna-petrova",
        photoUrl: "https://images.unsplash.com/photo-1494790108755-2616b612b786?w=100&h=100&fit=crop&crop=face"
      },
      section: {
        name: "Технологии",
        slug: "technology"
      }
    },
    {
      id: "2",
      title: "Микросервисная архитектура: от теории к практике",
      slug: "microservices-architecture-practice",
      dek: "Практическое руководство по внедрению микросервисов",
      excerpt:
        "Подробный разбор принципов микросервисной архитектуры с реальными примерами и рекомендациями по внедрению.",
      featuredImage: "https://picsum.photos/800/400?random=2",
      publishedAt: "2024-01-12T14:30:00Z",
      author: {
        name: "Дмитрий Соколов",
        slug: "dmitry-sokolov",
        photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face"
      },
      section: {
        name: "Архитектура",
        slug: "architecture"
      }
    },
    {
      id: "3",
      title: "React 18: новые возможности и лучшие практики",
      slug: "react-18-new-features",
      dek: "Обзор ключевых нововведений в React 18",
      excerpt:
        "Изучаем новые возможности React 18: Concurrent Features, Suspense, автоматическая батчинг и многое другое.",
      featuredImage: "https://picsum.photos/800/400?random=3",
      publishedAt: "2024-01-10T09:15:00Z",
      author: {
        name: "Мария Иванова",
        slug: "maria-ivanova",
        photoUrl: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=face"
      },
      section: {
        name: "Frontend",
        slug: "frontend"
      }
    },
    {
      id: "4",
      title: "DevOps культура: как построить эффективную команду",
      slug: "devops-culture-effective-team",
      dek: "Стратегии создания высокопроизводительных DevOps команд",
      excerpt:
        "Практические советы по формированию DevOps культуры в организации и построению эффективных команд разработки.",
      featuredImage: "https://picsum.photos/800/400?random=4",
      publishedAt: "2024-01-08T16:45:00Z",
      author: {
        name: "Сергей Козлов",
        slug: "sergey-kozlov",
        photoUrl: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face"
      },
      section: {
        name: "DevOps",
        slug: "devops"
      }
    },
    {
      id: "5",
      title: "Безопасность веб-приложений в 2024 году",
      slug: "web-security-2024",
      dek: "Актуальные угрозы и методы защиты",
      excerpt: "Обзор современных угроз безопасности веб-приложений и эффективные методы защиты от них.",
      featuredImage: "https://picsum.photos/800/400?random=5",
      publishedAt: "2024-01-05T11:20:00Z",
      author: {
        name: "Елена Сидорова",
        slug: "elena-sidorova",
        photoUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop&crop=face"
      },
      section: {
        name: "Безопасность",
        slug: "security"
      }
    }
  ]

  const mainArticle = features[0]
  // Флагман идёт во всю ширину отдельным открывающим событием,
  // остальные четыре — рядом под ним (решение владельца).
  const secondaryArticles = features.slice(1, 5)
</script>

<template>
  <section class="featured-articles pt-10 pb-24 border-b border-zinc-200 dark:border-zinc-800">
    <!-- Флагман: изображение во всю ширину контейнера, под ним по центральной оси
         заголовок, дек и мета. Ось рифмуется с логотипом по центру в шапке. -->
    <div v-if="mainArticle">
      <ArticleLede :article="mainArticle" />
    </div>

    <!-- Флагман от остальной ленты отделяет только воздух: линейку владелец
         снял при живом ревью 2026-09-13 -->
    <ul class="mt-16 grid grid-cols-1 gap-y-10 pt-16 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-4 lg:gap-x-12">
      <li v-for="article in secondaryArticles" :key="article.id">
        <ArticleBase :article="article" />
      </li>
    </ul>
  </section>
</template>
