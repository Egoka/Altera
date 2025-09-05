<script setup lang="ts">
  import { computed, onUnmounted, ref, watch } from "vue"
  import { useBreakpoint } from "~/composables/useBreakpoint"
  import { useRoute } from "vue-router"

  interface Props {
    isOpen?: boolean
  }

  const props = withDefaults(defineProps<Props>(), {
    isOpen: false
  })

  const emit = defineEmits<{
    close: []
  }>()

  // Высота header для правильного позиционирования
  const HEADER_HEIGHT = 56 // Примерная высота header в пикселях
  const HEADER_MENU = 450 // Примерная высота header в пикселях

  // Используем breakpoint для определения высоты меню
  const { isLg } = useBreakpoint()

  // Отслеживаем изменения роутера для автоматического закрытия меню
  const route = useRoute()

  // Состояние для показа контента с задержкой
  const showContent = ref(false)
  let contentTimeout: ReturnType<typeof setTimeout> | null = null

  const menuHeight = computed(() => {
    if (!props.isOpen) return "0px"

    // На больших экранах (lg и выше) - фиксированная высота 450px
    // На планшетах и телефонах - 100vh - HEADER_HEIGHT
    return isLg.value ? `${HEADER_MENU}px` : `calc(100vh - ${HEADER_HEIGHT}px)`
  })

  const handleClose = () => {
    emit("close")
  }

  const handleBackdropClick = (event: Event) => {
    // Закрываем только при клике на backdrop, не на контент
    if (event.target === event.currentTarget) {
      handleClose()
    }
  }

  // Блокировка скролла для экранов меньше lg
  const originalOverflow = ref<string>("")

  const lockScroll = () => {
    if (import.meta.client && !isLg.value) {
      originalOverflow.value = document.body.style.overflow
      document.body.style.overflow = "hidden"
      document.documentElement.style.overflow = "hidden"
    }
  }

  const unlockScroll = () => {
    if (import.meta.client && !isLg.value) {
      document.body.style.overflow = originalOverflow.value
      document.documentElement.style.overflow = originalOverflow.value
    }
  }

  // Автоматически блокируем/разблокируем скролл при изменении состояния меню
  watch(
    () => props.isOpen,
    (isOpen) => {
      if (isOpen) {
        lockScroll()
        // Показываем контент с задержкой после анимации открытия
        contentTimeout = setTimeout(() => {
          showContent.value = true
        }, 300) // Задержка соответствует duration-300
      } else {
        unlockScroll()
        // Сразу скрываем контент при закрытии
        showContent.value = false
        if (contentTimeout) {
          clearTimeout(contentTimeout)
          contentTimeout = null
        }
      }
    },
    { immediate: true }
  )

  // Автоматически закрываем меню при смене роутера
  watch(
    () => route.path,
    () => {
      if (props.isOpen) {
        handleClose()
      }
    }
  )

  // Очистка при размонтировании компонента
  onUnmounted(() => {
    unlockScroll()
    if (contentTimeout) {
      clearTimeout(contentTimeout)
    }
  })

  // Данные для MegaMenu (2 колонки по 4 строки = 16 элементов)
  const topTopics = [
    {
      id: 1,
      title: "Искусственный интеллект",
      slug: "artificial-intelligence",
      image: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=200&h=120&fit=crop",
      description: "Новейшие разработки в области ИИ"
    },
    {
      id: 2,
      title: "Климатические изменения",
      slug: "climate-change",
      image:
        "https://images.unsplash.com/photo-1599057857385-07c4d54ac76e?q=80&w=2940&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
      description: "Глобальные экологические вызовы"
    },
    {
      id: 3,
      title: "Цифровая экономика",
      slug: "digital-economy",
      image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=200&h=120&fit=crop",
      description: "Трансформация бизнеса в цифровую эпоху"
    },
    {
      id: 4,
      title: "Космические технологии",
      slug: "space-technology",
      image: "https://images.unsplash.com/photo-1446776877081-d282a0f896e2?w=200&h=120&fit=crop",
      description: "Исследования и освоение космоса"
    },
    {
      id: 5,
      title: "Блокчейн технологии",
      slug: "blockchain-technology",
      image: "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=200&h=120&fit=crop",
      description: "Криптовалюты и децентрализованные приложения"
    },
    {
      id: 6,
      title: "Автономные транспортные средства",
      slug: "autonomous-vehicles",
      image: "https://images.unsplash.com/photo-1549924231-f129b911e442?w=200&h=120&fit=crop",
      description: "Беспилотные автомобили и дроны будущего"
    },
    {
      id: 7,
      title: "Нейроинтерфейсы",
      slug: "neural-interfaces",
      image: "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=200&h=120&fit=crop",
      description: "Прямое подключение мозга к компьютерам"
    },
    {
      id: 8,
      title: "Нанотехнологии",
      slug: "nanotechnology",
      image: "https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=200&h=120&fit=crop",
      description: "Микроскопические устройства и материалы"
    },
    {
      id: 9,
      title: "Виртуальная реальность",
      slug: "virtual-reality",
      image: "https://images.unsplash.com/photo-1593508512255-86ab42a8e620?w=200&h=120&fit=crop",
      description: "VR/AR технологии и метавселенные"
    },
    {
      id: 10,
      title: "Робототехника",
      slug: "robotics",
      image: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=200&h=120&fit=crop",
      description: "Промышленные и бытовые роботы"
    },
    {
      id: 11,
      title: "3D печать",
      slug: "3d-printing",
      image: "https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=200&h=120&fit=crop",
      description: "Аддитивное производство и биопечать"
    },
    {
      id: 12,
      title: "Интернет вещей",
      slug: "internet-of-things",
      image: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=200&h=120&fit=crop",
      description: "Умные устройства и подключенные экосистемы"
    },
    {
      id: 13,
      title: "Кибербезопасность",
      slug: "cybersecurity",
      image: "https://images.unsplash.com/photo-1563986768609-322da13575f3?w=200&h=120&fit=crop",
      description: "Защита данных и цифровая безопасность"
    },
    {
      id: 14,
      title: "Облачные вычисления",
      slug: "cloud-computing",
      image: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=200&h=120&fit=crop",
      description: "Облачные платформы и сервисы"
    },
    {
      id: 15,
      title: "Большие данные",
      slug: "big-data",
      image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=200&h=120&fit=crop",
      description: "Аналитика данных и машинное обучение"
    },
    {
      id: 16,
      title: "Зеленая энергетика",
      slug: "green-energy",
      image: "https://images.unsplash.com/photo-1509391366360-2e959784a276?w=200&h=120&fit=crop",
      description: "Возобновляемые источники энергии"
    }
  ]

  const topTags = [
    { name: "Технологии", slug: "technology" },
    { name: "Наука", slug: "science" },
    { name: "Экономика", slug: "economics" },
    { name: "Политика", slug: "politics" },
    { name: "Общество", slug: "society" },
    { name: "Культура", slug: "culture" },
    { name: "Спорт", slug: "sports" },
    { name: "Здоровье", slug: "health" },
    { name: "Образование", slug: "education" },
    { name: "Медиа", slug: "media" },
    { name: "Экология", slug: "ecology" },
    { name: "Инновации", slug: "innovation" },
    { name: "Бизнес", slug: "business" },
    { name: "Финансы", slug: "finance" },
    { name: "Медицина", slug: "medicine" },
    { name: "Психология", slug: "psychology" },
    { name: "История", slug: "history" },
    { name: "Философия", slug: "philosophy" },
    { name: "Искусство", slug: "art" },
    { name: "Музыка", slug: "music" }
  ]
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed z-40 transition-opacity duration-300"
    :style="{
      top: `${HEADER_HEIGHT}px`,
      height: `calc(100vh - ${HEADER_HEIGHT}px)`,
      left: '0px',
      right: '0px'
    }"
    :class="{
      'opacity-100': isOpen,
      'opacity-0': !isOpen
    }"
    @click="handleBackdropClick" />

  <!-- MegaMenu -->
  <div
    class="fixed left-0 right-0 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 shadow-lg transition-all duration-300 ease-in-out z-50"
    :style="{
      top: `${HEADER_HEIGHT}px`,
      height: menuHeight
    }"
    :class="{
      'opacity-100': isOpen,
      'opacity-0': !isOpen
    }">
    <div
      class="relative max-w-7xl mx-auto border-t border-zinc-200 dark:border-zinc-800 overflow-auto lg:overflow-hidden"
      :class="[menuHeight === '0px' ? 'p-0' : 'px-6 lg:px-8 py-8']"
      :style="{ height: menuHeight }">
      <div
        v-show="showContent"
        class="grid grid-cols-1 lg:grid-cols-10 transition-opacity duration-300"
        :class="{
          'opacity-100': showContent,
          'opacity-0': !showContent
        }">
        <div class="lg:col-span-8 lg:pr-5 mb-8 md:mb-0">
          <div class="flex justify-between items-end mb-3">
            <h3 class="text-lg font-semibold text-zinc-900 dark:text-zinc-300 mb-4">Топ тематики</h3>
            <NuxtLink to="/types">
              <button
                class="inline-block mt-2 px-3 py-1 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-md text-sm hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-800 dark:hover:text-primary-300 transition-colors">
                Открыть все
              </button>
            </NuxtLink>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <NuxtLink
              v-for="topic in topTopics.slice(0, 8)"
              :key="topic.id"
              :to="`/types/${topic.slug}`"
              class="group cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg p-3 transition-all duration-200">
              <div class="flex items-start gap-3">
                <div class="flex-shrink-0">
                  <img :src="topic.image" :alt="topic.title" class="w-16 h-12 object-cover rounded-md" />
                </div>
                <div class="flex-1 min-w-0">
                  <h4
                    class="font-medium text-zinc-800 dark:text-zinc-300 group-hover:text-zinc-950 dark:group-hover:text-zinc-100 transition-colors h-6 truncate">
                    {{ topic.title }}
                  </h4>
                  <p class="text-sm text-zinc-600 dark:text-zinc-500 truncate">
                    {{ topic.description }}
                  </p>
                </div>
              </div>
            </NuxtLink>
          </div>
        </div>

        <div class="lg:col-span-2 lg:border-l lg:pl-5 lg:border-zinc-200 dark:border-zinc-800">
          <h3 class="text-lg font-semibold text-zinc-900 dark:text-zinc-300 mb-4">Популярные теги</h3>
          <div class="relative">
            <div class="flex flex-wrap gap-2 max-h-[300px] overflow-y-hidden pb-2">
              <NuxtLink
                v-for="tag in topTags.slice(0, 20)"
                :key="tag.slug"
                :to="`/tags/${tag.slug}`"
                class="inline-block px-3 py-1 bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300 rounded-full text-sm hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-800 dark:hover:text-primary-300 transition-colors">
                {{ tag.name }}
              </NuxtLink>
            </div>
            <div
              class="hidden lg:block absolute bottom-[36px] left-0 right-0 h-16 bg-gradient-to-t from-white via-white/90 to-transparent dark:from-zinc-950 dark:via-zinc-950/90 pointer-events-none" />
            <NuxtLink to="/tags">
              <button
                class="inline-block mt-2 px-3 py-1 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-md text-sm hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-800 dark:hover:text-primary-300 transition-colors">
                Посмотреть все
              </button>
            </NuxtLink>
          </div>
        </div>
      </div>

      <button
        v-if="showContent"
        class="hidden lg:block absolute top-4 right-4 p-2 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors"
        aria-label="Закрыть меню"
        @click="handleClose">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>
