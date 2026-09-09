import { ref, onMounted, onUnmounted } from "vue"

/**
 * Composable для определения breakpoint'ов Tailwind
 *
 * @description
 * Предоставляет реактивные значения для определения текущего breakpoint'а экрана
 * на основе стандартных breakpoint'ов Tailwind CSS.
 *
 * @returns {Object} Объект с breakpoint'ами
 * @returns {Ref<boolean>} isSm - Экран sm (640px и выше)
 * @returns {Ref<boolean>} isMd - Экран md (768px и выше)
 * @returns {Ref<boolean>} isLg - Экран lg (1024px и выше)
 * @returns {Ref<boolean>} isXl - Экран xl (1280px и выше)
 * @returns {Ref<boolean>} is2xl - Экран 2xl (1536px и выше)
 * @returns {Function} getBreakpoint - Функция для получения текущего breakpoint'а
 *
 * @example
 * // Базовое использование
 * const { isLg, isMd } = useBreakpoint()
 *
 * // Условное отображение
 * <div v-if="isLg">Только на больших экранах</div>
 * <div v-if="!isLg">Только на мобильных и планшетах</div>
 *
 * @example
 * // Использование в computed
 * const menuHeight = computed(() => {
 *   return isLg.value ? '450px' : 'calc(100vh - 56px)'
 * })
 *
 * @example
 * // Получение текущего breakpoint'а
 * const { getBreakpoint } = useBreakpoint()
 * const currentBreakpoint = getBreakpoint() // 'sm', 'md', 'lg', 'xl', '2xl'
 */
export function useBreakpoint() {
  const isSm = ref(false)
  const isMd = ref(false)
  const isLg = ref(false)
  const isXl = ref(false)
  const is2xl = ref(false)

  // Breakpoint'ы Tailwind CSS
  const BREAKPOINTS = {
    sm: 640,
    md: 768,
    lg: 1024,
    xl: 1280,
    "2xl": 1536
  }

  /**
   * Обновляет состояние breakpoint'ов на основе текущей ширины экрана
   */
  const updateBreakpoints = () => {
    if (process.client) {
      const width = window.innerWidth

      isSm.value = width >= BREAKPOINTS.sm
      isMd.value = width >= BREAKPOINTS.md
      isLg.value = width >= BREAKPOINTS.lg
      isXl.value = width >= BREAKPOINTS.xl
      is2xl.value = width >= BREAKPOINTS["2xl"]
    }
  }

  /**
   * Возвращает текущий breakpoint как строку
   * @returns {string} Текущий breakpoint ('sm', 'md', 'lg', 'xl', '2xl')
   */
  const getBreakpoint = (): string => {
    if (process.client) {
      const width = window.innerWidth

      if (width >= BREAKPOINTS["2xl"]) return "2xl"
      if (width >= BREAKPOINTS.xl) return "xl"
      if (width >= BREAKPOINTS.lg) return "lg"
      if (width >= BREAKPOINTS.md) return "md"
      if (width >= BREAKPOINTS.sm) return "sm"
      return "xs" // Меньше 640px
    }
    return "lg" // Fallback для SSR
  }

  onMounted(() => {
    if (process.client) {
      // Инициализируем начальное состояние
      updateBreakpoints()

      // Добавляем обработчик изменения размера окна
      window.addEventListener("resize", updateBreakpoints, { passive: true })
    }
  })

  onUnmounted(() => {
    if (process.client) {
      window.removeEventListener("resize", updateBreakpoints)
    }
  })

  return {
    isSm,
    isMd,
    isLg,
    isXl,
    is2xl,
    getBreakpoint
  }
}
