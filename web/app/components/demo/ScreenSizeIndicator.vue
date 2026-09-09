<script setup lang="ts">
  import { ref, onMounted, onUnmounted } from "vue"

  /**
   * Компонент-индикатор размера экрана
   *
   * @description
   * Демонстрирует текущий размер экрана в соответствии с брейкпоинтами Tailwind CSS.
   * Показывает активные брейкпоинты и размеры экрана.
   */
  const screenWidth = ref(0)
  const screenHeight = ref(0)
  const activeBreakpoints = ref<Array<string>>([])

  // Брейкпоинты Tailwind CSS
  const breakpoints = {
    sm: 640,
    md: 768,
    lg: 1024,
    xl: 1280,
    "2xl": 1536
  }

  function getActiveBreakpoints(width: number) {
    const active: string[] = []

    if (width >= breakpoints["2xl"]) {
      active.push("2xl")
    }
    if (width >= breakpoints.xl) {
      active.push("xl")
    }
    if (width >= breakpoints.lg) {
      active.push("lg")
    }
    if (width >= breakpoints.md) {
      active.push("md")
    }
    if (width >= breakpoints.sm) {
      active.push("sm")
    }

    return active
  }

  const updateScreenSize = () => {
    if (import.meta.client) {
      screenWidth.value = window.innerWidth
      screenHeight.value = window.innerHeight
      activeBreakpoints.value = getActiveBreakpoints(screenWidth.value)
    }
  }

  onMounted(() => {
    updateScreenSize()
    window.addEventListener("resize", updateScreenSize)
  })

  onUnmounted(() => {
    window.removeEventListener("resize", updateScreenSize)
  })

  const getBreakpointColor = (breakpoint: string) => {
    const isActive = activeBreakpoints.value.includes(breakpoint)
    return isActive ? "text-green-600 font-semibold" : "text-gray-400"
  }

  const getBreakpointIcon = (breakpoint: string) => {
    const isActive = activeBreakpoints.value.includes(breakpoint)
    return isActive ? "●" : "○"
  }
</script>

<template>
  <div class="fixed bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-4 z-50 border border-gray-200">
    <div class="text-sm space-y-3">
      <div class="font-semibold text-gray-800 mb-2">Размер экрана</div>

      <!-- Размеры экрана -->
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <span class="text-gray-600">Ширина:</span>
          <span class="font-mono">{{ screenWidth }}px</span>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-gray-600">Высота:</span>
          <span class="font-mono">{{ screenHeight }}px</span>
        </div>
      </div>

      <!-- Брейкпоинты -->
      <div class="space-y-1">
        <div class="text-gray-600 text-xs mb-1">Брейкпоинты Tailwind:</div>
        <div class="space-y-1">
          <div v-for="(width, breakpoint) in breakpoints" :key="breakpoint" class="flex items-center gap-2">
            <span class="text-xs">{{ getBreakpointIcon(breakpoint) }}</span>
            <span :class="getBreakpointColor(breakpoint)" class="text-xs"> {{ breakpoint }}: {{ width }}px </span>
          </div>
        </div>
      </div>

      <!-- Активные брейкпоинты -->
      <div class="pt-2 border-t border-gray-200">
        <div class="text-gray-600 text-xs mb-1">Активные:</div>
        <div class="flex flex-wrap gap-1">
          <span
            v-for="breakpoint in activeBreakpoints"
            :key="breakpoint"
            class="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
            {{ breakpoint }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
