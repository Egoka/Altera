<template>
  <div class="flex space-x-2">
    <button
      :class="locale === 'en' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700'"
      class="px-4 py-2 rounded-lg transition-colors hover:bg-gray-300 dark:hover:bg-gray-600"
      @click="setLocale('en')">
      English
    </button>
    <button
      :class="locale === 'ru' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700'"
      class="px-4 py-2 rounded-lg transition-colors hover:bg-gray-300 dark:hover:bg-gray-600"
      @click="setLocale('ru')">
      Русский
    </button>
  </div>
</template>

<script setup lang="ts">
  const { locale, setLocale } = useI18n()
</script>
