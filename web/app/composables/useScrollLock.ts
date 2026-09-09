import { ref } from "vue"

/**
 * Composable для блокировки скролла страницы
 *
 * @description
 * Предоставляет функциональность для блокировки и разблокировки скролла страницы.
 * Полезно для модальных окон, мега-меню и других оверлейных элементов.
 *
 * @returns {Object} Объект с функциями управления скроллом
 * @returns {Ref<boolean>} isLocked - Состояние блокировки скролла
 * @returns {Function} lockScroll - Функция для блокировки скролла
 * @returns {Function} unlockScroll - Функция для разблокировки скролла
 * @returns {Function} toggleScrollLock - Функция для переключения состояния блокировки
 *
 * @example
 * // Базовое использование
 * const { isLocked, lockScroll, unlockScroll } = useScrollLock()
 *
 * // Блокировка скролла при открытии модального окна
 * const openModal = () => {
 *   lockScroll()
 *   // показать модальное окно
 * }
 *
 * // Разблокировка скролла при закрытии
 * const closeModal = () => {
 *   unlockScroll()
 *   // скрыть модальное окно
 * }
 *
 * @example
 * // Автоматическая блокировка при изменении состояния
 * const isModalOpen = ref(false)
 * const { isLocked } = useScrollLock()
 *
 * watch(isModalOpen, (newValue) => {
 *   if (newValue) {
 *     lockScroll()
 *   } else {
 *     unlockScroll()
 *   }
 * })
 */
export function useScrollLock() {
  const isLocked = ref(false)
  const originalStyle = ref<string>("")
  const lockCount = ref(0) // Счетчик блокировок для множественных вызовов

  /**
   * Блокирует скролл страницы
   */
  const lockScroll = () => {
    if (import.meta.client) {
      lockCount.value++

      if (!isLocked.value) {
        // Сохраняем оригинальные стили только при первой блокировке
        originalStyle.value = document.body.style.overflow

        // Блокируем скролл
        document.body.style.overflow = "hidden"
        document.documentElement.style.overflow = "hidden"

        isLocked.value = true
      }
    }
  }

  /**
   * Разблокирует скролл страницы
   */
  const unlockScroll = () => {
    if (import.meta.client && isLocked.value) {
      lockCount.value = Math.max(0, lockCount.value - 1)

      // Разблокируем только когда все блокировки сняты
      if (lockCount.value === 0) {
        // Восстанавливаем оригинальные стили
        document.body.style.overflow = originalStyle.value
        document.documentElement.style.overflow = originalStyle.value

        isLocked.value = false
      }
    }
  }

  /**
   * Переключает состояние блокировки скролла
   */
  const toggleScrollLock = () => {
    if (isLocked.value) {
      unlockScroll()
    } else {
      lockScroll()
    }
  }

  /**
   * Принудительно разблокирует скролл (сбрасывает все блокировки)
   */
  const forceUnlockScroll = () => {
    if (import.meta.client && isLocked.value) {
      lockCount.value = 0
      document.body.style.overflow = originalStyle.value
      document.documentElement.style.overflow = originalStyle.value
      isLocked.value = false
    }
  }

  return {
    isLocked,
    lockScroll,
    unlockScroll,
    toggleScrollLock,
    forceUnlockScroll
  }
}
