<script setup lang="ts">
  // Компоненты ThemeToggle и LanguageToggle управляют своими состояниями
  // setLocale теперь доступен из useI18n()
  // import ScrollIndicator from "~/components/app/ScrollIndicator.vue"
  // import HeaderDemo from "~/components/app/HeaderDemo.vue"
  // import MegaMenuDemo from "~/components/app/MegaMenuDemo.vue"
  // import ScreenSizeIndicator from "~/components/app/ScreenSizeIndicator.vue"
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900 transition-all duration-300">
    <!-- Тестовый контент для скролла -->
    <div class="h-screen bg-gradient-to-b from-blue-50 to-blue-100 flex items-center justify-center">
      <div class="text-center">
        <h1 class="text-6xl font-bold text-blue-900 mb-4">Altera</h1>
        <p class="text-xl text-blue-700">Прокрутите вниз, чтобы увидеть анимацию логотипа</p>
      </div>
    </div>

    <!-- Дополнительный контент для скролла -->
    <div class="container mx-auto px-4 py-8">
      <div class="space-y-12">
        <section>
          <h2 class="text-3xl font-bold text-gray-900 dark:text-white mb-6">О платформе</h2>
          <p class="text-lg text-gray-600 dark:text-gray-300 mb-8">
            Altera - современная платформа для создания и публикации контента. Мы предоставляем инструменты для авторов,
            редакторов и читателей.
          </p>
        </section>

        <section>
          <h2 class="text-3xl font-bold text-gray-900 dark:text-white mb-6">Возможности</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">Публикации</h3>
              <p class="text-gray-600 dark:text-gray-400">Создавайте и публикуйте статьи с богатым форматированием</p>
            </div>

            <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">Авторы</h3>
              <p class="text-gray-600 dark:text-gray-400">Профили авторов с их работами и статистикой</p>
            </div>

            <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">Категории</h3>
              <p class="text-gray-600 dark:text-gray-400">Организация контента по тегам и типам</p>
            </div>
          </div>
        </section>

        <section>
          <h2 class="text-3xl font-bold text-gray-900 dark:text-white mb-6">Демо</h2>
          <div class="space-y-4">
            <a
              href="/components-showcase"
              class="inline-block bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-medium transition-colors">
              Components Showcase
            </a>
            <a
              href="/fonts-showcase"
              class="inline-block bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-medium transition-colors">
              fonts-showcase.vue
            </a>
          </div>
        </section>
      </div>
    </div>

    <!-- Индикатор скролла для демонстрации -->
    <!--    <ScrollIndicator />-->

    <!-- Индикатор размера экрана -->
    <!--    <ScreenSizeIndicator />-->

    <!-- Демонстрация работы header -->
    <!--    <HeaderDemo />-->

    <!-- Демонстрация работы MegaMenu -->
    <!--    <MegaMenuDemo />-->
  </div>
</template>
