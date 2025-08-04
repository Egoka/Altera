<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <div class="container mx-auto px-4 py-8">
      <h1 class="text-4xl font-bold text-gray-900 dark:text-white mb-8">
        {{ $t("components.showcase") }}
      </h1>

      <!-- Кнопки -->
      <section class="mb-12">
        <h2 class="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-6">
          {{ $t("components.buttons") }}
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <button class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded">Primary Button</button>
          <button class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded">Secondary Button</button>
          <button class="border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded">
            Outline Button
          </button>
          <button class="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded">Danger Button</button>
        </div>
      </section>

      <!-- Формы -->
      <section class="mb-12">
        <h2 class="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-6">
          {{ $t("components.forms") }}
        </h2>
        <div class="max-w-md space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {{ $t("auth.email") }}
            </label>
            <input
              type="email"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="example@email.com" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {{ $t("auth.password") }}
            </label>
            <input
              type="password"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"> Select Option </label>
            <select
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option>Option 1</option>
              <option>Option 2</option>
              <option>Option 3</option>
            </select>
          </div>
        </div>
      </section>

      <!-- Карточки -->
      <section class="mb-12">
        <h2 class="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-6">
          {{ $t("components.cards") }}
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
            <img src="https://via.placeholder.com/400x200" alt="Placeholder" class="w-full h-48 object-cover" />
            <div class="p-6">
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">Article Title</h3>
              <p class="text-gray-600 dark:text-gray-400 mb-4">
                This is a sample article description that shows how the card component looks with content.
              </p>
              <div class="flex justify-between items-center">
                <span class="text-sm text-gray-500 dark:text-gray-400"> {{ $t("common.readTime") }}: 5 min </span>
                <button class="text-blue-500 hover:text-blue-600 font-medium">
                  {{ $t("common.readMore") }}
                </button>
              </div>
            </div>
          </div>

          <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
            <div class="p-6">
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">Author Card</h3>
              <div class="flex items-center mb-4">
                <img src="https://via.placeholder.com/50x50" alt="Author" class="w-12 h-12 rounded-full mr-4" />
                <div>
                  <p class="font-medium text-gray-900 dark:text-white">Author Name</p>
                  <p class="text-sm text-gray-500 dark:text-gray-400">Author Bio</p>
                </div>
              </div>
              <button class="w-full bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded">View Profile</button>
            </div>
          </div>

          <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">Tag Card</h3>
            <div class="flex flex-wrap gap-2 mb-4">
              <span class="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm"> Technology </span>
              <span class="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm"> Science </span>
              <span class="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm"> Culture </span>
            </div>
            <p class="text-gray-600 dark:text-gray-400 mb-4">Tag description and usage statistics.</p>
            <button class="text-blue-500 hover:text-blue-600 font-medium">View Articles</button>
          </div>
        </div>
      </section>

      <!-- Навигация -->
      <section class="mb-12">
        <h2 class="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-6">
          {{ $t("components.navigation") }}
        </h2>
        <nav class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-8">
              <a href="#" class="text-gray-900 dark:text-white font-medium">
                {{ $t("common.home") }}
              </a>
              <a href="#" class="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
                {{ $t("common.articles") }}
              </a>
              <a href="#" class="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
                {{ $t("common.authors") }}
              </a>
              <a href="#" class="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
                {{ $t("common.tags") }}
              </a>
            </div>
            <div class="flex items-center space-x-4">
              <button class="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
                {{ $t("common.search") }}
              </button>
              <button class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded">
                {{ $t("common.login") }}
              </button>
            </div>
          </div>
        </nav>
      </section>

      <!-- Уведомления -->
      <section class="mb-12">
        <h2 class="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-6">
          {{ $t("components.notifications") }}
        </h2>
        <div class="space-y-4">
          <div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
            <strong>{{ $t("common.success") }}!</strong> Operation completed successfully.
          </div>
          <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <strong>{{ $t("common.error") }}!</strong> Something went wrong.
          </div>
          <div class="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded">
            <strong>Info:</strong> This is an informational message.
          </div>
          <div class="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
            <strong>Warning:</strong> Please check your input.
          </div>
        </div>
      </section>

      <!-- Загрузчики -->
      <section class="mb-12">
        <h2 class="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-6">
          {{ $t("components.loaders") }} {{ $t("test") }}
        </h2>
        <div class="flex items-center space-x-8">
          <div class="flex items-center space-x-2">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
            <span class="text-gray-600 dark:text-gray-400">{{ $t("common.loading") }}</span>
          </div>
          <div class="flex items-center space-x-2">
            <div class="animate-pulse bg-gray-300 dark:bg-gray-600 h-4 w-32 rounded" />
          </div>
          <div class="flex items-center space-x-2">
            <div class="animate-bounce bg-blue-500 h-4 w-4 rounded-full" />
            <span class="text-gray-600 dark:text-gray-400">Bouncing loader</span>
          </div>
        </div>
      </section>

      <!-- Переключатель темы -->
      <section class="mb-12">
        <h2 class="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-6">Theme Toggle</h2>
        <ThemeToggle />
      </section>

      <!-- Переключатель языка -->
      <section class="mb-12">
        <h2 class="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-6">Language Toggle</h2>
        <LanguageToggle />
      </section>
    </div>
  </div>
</template>

<script setup>
  // Компоненты ThemeToggle и LanguageToggle управляют своими состояниями
  // setLocale теперь доступен из useI18n()
</script>
