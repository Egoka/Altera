<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    class="size-6 transition-all duration-300 ease-in-out text-gray-700 dark:text-gray-300"
    style="transform-origin: center">
    <!-- Верхняя линия -->
    <path
      d="M3.75 6.75h16.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="transition-all duration-300 ease-in-out"
      style="transform-origin: 12px 8px"
      :class="{
        'translate-y-[5.25px] rotate-45': isOpen,
        'translate-y-0 rotate-0': !isOpen
      }" />

    <!-- Средняя линия -->
    <path
      d="M3.75 12h16.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="transition-all duration-300 ease-in-out"
      style="transform-origin: 12px 12px"
      :class="{
        'opacity-0 scale-x-0': isOpen,
        'opacity-100 scale-x-100': !isOpen
      }" />

    <!-- Нижняя линия -->
    <path
      d="M3.75 17.25h16.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="transition-all duration-300 ease-in-out"
      style="transform-origin: 13px 17px"
      :class="{
        '-translate-y-[5.25px] -rotate-45': isOpen,
        'translate-y-0 rotate-0': !isOpen
      }" />
  </svg>
</template>

<script setup lang="ts">
  interface Props {
    isOpen: boolean
  }

  defineProps<Props>()
</script>
