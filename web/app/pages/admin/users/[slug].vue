<script setup lang="ts">
  import type { FormStructure } from "#fishtvue/form"

  definePageMeta({
    layout: "admin",
    middleware: ["admin"]
  })

  const route = useRoute()
  const slugUser = route.params.slugUser as string

  // Моковые данные для пользователей (в реальном приложении это будет API запрос)
  const data = shallowRef<Array<any>>([
    {
      id: 1,
      name: "Александр Иванов",
      email: "alex.ivanov@example.com",
      role: "ADMIN",
      slug: "alex-ivanov",
      bio: "Администратор системы, эксперт по веб-разработке и управлению контентом",
      photoUrl: "/avatars/William_Taylor.jpg",
      articlesCount: 25,
      createdAt: "2024-01-10T09:15:00Z",
      updatedAt: "2024-01-20T14:22:00Z"
    },
    {
      id: 2,
      name: "Мария Петрова",
      email: "maria.petrova@example.com",
      role: "AUTHOR",
      slug: "maria-petrova",
      bio: "Автор статей о дизайне и UX/UI, специалист по созданию пользовательских интерфейсов",
      photoUrl: null,
      articlesCount: 18,
      createdAt: "2024-01-08T11:20:00Z",
      updatedAt: "2024-01-18T16:45:00Z"
    },
    {
      id: 3,
      name: "Дмитрий Сидоров",
      email: "dmitry.sidorov@example.com",
      role: "AUTHOR",
      slug: "dmitry-sidorov",
      bio: "Технический писатель, эксперт по программированию и современным технологиям",
      photoUrl: null,
      articlesCount: 32,
      createdAt: "2024-01-05T14:10:00Z",
      updatedAt: "2024-01-19T13:30:00Z"
    },
    {
      id: 4,
      name: "Елена Козлова",
      email: "elena.kozlova@example.com",
      role: "AUTHOR",
      slug: "elena-kozlova",
      bio: "Контент-менеджер, специалист по маркетингу и созданию образовательного контента",
      photoUrl: null,
      articlesCount: 15,
      createdAt: "2024-01-12T16:25:00Z",
      updatedAt: "2024-01-21T09:40:00Z"
    },
    {
      id: 5,
      name: "Анна Смирнова",
      email: "anna.smirnova@example.com",
      role: "READER",
      slug: "anna-smirnova",
      bio: "Активный читатель, интересуется технологиями и дизайном",
      photoUrl: null,
      articlesCount: 0,
      createdAt: "2024-01-14T12:00:00Z",
      updatedAt: "2024-01-20T15:20:00Z"
    },
    {
      id: 6,
      name: "Владимир Новиков",
      email: "vladimir.novikov@example.com",
      role: "READER",
      slug: "vladimir-novikov",
      bio: "Энтузиаст программирования, изучает новые технологии",
      photoUrl: null,
      articlesCount: 0,
      createdAt: "2024-01-15T10:30:00Z",
      updatedAt: "2024-01-22T11:15:00Z"
    },
    {
      id: 7,
      name: "Ольга Волкова",
      email: "olga.volkova@example.com",
      role: "AUTHOR",
      slug: "olga-volkova",
      bio: "Дизайнер и иллюстратор, создает визуальный контент для статей",
      photoUrl: null,
      articlesCount: 8,
      createdAt: "2024-01-16T08:45:00Z",
      updatedAt: "2024-01-23T14:30:00Z"
    },
    {
      id: 8,
      name: "Сергей Морозов",
      email: "sergey.morozov@example.com",
      role: "ADMIN",
      slug: "sergey-morozov",
      bio: "Системный администратор, отвечает за техническую поддержку и безопасность",
      photoUrl: null,
      articlesCount: 5,
      createdAt: "2024-01-18T13:20:00Z",
      updatedAt: "2024-01-24T16:45:00Z"
    }
  ])

  // Данные формы редактирования
  const formValues = ref({
    name: "",
    email: "",
    role: "",
    slug: "",
    bio: ""
  })

  // Структура формы редактирования пользователя
  const formStructure = ref<FormStructure[]>([
    {
      classGrid: "grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6",
      fields: [
        {
          typeComponent: "Input",
          name: "name",
          rules: { required: true },
          label: "Имя",
          placeholder: "Введите имя пользователя",
          classCol: "sm:col-span-6"
        },
        {
          typeComponent: "Input",
          name: "email",
          rules: { required: true, email: true },
          label: "Email",
          placeholder: "Введите email",
          classCol: "sm:col-span-6"
        },
        {
          typeComponent: "Select",
          name: "role",
          rules: { required: true },
          label: "Роль",
          classCol: "sm:col-span-6",
          dataSelect: [
            {
              id: "ADMIN",
              value: "Администратор"
            },
            {
              id: "AUTHOR",
              value: "Автор"
            },
            {
              id: "READER",
              value: "Читатель"
            }
          ]
        },
        {
          typeComponent: "Input",
          name: "slug",
          rules: { required: true },
          label: "Slug",
          placeholder: "Введите slug",
          classCol: "sm:col-span-6"
        },
        {
          typeComponent: "Aria",
          name: "bio",
          rules: {},
          label: "Описание",
          placeholder: "Введите описание пользователя",
          classCol: "sm:col-span-6"
        }
      ]
    }
  ])

  // Поиск пользователя по slug
  const findUserBySlug = (slug: string) => {
    return data.value.find((user) => user.slug === slug)
  }

  // Загрузка данных пользователя в форму
  const loadUserData = (slug: string) => {
    const user = findUserBySlug(slug)
    if (user) {
      formValues.value = {
        name: user.name || "",
        email: user.email || "",
        role: user.role || "",
        slug: user.slug || "",
        bio: user.bio || ""
      }
    }
  }

  // Обработчик отправки формы
  const handleSubmit = () => {
    const user = findUserBySlug(slugUser)
    if (user) {
      // Сохраняем старый slug для поиска
      const oldSlug = user.slug

      // Обновляем данные пользователя
      user.name = formValues.value.name
      user.email = formValues.value.email
      user.role = formValues.value.role
      user.slug = formValues.value.slug
      user.bio = formValues.value.bio
      user.updatedAt = new Date().toISOString()

      // Если slug изменился, перенаправляем на новый slug
      if (oldSlug !== formValues.value.slug) {
        navigateTo(`/admin/users/${formValues.value.slug}`)
      }

      // Здесь можно добавить вызов API для сохранения изменений
      console.log("Сохранение пользователя:", user)
    }
  }

  // Загружаем данные пользователя при монтировании компонента
  onMounted(() => {
    if (slugUser) {
      loadUserData(slugUser)
    }
  })

  // Отслеживаем изменения slug в роуте
  watch(() => route.params.slugUser, (newSlug) => {
    if (newSlug) {
      loadUserData(newSlug as string)
    }
  })
</script>

<template>
  <div class="sm:rounded-xl h-full bg-zinc-100 dark:bg-zinc-900 p-3">
    <div class="relative h-[calc(100vh-50px)] overflow-y-auto">
      <div class="pt-2.5">
        <div class="px-4 mb-6">
          <h2 class="text-xl font-semibold text-black dark:text-zinc-300 mb-2 truncate">
            Редактирование пользователя
          </h2>
          <p class="text-sm text-neutral-400 dark:text-neutral-500 truncate">
            Измените данные пользователя и нажмите "Сохранить"
          </p>
        </div>
        <Form
          :formFields="formValues"
          :structure="formStructure"
          modeValidate="onChange"
          structureClass="h-[calc(100vh-216px)] border-b border-neutral-200 dark:border-neutral-800 pb-12"
          submitButton="Сохранить"
          @submit="handleSubmit" />
      </div>
    </div>
  </div>
</template>
