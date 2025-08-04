<script setup lang="ts">
  import { ref } from "vue"

  /**
   * Демонстрационный компонент для показа работы MegaMenu
   */
  const isMenuOpen = ref(false)

  const toggleMenu = () => {
    isMenuOpen.value = !isMenuOpen.value
  }
</script>

<template>
  <div class="fixed top-32 left-4 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-4 z-40 border border-gray-200">
    <div class="text-sm space-y-2">
      <div class="flex items-center gap-2">
        <span class="text-gray-600">MegaMenu:</span>
        <span :class="isMenuOpen ? 'text-green-600' : 'text-gray-500'" class="font-semibold">
          {{ isMenuOpen ? "Открыт" : "Закрыт" }}
        </span>
      </div>

      <div class="text-xs text-gray-500 max-w-xs">
        {{ isMenuOpen ? "Выдвигается под header на всю ширину" : "Нажмите кнопку для открытия" }}
      </div>

      <button
        class="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
        @click="toggleMenu">
        {{ isMenuOpen ? "Закрыть" : "Открыть" }} MegaMenu
      </button>

      <!-- Информация о функциональности -->
      <div class="text-xs text-gray-400 border-t pt-2 mt-2">
        <div>• Выдвигается под header</div>
        <div>• Полная ширина страницы</div>
        <div>• Плавная анимация</div>
        <div>• Стеклянный backdrop</div>
        <div>• Клик вне меню закрывает</div>
        <div>• Кнопка X для закрытия</div>
        <div>• Синхронизация с header</div>
        <div>• Автозакрытие при скрытии header</div>
      </div>
    </div>
  </div>
</template>
