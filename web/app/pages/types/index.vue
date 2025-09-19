<script setup lang="ts">
  import type ContentType from "~/types/contentType"

  // Моковые данные для типов контента
  const mockContentTypes: ContentType[] = [
    {
      id: "1",
      name: "Статьи",
      slug: "articles",
      description:
        "Основные статьи и материалы сайта. Здесь публикуются глубокие аналитические материалы, исследовательские работы, экспертные мнения и подробные обзоры различных тем. Статьи проходят тщательную редактуру и содержат качественный контент для широкой аудитории.",
      iconUrl: "https://cdn-icons-png.flaticon.com/512/1055/1055687.png",
      order: 1,
      status: "active",
      createdAt: "2024-01-15T10:00:00Z",
      updatedAt: "2024-01-15T10:00:00Z"
    },
    {
      id: "2",
      name: "Новости",
      slug: "news",
      description:
        "Актуальные новости и события в мире технологий, бизнеса и инноваций. Мы оперативно освещаем важные события, анонсы продуктов, изменения в законодательстве и другие значимые новости, которые могут повлиять на нашу аудиторию.",
      iconUrl: "https://cdn-icons-png.flaticon.com/512/2965/2965879.png",
      order: 2,
      status: "active",
      createdAt: "2024-01-16T11:30:00Z",
      updatedAt: "2024-01-16T11:30:00Z"
    },
    {
      id: "3",
      name: "Обзоры",
      slug: "reviews",
      description:
        "Детальные обзоры продуктов, услуг, технологий и решений. Наши эксперты проводят тщательное тестирование и анализ, предоставляя объективную оценку функциональности, производительности, удобства использования и соотношения цена-качество.",
      iconUrl: "https://cdn-icons-png.flaticon.com/512/1828/1828884.png",
      order: 3,
      status: "active",
      createdAt: "2024-01-17T14:20:00Z",
      updatedAt: "2024-01-17T14:20:00Z"
    },
    {
      id: "4",
      name: "Туториалы",
      slug: "tutorials",
      description:
        "Пошаговые руководства и инструкции для решения практических задач. От базовых концепций до продвинутых техник - наши туториалы помогут вам освоить новые навыки, настроить инструменты и реализовать проекты любой сложности.",
      iconUrl: "https://cdn-icons-png.flaticon.com/512/2920/2920277.png",
      order: 4,
      status: "active",
      createdAt: "2024-01-18T09:15:00Z",
      updatedAt: "2024-01-18T09:15:00Z"
    },
    {
      id: "5",
      name: "Интервью",
      slug: "interviews",
      description:
        "Эксклюзивные интервью с экспертами, лидерами индустрии, основателями стартапов и известными профессионалами. Узнайте о личном опыте, карьерных путях, вызовах и достижениях людей, которые формируют будущее технологий.",
      iconUrl: "https://cdn-icons-png.flaticon.com/512/1077/1077114.png",
      order: 5,
      status: "active",
      createdAt: "2024-01-19T16:45:00Z",
      updatedAt: "2024-01-19T16:45:00Z"
    },
    {
      id: "6",
      name: "Аналитика",
      slug: "analytics",
      description:
        "Аналитические материалы и исследования рынков, трендов и технологий. Наши аналитики изучают данные, проводят исследования и предоставляют глубокие инсайты о развитии индустрии, инвестициях и будущих направлениях.",
      iconUrl: "https://cdn-icons-png.flaticon.com/512/2103/2103633.png",
      order: 6,
      status: "active",
      createdAt: "2024-01-20T13:10:00Z",
      updatedAt: "2024-01-20T13:10:00Z"
    },
    {
      id: "7",
      name: "Мнения",
      slug: "opinions",
      description:
        "Авторские колонки и мнения экспертов по актуальным вопросам. Здесь публикуются личные взгляды, размышления и комментарии наших авторов и приглашенных экспертов на важные темы в сфере технологий, бизнеса и общества.",
      iconUrl: "https://cdn-icons-png.flaticon.com/512/1077/1077035.png",
      order: 7,
      status: "active",
      createdAt: "2024-01-21T12:00:00Z",
      updatedAt: "2024-01-21T12:00:00Z"
    },
    {
      id: "8",
      name: "События",
      slug: "events",
      description:
        "Анонсы и отчеты о конференциях, митапах, вебинарах и других мероприятиях. Мы освещаем ключевые события индустрии, предоставляем информацию о предстоящих мероприятиях и делимся впечатлениями от участия в них.",
      iconUrl: "https://cdn-icons-png.flaticon.com/512/1077/1077114.png",
      order: 8,
      status: "active",
      createdAt: "2024-01-22T15:30:00Z",
      updatedAt: "2024-01-22T15:30:00Z"
    }
  ]

  // Моковые данные для статистики
  const mockStats = {
    totalContentTypes: 8,
    activeContentTypes: 8,
    archivedContentTypes: 0,
    totalArticles: 1247,
    articlesThisMonth: 89
  }

  // Реактивные данные
  const contentTypes = ref<ContentType[]>(mockContentTypes)
  const searchQuery = ref("")

  // Фильтрация типов контента
  const filteredContentTypes = computed(() => {
    if (!searchQuery.value) return contentTypes.value

    return contentTypes.value.filter(
      (type) =>
        type.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
        type.description?.toLowerCase().includes(searchQuery.value.toLowerCase())
    )
  })
</script>

<template>
  <div>
    <NuxtLink
      v-for="contentType in filteredContentTypes"
      :key="contentType.id"
      :to="`/${contentType.slug}`"
      class="block">
      <HeaderType :contentType="contentType" />
    </NuxtLink>
  </div>
</template>
