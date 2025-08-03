<script setup lang="ts">
  // Компоненты ThemeToggle и LanguageToggle управляют своими состояниями
  // setLocale теперь доступен из useI18n()
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <div class="container mx-auto px-4 py-8">
      <header class="mb-12">
        <h1 class="text-4xl font-bold text-gray-900 dark:text-white mb-4">Altera - Publishing Platform</h1>
        <p class="text-xl text-gray-600 dark:text-gray-300 mb-8">Modern platform for creating and publishing content</p>

        <!-- Переключатели темы и языка -->
        <div class="flex items-center space-x-4 mb-8">
          <ThemeToggle />
          <LanguageToggle />
        </div>
      </header>

      <!-- Основной контент -->
      <main class="space-y-12">
        <!-- Секция возможностей -->
        <section>
          <h2 class="text-3xl font-bold text-gray-900 dark:text-white mb-6">Platform Features</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">Publications</h3>
              <p class="text-gray-600 dark:text-gray-400">Create and publish articles with rich formatting</p>
            </div>

            <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">Authors</h3>
              <p class="text-gray-600 dark:text-gray-400">Author profiles with their works and statistics</p>
            </div>

            <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">Categories</h3>
              <p class="text-gray-600 dark:text-gray-400">Content organization by tags and types</p>
            </div>
          </div>
        </section>

        <!-- Секция ссылок -->
        <section>
          <h2 class="text-3xl font-bold text-gray-900 dark:text-white mb-6">Demo</h2>
          <div class="space-y-4">
            <a
              href="/components-showcase"
              class="inline-block bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-medium transition-colors">
              Components Showcase
            </a>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>
