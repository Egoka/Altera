<script setup lang="ts">
  import { computed } from "vue"
  import { useScroll } from "~/composables/useScroll"

  /**
   * Демонстрационный компонент для показа работы анимации header
   */
  const { isHeaderVisible, scrollDirection, scrollY } = useScroll()

  const headerStatus = computed(() => {
    if (!isHeaderVisible.value) return "Скрыт"
    if (scrollDirection.value === 1) return "Скролл вниз"
    if (scrollDirection.value === -1) return "Скролл вверх"
    return "Видим"
  })

  const headerStatusColor = computed(() => {
    if (!isHeaderVisible.value) return "text-red-600"
    if (scrollDirection.value === 1) return "text-yellow-600"
    if (scrollDirection.value === -1) return "text-green-600"
    return "text-blue-600"
  })

  const headerStatusDescription = computed(() => {
    if (!isHeaderVisible.value) return "Скрыт после 150px скролла вниз"
    if (scrollDirection.value === 1) return "Скролл вниз - ждем 150px"
    if (scrollDirection.value === -1) return "Скролл вверх - показываем"
    return "Ожидание скролла"
  })
</script>

<template>
  <div class="fixed top-20 left-4 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-4 z-40 border border-gray-200">
    <div class="text-sm space-y-2">
      <div class="flex items-center gap-2">
        <span class="text-gray-600">Header:</span>
        <span :class="headerStatusColor" class="font-semibold">{{ headerStatus }}</span>
      </div>

      <div class="text-xs text-gray-500 max-w-xs">
        {{ headerStatusDescription }}
      </div>

      <div class="flex items-center gap-2">
        <span class="text-gray-600">Позиция:</span>
        <span class="font-mono">{{ Math.round(scrollY) }}px</span>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-gray-600">Направление:</span>
        <span class="font-mono">
          {{ scrollDirection === 1 ? "↓ Вниз" : scrollDirection === -1 ? "↑ Вверх" : "— Остановлено" }}
        </span>
      </div>

      <!-- Индикатор видимости -->
      <div class="flex items-center gap-2">
        <span class="text-gray-600">Видимость:</span>
        <div class="w-4 h-4 rounded-full" :class="isHeaderVisible ? 'bg-green-500' : 'bg-red-500'" />
      </div>

      <!-- Информация о логике -->
      <div class="text-xs text-gray-400 border-t pt-2 mt-2">
        <div>• Скрывается после 150px скролла вниз</div>
        <div>• Показывается при любом скролле вверх</div>
        <div>• Всегда видим в самом верху</div>
      </div>
    </div>
  </div>
</template>
