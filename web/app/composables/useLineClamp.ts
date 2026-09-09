interface UseLineClampOptions {
  containerHeight?: number // Высота контейнера в пикселях
  lineHeight?: number // Высота одной строки текста в пикселях
  bottomOffset?: number // Отступ снизу для других элементов (автор, тип и т.д.)
  maxLines?: number // Максимальное количество строк
  minLines?: number // Минимальное количество строк
}

/**
 * Composable для динамического line-clamp текста
 *
 * @example
 * // Для больших статей с динамическими размерами
 * const bottomRef = ref<HTMLElement>()
 * const { lineClampStyle, lineClampClasses } = useLineClamp(containerRef, titleRef, bottomRef, {
 *   lineHeight: 20, // text-md + leading-tight
 *   maxLines: 6
 *   // containerHeight вычисляется автоматически из containerRef
 * })
 *
 * @example
 * // Для статей с фиксированной высотой контейнера
 * const { lineClampStyle, lineClampClasses } = useLineClamp(containerRef, titleRef, undefined, {
 *   containerHeight: 128, // h-32 = 128px (переопределяет высоту из DOM)
 *   lineHeight: 16, // text-sm + leading-tight
 *   bottomOffset: 40, // фиксированный отступ
 *   maxLines: 4
 * })
 *
 * @example
 * // Для карточек с динамическими размерами
 * const bottomRef = ref<HTMLElement>()
 * const { lineClampStyle, lineClampClasses } = useLineClamp(containerRef, titleRef, bottomRef, {
 *   lineHeight: 14, // text-xs + leading-tight
 *   maxLines: 3
 *   // containerHeight вычисляется автоматически из containerRef
 * })
 */

export function useLineClamp(
  containerRef: Ref<HTMLElement | undefined>,
  titleRef: Ref<HTMLElement | undefined>,
  bottomRef?: Ref<HTMLElement | undefined>,
  options: UseLineClampOptions = {}
) {
  const {
    containerHeight: fixedContainerHeight,
    lineHeight = 20,
    bottomOffset: staticBottomOffset = 60,
    maxLines = 6,
    minLines = 1
  } = options

  const lineClamp = ref(4)
  const lineClampStyle = computed(() => ({
    "--line-clamp": lineClamp.value
  }))

  const lineClampClasses = computed(() => "line-clamp-dynamic")

  const updateLineClamp = () => {
    if (!containerRef.value || !titleRef.value) return

    // Используем фиксированную высоту из options или динамическую высоту из DOM
    const containerHeight = fixedContainerHeight || containerRef.value.offsetHeight
    const titleHeight = titleRef.value.offsetHeight

    // Вычисляем динамический bottomOffset
    let dynamicBottomOffset = staticBottomOffset
    if (bottomRef?.value) {
      dynamicBottomOffset = bottomRef.value.offsetHeight + 16 // +16px для отступов
    }

    const availableHeight = containerHeight - titleHeight - dynamicBottomOffset

    const calculatedMaxLines = Math.max(minLines, Math.floor(availableHeight / lineHeight))

    lineClamp.value = Math.min(calculatedMaxLines, maxLines)
  }

  onMounted(() => {
    if (containerRef.value && titleRef.value) {
      const resizeObserver = new ResizeObserver(() => {
        nextTick(() => {
          updateLineClamp()
        })
      })

      resizeObserver.observe(containerRef.value)
      resizeObserver.observe(titleRef.value)

      // Добавляем наблюдение за нижним блоком, если он передан
      if (bottomRef?.value) {
        resizeObserver.observe(bottomRef.value)
      }

      // Первоначальное вычисление
      nextTick(() => {
        updateLineClamp()
      })

      onUnmounted(() => {
        resizeObserver.disconnect()
      })
    }
  })

  // Добавляем CSS стили в head
  onMounted(() => {
    const style = document.createElement("style")
    style.textContent = `
      @media (width >= 40rem){
        .line-clamp-dynamic {
          display: -webkit-box;
          -webkit-line-clamp: var(--line-clamp);
          line-clamp: var(--line-clamp);
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      }
    `
    document.head.appendChild(style)

    onUnmounted(() => {
      document.head.removeChild(style)
    })
  })

  return {
    lineClamp: readonly(lineClamp),
    lineClampStyle,
    lineClampClasses
  }
}
