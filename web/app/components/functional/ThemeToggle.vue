<template>
  <button
    :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
    class="bg-gray-200 dark:bg-gray-700 px-4 py-2 rounded-lg flex items-center space-x-2 transition-colors hover:bg-gray-300 dark:hover:bg-gray-600"
    @click="toggleTheme">
    <span v-if="isDark" class="text-xl">🌞</span>
    <span v-else class="text-xl">🌙</span>
    <span class="font-medium">
      {{ isDark ? "Light Mode" : "Dark Mode" }}
    </span>
  </button>
</template>

<script setup lang="ts">
  const { isDark, toggleTheme } = useTheme()
</script>
