<script setup lang="ts">
  import { computed } from "vue"
  import { useScroll } from "~/composables/useScroll"

  interface Props {
    scrollThreshold?: number
    animationDuration?: number
  }

  const props = withDefaults(defineProps<Props>(), {
    scrollThreshold: 50,
    animationDuration: 300
  })

  // Используем глобальное состояние скролла
  const { isScrolledPast } = useScroll()

  // Вычисляем состояние анимации на основе глобального скролла
  const isScrolled = computed(() => isScrolledPast(props.scrollThreshold))
  const textOpacity = computed(() => (isScrolled.value ? 0 : 1))
</script>

<template>
  <!-- Текстовая часть сворачивается через max-width, а не через фиксированную ширину:
       в развёрнутом виде она занимает ровно свою ширину, и знак целиком стоит по центру
       (жёсткие 100 px оставляли пустоту справа на телефоне и вылезали на широком экране). -->
  <div class="flex items-baseline">
    <IconLogo class="h-6 lg:h-8 w-auto fill-black dark:fill-zinc-200" />
    <span
      class="text-black dark:text-zinc-200 font-bergamasco font-light text-[2.2rem] lg:text-[2.8rem] pl-0.5 leading-6 overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out"
      :style="{
        opacity: textOpacity,
        transform: `translateX(${isScrolled ? '-10px' : '0px'})`,
        maxWidth: isScrolled ? '0px' : '8rem'
      }">
      ltera
    </span>
  </div>
</template>
