<script setup lang="ts">
  import { useScroll } from "~/composables/useScroll"
  import { ref, watch } from "vue"

  // Используем глобальное состояние скролла
  const { isScrolled, isHeaderVisible } = useScroll()

  // Состояние для MegaMenu
  const isMegaMenuOpen = ref(false)

  const toggleMegaMenu = () => {
    isMegaMenuOpen.value = !isMegaMenuOpen.value
  }

  const closeMegaMenu = () => {
    isMegaMenuOpen.value = false
  }

  // Автоматически закрываем MegaMenu при скрытии header
  watch(isHeaderVisible, (newValue) => {
    if (!newValue && isMegaMenuOpen.value) {
      isMegaMenuOpen.value = false
    }
  })
</script>

<template>
  <header
    class="fixed top-0 left-0 right-0 z-50 bg-white dark:bg-zinc-900 transition-all duration-300 ease-in-out"
    :class="{
      'shadow-lg': isScrolled,
      '!bg-transparent': !isScrolled,
      'bg-white/75 dark:bg-zinc-950/75 backdrop-blur-sm': isScrolled,
      '!bg-white dark:!bg-zinc-950': isMegaMenuOpen,
      '-translate-y-full': !isHeaderVisible
    }">
    <nav aria-label="Global" class="mx-auto flex max-w-7xl items-center justify-between h-14 px-3 lg:px-10">
      <div class="hidden lg:flex lg:flex-1 lg:gap-x-12">
        <button
          :class="{
            'text-zinc-600 dark:text-zinc-100': isMegaMenuOpen,
            'text-zinc-900 dark:text-zinc-300': !isMegaMenuOpen
          }"
          class="relative flex items-center gap-x-1 py-3.5 text-sm/6 font-semibold transition-colors cursor-pointer"
          @click="toggleMegaMenu">
          Topics
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            data-slot="icon"
            aria-hidden="true"
            :class="{
              'text-zinc-600 dark:text-zinc-100 rotate-180': isMegaMenuOpen,
              'text-zinc-400 dark:text-zinc-500': !isMegaMenuOpen
            }"
            class="size-5 flex-none transition-transform duration-200">
            <path
              d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
              clip-rule="evenodd"
              fill-rule="evenodd" />
          </svg>
        </button>

        <NuxtLink to="/types/popular" class="py-3.5 text-sm/6 font-semibold text-zinc-900 dark:text-zinc-300">
          Popular
        </NuxtLink>
        <NuxtLink to="/types/latest" class="py-3.5 text-sm/6 font-semibold text-zinc-900 dark:text-zinc-300">
          Latest
        </NuxtLink>
      </div>
      <div class="flex lg:hidden">
        <button
          type="button"
          class="w-14 -m-2.5 inline-flex items-center justify-center rounded-md p-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          @click="toggleMegaMenu">
          <span class="sr-only">Open main menu</span>
          <IconBurger :is-open="isMegaMenuOpen" />
        </button>
      </div>
      <div class="flex">
        <a href="#" class="-m-1.5 p-1.5">
          <span class="sr-only">Altera</span>
          <VisualLogo />
        </a>
      </div>

      <div class="lg:flex lg:flex-1 lg:justify-end">
        <a href="#" class="px-2 py-3.5 text-sm/6 font-semibold text-zinc-900 dark:text-zinc-300">Log in</a>
      </div>
    </nav>
    <VisualMegaMenu :is-open="isMegaMenuOpen && isHeaderVisible" @close="closeMegaMenu" />
  </header>
</template>

<style scoped></style>
