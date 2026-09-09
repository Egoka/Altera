<script setup lang="ts">
  import type { IColumn } from "#fishtvue/table"

  definePageMeta({
    layout: "admin",
    middleware: ["admin"]
  })

  // Моковые данные для типов контента
  const data = shallowRef<Array<any>>([
    {
      id: 1,
      name: "Статья",
      slug: "article",
      description: "Основной тип контента для публикации статей и новостей",
      order: 1,
      status: "ACTIVE",
      articlesCount: 45,
      createdAt: "2024-01-10T09:15:00Z",
      updatedAt: "2024-01-20T14:22:00Z"
    },
    {
      id: 2,
      name: "Блог",
      slug: "blog",
      description: "Персональные записи в блоге и авторские материалы",
      order: 2,
      status: "ACTIVE",
      articlesCount: 23,
      createdAt: "2024-01-08T11:20:00Z",
      updatedAt: "2024-01-18T16:45:00Z"
    },
    {
      id: 3,
      name: "Новость",
      slug: "news",
      description: "Актуальные новости и события",
      order: 3,
      status: "ACTIVE",
      articlesCount: 18,
      createdAt: "2024-01-05T14:10:00Z",
      updatedAt: "2024-01-19T13:30:00Z"
    },
    {
      id: 4,
      name: "Обзор",
      slug: "review",
      description: "Обзоры продуктов, сервисов и технологий",
      order: 4,
      status: "ACTIVE",
      articlesCount: 12,
      createdAt: "2024-01-12T16:25:00Z",
      updatedAt: "2024-01-21T09:40:00Z"
    },
    {
      id: 5,
      name: "Руководство",
      slug: "guide",
      description: "Подробные инструкции и руководства пользователя",
      order: 5,
      status: "ACTIVE",
      articlesCount: 8,
      createdAt: "2024-01-14T12:00:00Z",
      updatedAt: "2024-01-20T15:20:00Z"
    },
    {
      id: 6,
      name: "FAQ",
      slug: "faq",
      description: "Часто задаваемые вопросы и ответы",
      order: 6,
      status: "ARCHIVED",
      articlesCount: 0,
      createdAt: "2024-01-03T10:30:00Z",
      updatedAt: "2024-01-15T11:45:00Z"
    }
  ])

  // Конфигурация колонок таблицы
  const columns = shallowRef<Array<IColumn>>([
    {
      dataField: "name",
      name: "name",
      type: "string",
      caption: "Название",
      visible: true,
      width: 200,
      minWidth: 150,
      isFilter: true,
      isSort: true,
      defaultSort: "asc"
    },
    {
      dataField: "slug",
      name: "slug",
      type: "string",
      caption: "URL-адрес",
      visible: true,
      width: 150,
      minWidth: 120,
      isFilter: true,
      isSort: true
    },
    {
      dataField: "description",
      name: "description",
      type: "string",
      caption: "Описание",
      visible: true,
      width: 300,
      minWidth: 200,
      isFilter: true,
      isSort: false
    },
    {
      dataField: "order",
      name: "order",
      type: "number",
      caption: "Порядок",
      visible: true,
      width: 100,
      minWidth: 80,
      isFilter: false,
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
      dataField: "articlesCount",
      name: "articlesCount",
      type: "number",
      caption: "Статей",
      visible: true,
      width: 100,
      minWidth: 80,
      isFilter: false,
      isSort: true,
      defaultSort: "desc"
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
      isSort: true,
      cellTemplate: "date"
    },
    {
      dataField: "updatedAt",
      name: "updatedAt",
      type: "date",
      caption: "Обновлён",
      visible: true,
      width: 150,
      minWidth: 120,
      isFilter: true,
      isSort: true,
      cellTemplate: "date"
    }
  ])

  const red = "bg-red-50 text-red-700 ring-red-600/10 dark:bg-red-950 dark:text-red-300 dark:ring-red-400/10"
  const green =
    "bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950 dark:text-green-300 dark:ring-green-400/20"
  const yellow =
    "bg-yellow-50 text-yellow-700 ring-yellow-600/10 dark:bg-yellow-950 dark:text-yellow-300 dark:ring-yellow-400/10"

  // Функция для получения стилей статуса
  const getStatusStyle = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return green
      case "ARCHIVED":
        return red
      case "DRAFT":
        return yellow
      default:
        return red
    }
  }

  // Функция для получения текста статуса
  const getStatusText = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "Активен"
      case "ARCHIVED":
        return "Архивный"
      case "DRAFT":
        return "Черновик"
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
          <div class="text-lg sm:text-2xl font-medium leading-8 text-black dark:text-zinc-300">
            Управление типами контента
          </div>
          <div class="mt-1 leading-6 text-neutral-400 dark:text-neutral-500">
            Создание и редактирование типов контента для статей
          </div>
        </div>
      </div>
    </template>

    <template #status="{ rowData }">
      <Badge :class="getStatusStyle(rowData.status)">
        {{ getStatusText(rowData.status) }}
      </Badge>
    </template>

    <template #date="{ value }">
      <span class="text-sm">
        {{ value }}
      </span>
    </template>
  </Table>
</template>

<style scoped></style>
