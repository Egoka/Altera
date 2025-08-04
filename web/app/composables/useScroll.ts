import { ref, onMounted, onUnmounted } from "vue"

/**
 * Composable для глобального состояния скролла
 *
 * @description
 * Предоставляет реактивное состояние скролла страницы, которое может быть использовано
 * в любом компоненте приложения. Состояние автоматически синхронизируется между всеми
 * компонентами, использующими этот composable.
 *
 * @returns {Object} Объект с состоянием скролла
 * @returns {Ref<number>} scrollY - Текущая позиция скролла по Y
 * @returns {Ref<number>} scrollX - Текущая позиция скролла по X
 * @returns {Ref<boolean>} isScrolled - Флаг, указывающий что страница прокручена
 * @returns {Ref<number>} scrollDirection - Направление скролла (1 - вниз, -1 - вверх, 0 - нет движения)
 * @returns {Ref<boolean>} isHeaderVisible - Флаг видимости header
 * @returns {Function} isScrolledPast - Функция для проверки, прокручена ли страница дальше указанного порога
 * @returns {Function} getScrollPercentage - Функция для получения процента прокрутки страницы
 *
 * @example
 * // Базовое использование
 * const { scrollY, isScrolled, isScrolledPast } = useScroll()
 *
 * // Проверка, прокручена ли страница дальше 100px
 * const isPastHeader = isScrolledPast(100)
 *
 * // Использование в template
 * <div :class="{ 'fixed': isScrolled }">
 *
 * @example
 * // Анимация при скролле
 * const { scrollY, scrollDirection } = useScroll()
 *
 * // Компонент с анимацией
 * <div :class="{ 'animate-slide-up': scrollDirection === 1 }">
 *
 * @example
 * // Прогресс-бар скролла
 * const { getScrollPercentage } = useScroll()
 *
 * <div class="progress-bar">
 *   <div :style="{ width: `${getScrollPercentage()}%` }"></div>
 * </div>
 *
 * @example
 * // Условное отображение элементов
 * const { isScrolledPast } = useScroll()
 *
 * <div v-if="isScrolledPast(200)" class="floating-button">
 *   Вернуться наверх
 * </div>
 */
export function useScroll() {
  const scrollY = ref(0)
  const scrollX = ref(0)
  const isScrolled = ref(false)
  const scrollDirection = ref(0)
  const isHeaderVisible = ref(true)
  const lastScrollY = ref(0)
  const scrollStartY = ref(0) // Позиция начала скролла
  const isScrollingDown = ref(false) // Флаг скролла вниз

  // Порог для определения "прокрученности" страницы
  const SCROLL_THRESHOLD = 10
  // Порог для скрытия header при скролле вниз
  const HEADER_HIDE_THRESHOLD = 200
  // Минимальная разница в скролле для срабатывания анимации
  const SCROLL_DIFFERENCE_THRESHOLD = 5

  const handleScroll = () => {
    // Проверяем, что мы на клиенте
    if (process.client) {
      const currentScrollY = window.scrollY
      const currentScrollX = window.scrollX

      // Обновляем позиции
      scrollY.value = currentScrollY
      scrollX.value = currentScrollX

      // Определяем направление скролла только если разница значительная
      const scrollDifference = currentScrollY - lastScrollY.value

      if (Math.abs(scrollDifference) > SCROLL_DIFFERENCE_THRESHOLD) {
        if (scrollDifference > 0) {
          scrollDirection.value = 1 // Вниз

          // Если начинаем скролл вниз, запоминаем позицию
          if (!isScrollingDown.value) {
            scrollStartY.value = currentScrollY
            isScrollingDown.value = true
          }
        } else {
          scrollDirection.value = -1 // Вверх
          isScrollingDown.value = false
        }
      } else {
        scrollDirection.value = 0 // Нет движения
      }

      // Обновляем флаг прокрученности
      isScrolled.value = currentScrollY > SCROLL_THRESHOLD

      // Логика скрытия/показа header
      if (scrollDirection.value === 1 && isScrollingDown.value) {
        // Проверяем, прошли ли мы 150px от начала скролла вниз
        const scrollDistance = currentScrollY - scrollStartY.value
        if (scrollDistance >= HEADER_HIDE_THRESHOLD) {
          isHeaderVisible.value = false
        }
      } else if (scrollDirection.value === -1) {
        // Скролл вверх - показываем header
        isHeaderVisible.value = true
        isScrollingDown.value = false
      }

      // Если мы в самом верху страницы, всегда показываем header
      if (currentScrollY <= SCROLL_THRESHOLD) {
        isHeaderVisible.value = true
        isScrollingDown.value = false
      }

      lastScrollY.value = currentScrollY
    }
  }

  /**
   * Проверяет, прокручена ли страница дальше указанного порога
   * @param threshold - Порог в пикселях
   * @returns {boolean} true если страница прокручена дальше порога
   *
   * @example
   * const { isScrolledPast } = useScroll()
   * const showBackToTop = isScrolledPast(500)
   */
  const isScrolledPast = (threshold: number): boolean => {
    return scrollY.value > threshold
  }

  /**
   * Получает процент прокрутки страницы
   * @returns {number} Процент от 0 до 100
   *
   * @example
   * const { getScrollPercentage } = useScroll()
   * const progress = getScrollPercentage() // 0-100
   */
  const getScrollPercentage = (): number => {
    // Проверяем, что мы на клиенте и document доступен
    if (process.client && typeof document !== "undefined") {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      return docHeight > 0 ? (scrollY.value / docHeight) * 100 : 0
    }
    return 0
  }

  onMounted(() => {
    if (process.client) {
      window.addEventListener("scroll", handleScroll, { passive: true })
      // Инициализируем начальное состояние
      handleScroll()
    }
  })

  onUnmounted(() => {
    if (process.client) {
      window.removeEventListener("scroll", handleScroll)
    }
  })

  return {
    scrollY,
    scrollX,
    isScrolled,
    scrollDirection,
    isHeaderVisible,
    isScrolledPast,
    getScrollPercentage
  }
}
