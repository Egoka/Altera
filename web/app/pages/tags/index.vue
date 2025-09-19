<script setup lang="ts">
  interface Tag {
    name: string
    slug: string
  }

  // Моковые данные тегов
  const MOCK_TAGS: Tag[] = [
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
    { name: "Музыка", slug: "music" },
    { name: "JavaScript", slug: "javascript" },
    { name: "TypeScript", slug: "typescript" },
    { name: "React", slug: "react" },
    { name: "Vue.js", slug: "vue" },
    { name: "Node.js", slug: "nodejs" },
    { name: "Python", slug: "python" },
    { name: "PHP", slug: "php" },
    { name: "Java", slug: "java" },
    { name: "C#", slug: "csharp" },
    { name: "Go", slug: "go" },
    { name: "Next.js", slug: "nextjs" },
    { name: "Nuxt.js", slug: "nuxtjs" },
    { name: "Angular", slug: "angular" },
    { name: "Express.js", slug: "express" },
    { name: "Laravel", slug: "laravel" },
    { name: "Django", slug: "django" },
    { name: "Spring Boot", slug: "spring-boot" },
    { name: "ASP.NET", slug: "aspnet" },
    { name: "PostgreSQL", slug: "postgresql" },
    { name: "MySQL", slug: "mysql" },
    { name: "MongoDB", slug: "mongodb" },
    { name: "Redis", slug: "redis" },
    { name: "SQLite", slug: "sqlite" },
    { name: "Elasticsearch", slug: "elasticsearch" },
    { name: "AWS", slug: "aws" },
    { name: "Docker", slug: "docker" },
    { name: "Kubernetes", slug: "kubernetes" },
    { name: "Azure", slug: "azure" },
    { name: "Google Cloud", slug: "google-cloud" },
    { name: "Heroku", slug: "heroku" },
    { name: "HTML5", slug: "html5" },
    { name: "CSS3", slug: "css3" },
    { name: "SASS", slug: "sass" },
    { name: "Webpack", slug: "webpack" },
    { name: "Vite", slug: "vite" },
    { name: "Tailwind CSS", slug: "tailwind-css" },
    { name: "Bootstrap", slug: "bootstrap" },
    { name: "React Native", slug: "react-native" },
    { name: "Flutter", slug: "flutter" },
    { name: "Swift", slug: "swift" },
    { name: "Kotlin", slug: "kotlin" },
    { name: "Ionic", slug: "ionic" },
    { name: "Git", slug: "git" },
    { name: "GitHub", slug: "github" },
    { name: "VS Code", slug: "vs-code" },
    { name: "IntelliJ", slug: "intellij" },
    { name: "WebStorm", slug: "webstorm" },
    { name: "Postman", slug: "postman" },
    { name: "REST API", slug: "rest-api" },
    { name: "GraphQL", slug: "graphql" },
    { name: "Microservices", slug: "microservices" },
    { name: "MVC", slug: "mvc" },
    { name: "MVP", slug: "mvp" },
    { name: "Clean Architecture", slug: "clean-architecture" },
    { name: "Jest", slug: "jest" },
    { name: "Cypress", slug: "cypress" },
    { name: "Mocha", slug: "mocha" },
    { name: "Selenium", slug: "selenium" },
    { name: "WebAssembly", slug: "webassembly" },
    { name: "PWA", slug: "pwa" },
    { name: "WebRTC", slug: "webrtc" },
    { name: "WebSockets", slug: "websockets" }
  ]

  // Состояние поиска
  const searchQuery = ref("")

  // Фильтрация тегов по поисковому запросу
  const filteredTags = computed(() => {
    if (!searchQuery.value) {
      return MOCK_TAGS
    }

    return MOCK_TAGS.filter((tag) => tag.name.toLowerCase().includes(searchQuery.value.toLowerCase()))
  })
</script>

<template>
  <div class="min-h-[calc(100vh-60px)] py-8">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <Input
        v-model="searchQuery"
        mode="underlined"
        class="ring-0 border-b bg-transparent dark:bg-transparent border-zinc-200 dark:border-zinc-800"
        class-input="!font-garamond-libre text-zinc-600 text-3xl text-center h-max"
        height="90px"
        placeholder="Найти..."></Input>
      <TransitionGroup
        name="tag-list"
        tag="div"
        class="flex flex-wrap justify-center items-center gap-5 sm:gap-10 p-3"
        :class="[filteredTags.length < 20 ? 'my-15 sm:my-70' : '']">
        <NuxtLink
          v-for="tag in filteredTags"
          :key="tag.slug"
          :to="`/tags/${tag.slug}`"
          class="group px-8 py-4 sm:px-10 sm:py-6 transition-all duration-200">
          <span
            :class="[
              'font-garamond-libre text-xl font-light leading-tight',
              'text-zinc-500 group-hover:text-zinc-900 dark:text-zinc-500 group-hover:dark:text-zinc-100',
              'transition-all duration-300',
              'inline-block group-hover:scale-150',
              filteredTags.length === 1 ? 'scale-250 group-hover:scale-250' : ''
            ]"
            style="transform-origin: center">
            {{ tag.name }}
          </span>
        </NuxtLink>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
  /* Анимации для TransitionGroup */
  .tag-list-enter-active,
  .tag-list-leave-active {
    transition: all 0.6s ease;
  }

  .tag-list-enter-from {
    opacity: 0;
    transform: scale(0.8) translateY(-20px);
  }

  .tag-list-leave-to {
    opacity: 0;
    transform: scale(0.8) translateY(20px);
  }

  .tag-list-move {
    transition: transform 0.6s ease;
  }

  /* Обеспечиваем правильное позиционирование для flex-wrap */
  .tag-list-enter-active,
  .tag-list-leave-active {
    position: absolute;
  }

  .tag-list-leave-active {
    position: absolute;
    z-index: 0;
  }

  .tag-list-enter-active {
    position: relative;
    z-index: 1;
  }
</style>
