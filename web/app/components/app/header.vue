<script setup lang="ts">
  import { ref, watch } from "vue"
  import LanguageToggle from "~/components/functional/LanguageToggle.vue"
  import IconBurger from "~/components/icon/Burger.vue"
  import VisualLogo from "~/components/visual/Logo.vue"
  import VisualMegaMenu from "~/components/visual/MegaMenu.vue"
  import { usePublicNavigation } from "~/composables/usePublicNavigation"
  import { useScroll } from "~/composables/useScroll"

  const { isScrolled, isHeaderVisible } = useScroll()
  const { t } = useI18n()
  const { sections, popularTags, status } = usePublicNavigation()
  const isMegaMenuOpen = ref(false)

  const toggleMegaMenu = () => {
    isMegaMenuOpen.value = !isMegaMenuOpen.value
  }
  const closeMegaMenu = () => {
    isMegaMenuOpen.value = false
  }

  watch(isHeaderVisible, (visible) => {
    if (!visible) closeMegaMenu()
  })
</script>

<template>
  <header
    class="fixed inset-x-0 top-0 z-50 border-b border-transparent bg-white transition-[transform,background-color,border-color] duration-300 motion-reduce:transition-none dark:bg-zinc-950"
    :class="{
      'border-zinc-200 bg-white/95 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95': isScrolled,
      '-translate-y-full': !isHeaderVisible,
      '!translate-y-0 border-zinc-200 !bg-white dark:border-zinc-800 dark:!bg-zinc-950': isMegaMenuOpen
    }"
    @keydown.esc="closeMegaMenu">
    <nav
      :aria-label="t('navigation.primary')"
      class="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
      <div class="flex flex-1 items-center gap-5">
        <button
          type="button"
          aria-controls="public-navigation-menu"
          :aria-expanded="isMegaMenuOpen"
          class="inline-flex min-h-11 items-center gap-2 font-sans text-sm font-semibold text-zinc-900 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100 dark:hover:text-orange-400"
          @click="toggleMegaMenu">
          <IconBurger class="lg:hidden" :is-open="isMegaMenuOpen" />
          <span>{{ t("navigation.sections") }}</span>
          <span class="hidden text-xs text-zinc-400 lg:inline" aria-hidden="true">{{
            isMegaMenuOpen ? "↑" : "↓"
          }}</span>
        </button>

        <NuxtLink
          v-for="section in sections.slice(0, 2)"
          :key="section.id"
          :to="`/${section.slug}`"
          class="hidden font-sans text-sm font-semibold text-zinc-700 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 xl:block dark:text-zinc-300 dark:hover:text-orange-400">
          {{ section.name }}
        </NuxtLink>
      </div>

      <NuxtLink
        to="/"
        class="p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600">
        <span class="sr-only">{{ t("common.logoHome") }}</span>
        <VisualLogo />
      </NuxtLink>

      <div class="flex flex-1 items-center justify-end gap-1 sm:gap-2">
        <LanguageToggle compact />
        <NuxtLink
          to="/login"
          class="hidden px-2 py-3 font-sans text-sm font-semibold text-zinc-800 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 sm:inline-flex dark:text-zinc-200">
          {{ t("common.login") }}
        </NuxtLink>
        <!-- Первый запуск бесплатный: «Писать» ведёт прямо в создание материала, а гостя
             страница создания перекладывает на вход с возвратом (журнал §25.1, `home.md` §7). -->
        <NuxtLink
          to="/me/articles/new"
          class="inline-flex min-h-10 items-center border border-zinc-900 px-3 font-sans text-sm font-semibold text-zinc-950 transition-colors hover:border-orange-700 hover:bg-orange-700 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 motion-reduce:transition-none dark:border-zinc-100 dark:text-zinc-100">
          {{ t("common.write") }}
        </NuxtLink>
      </div>
    </nav>

    <VisualMegaMenu
      :is-open="isMegaMenuOpen"
      :sections="sections"
      :popular-tags="popularTags"
      :loading="status === 'pending'"
      @close="closeMegaMenu" />
  </header>
</template>
