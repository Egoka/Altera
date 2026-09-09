<script setup lang="ts">
  import { computed } from "vue"
  import { useScroll } from "~/composables/useScroll"

  /**
   * Компонент-индикатор скролла
   *
   * @description
   * Демонстрирует использование глобального состояния скролла.
   * Показывает текущую позицию скролла, направление и процент прокрутки.
   */
  const { scrollY, scrollDirection, getScrollPercentage } = useScroll()

  const scrollDirectionText = computed(() => {
    switch (scrollDirection.value) {
      case 1:
        return "↓ Вниз"
      case -1:
        return "↑ Вверх"
      default:
        return "— Остановлено"
    }
  })

  const scrollDirectionColor = computed(() => {
    switch (scrollDirection.value) {
      case 1:
        return "text-green-600"
      case -1:
        return "text-blue-600"
      default:
        return "text-gray-500"
    }
  })
</script>

<template>
  <div class="fixed bottom-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-4 z-50 border border-gray-200">
    <div class="text-sm space-y-2">
      <div class="flex items-center gap-2">
        <span class="text-gray-600">Позиция:</span>
        <span class="font-mono">{{ Math.round(scrollY) }}px</span>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-gray-600">Направление:</span>
        <span :class="scrollDirectionColor">{{ scrollDirectionText }}</span>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-gray-600">Прогресс:</span>
        <span class="font-mono">{{ Math.round(getScrollPercentage()) }}%</span>
      </div>

      <!-- Прогресс-бар -->
      <div class="w-full bg-gray-200 rounded-full h-2">
        <div
          class="bg-blue-600 h-2 rounded-full transition-all duration-300"
          :style="{ width: `${getScrollPercentage()}%` }" />
      </div>
    </div>
  </div>
</template>
