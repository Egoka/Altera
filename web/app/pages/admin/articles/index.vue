<script setup lang="ts">
  import type { IColumn } from "#fishtvue/table"

  definePageMeta({
    layout: "admin",
    middleware: ["admin"]
  })

  // Моковые данные для статей
  const rawData = [
    {
      id: 1,
      title: "Основы современной веб-разработки",
      slug: "osnovy-sovremennoy-veb-razrabotki",
      status: "PUBLISHED",
      excerpt: "Подробное руководство по современным технологиям веб-разработки",
      createdAt: "2024-01-10T09:15:00Z",
      publishedAt: "2024-01-12T14:30:00Z",
      updatedAt: "2024-01-15T16:45:00Z",
      author: {
        id: 1,
        name: "Александр Иванов",
        email: "alex.ivanov@example.com"
      },
      contentType: {
        id: 1,
        name: "Статья",
        slug: "article"
      },
      sectionTags: [
        { id: 1, name: "Технологии", slug: "tehnologii" },
        { id: 2, name: "Программирование", slug: "programmirovanie" }
      ]
    },
    {
      id: 2,
      title: "Дизайн пользовательских интерфейсов в 2024",
      slug: "dizayn-polzovatelskih-interfeysov-2024",
      status: "PUBLISHED",
      excerpt: "Тренды и лучшие практики в области UI/UX дизайна",
      createdAt: "2024-01-08T11:20:00Z",
      publishedAt: "2024-01-10T10:00:00Z",
      updatedAt: "2024-01-12T13:20:00Z",
      author: {
        id: 2,
        name: "Мария Петрова",
        email: "maria.petrova@example.com"
      },
      contentType: {
        id: 2,
        name: "Блог",
        slug: "blog"
      },
      sectionTags: [
        { id: 2, name: "Дизайн", slug: "dizajn" },
        { id: 3, name: "UX/UI", slug: "ux-ui" }
      ]
    },
    {
      id: 3,
      title: "Новые возможности JavaScript ES2024",
      slug: "novye-vozmozhnosti-javascript-es2024",
      status: "DRAFT",
      excerpt: "Обзор новых функций и улучшений в JavaScript",
      createdAt: "2024-01-15T14:10:00Z",
      publishedAt: null,
      updatedAt: "2024-01-18T09:30:00Z",
      author: {
        id: 3,
        name: "Дмитрий Сидоров",
        email: "dmitry.sidorov@example.com"
      },
      contentType: {
        id: 1,
        name: "Статья",
        slug: "article"
      },
      sectionTags: [
        { id: 1, name: "Технологии", slug: "tehnologii" },
        { id: 4, name: "JavaScript", slug: "javascript" }
      ]
    },
    {
      id: 4,
      title: "Обзор фреймворка Vue.js 3",
      slug: "obzor-freymvorka-vue-js-3",
      status: "REVIEW",
      excerpt: "Подробный обзор возможностей Vue.js 3 и Composition API",
      createdAt: "2024-01-12T16:25:00Z",
      publishedAt: null,
      updatedAt: "2024-01-20T11:40:00Z",
      author: {
        id: 1,
        name: "Александр Иванов",
        email: "alex.ivanov@example.com"
      },
      contentType: {
        id: 3,
        name: "Обзор",
        slug: "review"
      },
      sectionTags: [
        { id: 1, name: "Технологии", slug: "tehnologii" },
        { id: 5, name: "Vue.js", slug: "vue-js" }
      ]
    },
    {
      id: 5,
      title: "Руководство по настройке CI/CD",
      slug: "rukovodstvo-po-nastroyke-ci-cd",
      status: "PUBLISHED",
      excerpt: "Пошаговое руководство по настройке непрерывной интеграции",
      createdAt: "2024-01-14T12:00:00Z",
      publishedAt: "2024-01-16T08:20:00Z",
      updatedAt: "2024-01-18T14:15:00Z",
      author: {
        id: 4,
        name: "Елена Козлова",
        email: "elena.kozlova@example.com"
      },
      contentType: {
        id: 4,
        name: "Руководство",
        slug: "guide"
      },
      sectionTags: [
        { id: 6, name: "DevOps", slug: "devops" },
        { id: 7, name: "Автоматизация", slug: "avtomatizaciya" }
      ]
    },
    {
      id: 6,
      title: "Будущее веб-разработки",
      slug: "buduschee-veb-razrabotki",
      status: "ARCHIVED",
      excerpt: "Прогнозы и тренды в области веб-разработки",
      createdAt: "2024-01-05T10:30:00Z",
      publishedAt: "2024-01-07T12:00:00Z",
      updatedAt: "2024-01-10T15:45:00Z",
      author: {
        id: 2,
        name: "Мария Петрова",
        email: "maria.petrova@example.com"
      },
      contentType: {
        id: 2,
        name: "Блог",
        slug: "blog"
      },
      sectionTags: [
        { id: 1, name: "Технологии", slug: "tehnologii" },
        { id: 8, name: "Будущее", slug: "buduschee" }
      ]
    }
  ]

  // Предобработчик данных для извлечения вложенных полей
  const data = shallowRef<Array<any>>(
    rawData.map((item) => ({
      ...item,
      authorName: item.author?.name || "",
      authorEmail: item.author?.email || "",
      contentTypeName: item.contentType?.name || "",
      contentTypeSlug: item.contentType?.slug || "",
      tagsString: item.sectionTags?.map((tag: any) => tag.name).join(", ") || ""
    }))
  )

  // Конфигурация колонок таблицы
  const columns = shallowRef<Array<IColumn>>([
    {
      dataField: "title",
      name: "title",
      type: "string",
      caption: "Заголовок",
      visible: true,
      width: 300,
      minWidth: 250,
      isFilter: true,
      isSort: true,
      defaultSort: "asc"
    },
    {
      dataField: "status",
      name: "status",
      type: "select",
      caption: "Статус",
      visible: true,
      width: 120,
      minWidth: 100,
      isFilter: true,
      isSort: true,
      cellTemplate: "status"
    },
    {
      dataField: "authorName",
      name: "authorName",
      type: "string",
      caption: "Автор",
      visible: true,
      width: 200,
      minWidth: 150,
      isFilter: true,
      isSort: true
    },
    {
      dataField: "contentTypeName",
      name: "contentTypeName",
      type: "string",
      caption: "Тип",
      visible: true,
      width: 120,
      minWidth: 100,
      isFilter: true,
      isSort: true
    },
    {
      dataField: "tagsString",
      name: "tags",
      type: "string",
      caption: "Теги",
      visible: true,
      width: 200,
      minWidth: 150,
      isFilter: false,
      isSort: false,
      cellTemplate: "tags"
    },
    {
      dataField: "createdAt",
      name: "createdAt",
      type: "date",
      caption: "Создан",
      visible: true,
      width: 150,
      minWidth: 120,
      isFilter: true,
      isSort: true
    },
    {
      dataField: "publishedAt",
      name: "publishedAt",
      type: "date",
      caption: "Опубликован",
      visible: true,
      width: 150,
      minWidth: 120,
      isFilter: true,
      isSort: true
    }
  ])

  const red = "bg-red-50 text-red-700 ring-red-600/10 dark:bg-red-950 dark:text-red-300 dark:ring-red-400/10"
  const green =
    "bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950 dark:text-green-300 dark:ring-green-400/20"
  const blue = "bg-blue-50 text-blue-700 ring-blue-600/10 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-400/10"
  const yellow =
    "bg-yellow-50 text-yellow-700 ring-yellow-600/10 dark:bg-yellow-950 dark:text-yellow-300 dark:ring-yellow-400/10"
  const gray = "bg-gray-50 text-gray-700 ring-gray-600/10 dark:bg-gray-950 dark:text-gray-300 dark:ring-gray-400/10"

  // Функция для получения стилей статуса
  const getStatusStyle = (status: string) => {
    switch (status) {
      case "PUBLISHED":
        return green
      case "DRAFT":
        return yellow
      case "REVIEW":
        return blue
      case "ARCHIVED":
        return red
      default:
        return gray
    }
  }

  // Функция для получения текста статуса
  const getStatusText = (status: string) => {
    switch (status) {
      case "PUBLISHED":
        return "Опубликована"
      case "DRAFT":
        return "Черновик"
      case "REVIEW":
        return "На рецензии"
      case "ARCHIVED":
        return "Архивная"
      default:
        return "Неизвестно"
    }
  }
</script>

<template>
  <Table
    :dataSource="data"
    :columns="columns"
    search
    toolbar
    class="p-0 overflow-auto"
    :styles="{
      hoverRows: true,
      class: {
        toolbar: 'flex-col md:flex-row'
      },
      width: '100%',
      height: '100%'
    }">
    <template #toolbar>
      <div class="flex items-start gap-2 justify-between my-2.5 ml-5 text-xs sm:text-base">
        <div class="">
          <div class="text-lg sm:text-2xl font-medium leading-8 text-black dark:text-zinc-300">Управление статьями</div>
          <div class="mt-1 leading-6 text-neutral-400 dark:text-neutral-500">
            Просмотр и управление статьями системы
          </div>
        </div>
      </div>
    </template>

    <template #status="{ rowData }">
      <Badge :class="getStatusStyle(rowData.status)">
        {{ getStatusText(rowData.status) }}
      </Badge>
    </template>

    <template #tags="{ rowData }">
      <div class="flex flex-wrap gap-1">
        <Badge
          v-for="tag in rowData.sectionTags"
          :key="tag.id"
          class="bg-zinc-100 text-zinc-700 text-xs dark:bg-zinc-900 dark:text-zinc-400">
          {{ tag.name }}
        </Badge>
      </div>
    </template>
  </Table>
</template>

<style scoped></style>
