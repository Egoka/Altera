<script setup lang="ts">
  import type { GroupMenu, ItemMenu, MenuExpose } from "#fishtvue"
  import { computed, onMounted, ref, watch } from "vue"
  import { getAdminNavigation } from "~/utils/admin"

  const adminStore = useAdminStore()
  const { summary } = useAdminDashboard()
  const { t } = useI18n()

  const toggleMenuCollapsed = () => {
    adminStore.toggleMenuCollapsed()
  }

  const menu = computed<GroupMenu[]>(() => [
    {
      class: "h-[calc(100vh-48px-112px-12px-13px-15px-40px)]",
      items: summary.value
        ? getAdminNavigation(summary.value.role).map((item) => ({
            name: item.id,
            title: t(`admin.sections.${item.id}`),
            icon: item.icon,
            to: item.to
          }))
        : []
    }
  ])

  const HEADER_HEIGHT = 56

  const menuApp = ref<MenuExpose>()
  const activePage = ref("")
  const isOpen = ref(false)
  const route = useRoute()

  const findActiveMenuItem = () => {
    return menuApp.value?.listGroups?.[0]?.items?.find((item) => {
      if (!item.to) return false
      // Точное совпадение
      if (item.to === route.path) return true
      // Исключение для Dashboard - только точное совпадение
      if (item.to === "/admin") return false
      // Проверка подроутеров: путь должен начинаться с item.to и следующий символ должен быть /
      return route.path.startsWith(item.to + "/")
    })
  }

  onMounted(() => {
    const activeItem = findActiveMenuItem()

    if (activeItem) {
      activePage.value = activeItem.to
      menuApp.value?.setSelectedItem?.(activeItem["_key"] ?? "")
    } else {
      activePage.value = menuApp.value?.listGroups?.[0]?.items?.[0]?.to
      menuApp.value?.setSelectedItem?.(menuApp.value?.listGroups?.[0]?.items?.[0]?.["_key"] ?? "")
    }
  })

  watch(
    () => route.path,
    () => {
      const activeItem = findActiveMenuItem()
      if (activeItem) {
        activePage.value = activeItem.to
        menuApp.value?.setSelectedItem?.(activeItem["_key"] ?? "")
      }
    }
  )
  function switchPage(_: unknown, data: ItemMenu) {
    isOpen.value = false
    activePage.value = data.to
    navigateTo(data.to)
  }

  const toggleMenu = () => {
    isOpen.value = !isOpen.value
  }
</script>

<template>
  <header>
    <div class="hidden md:flex h-[calc(100vh-24px)]">
      <Menu
        ref="menuApp"
        :groups="menu"
        :only-icons="adminStore.isMenuCollapsed"
        :class="[
          'w-full shadow-none border-0 bg-transparent dark:bg-transparent transition-all duration-300',
          adminStore.isMenuCollapsed ? 'min-w-[64px]' : 'min-w-[200px]'
        ]"
        :separator="{ classBodyLine: 'text-zinc-200 dark:text-zinc-500' }"
        :styles="{
          height: '100%',
          class: {
            body: 'p-3 z-30',
            title: 'p-0 mb-3 bg-transparent dark:bg-transparent',
            item: 'h-10 justify-start pl-3.5 mb-3 overflow-auto',
            separator: 'text-zinc-200 dark:text-zinc-500 t4444'
          },
          selectedRows: 'bg-zinc-100 dark:bg-zinc-950'
        }"
        selected
        @onClick="switchPage">
        <template #title>
          <NuxtLink to="/" class="h-10 flex items-center justify-start">
            <IconLogo class="ml-2 mb-0.5 size-6 fill-neutral-700 dark:fill-neutral-200" />
            <Transition
              enter-active-class="transition-all duration-300 ease-out"
              enter-from-class="opacity-0"
              enter-to-class="opacity-100"
              leave-active-class="transition-all duration-300 ease-in"
              leave-from-class="opacity-100"
              leave-to-class="opacity-0">
              <span
                v-if="!adminStore.isMenuCollapsed"
                class="text-neutral-700 dark:text-neutral-200 font-bergamasco font-light text-[2rem] pl-0.5 leading-6 transition-all duration-300 ease-in-out">
                ltera
              </span>
            </Transition>
          </NuxtLink>
          <Button
            mode="ghost"
            icon="uim:web-section-alt"
            class="my-4 mx-0 h-10 w-10 p-2"
            @click="toggleMenuCollapsed"></Button>
        </template>
        <template #item="{ data }">
          <Icons
            :type="data.icon"
            class="fv fishtvue-icons text-gray-900 dark:text-gray-100 h-5 w-4 opacity-60 select-none" />
          <Transition
            enter-active-class="transition-all duration-300 ease-out"
            enter-from-class="opacity-0"
            enter-to-class="opacity-100"
            leave-active-class="transition-all duration-300 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0">
            <span v-show="!adminStore.isMenuCollapsed" class="w-max ml-4">
              {{ data.title }}
            </span>
          </Transition>
          <FixWindow v-if="adminStore.isMenuCollapsed" position="right" :delay="500" :margin-px="10" mode="outlined">
            <span :data-title="!!data?.title" class="w-max">{{ data.title }}</span>
          </FixWindow>
        </template>
        <template #footer>
          <div v-if="summary" class="mt-[15px] flex items-center gap-3">
            <span class="flex size-10 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800">
              <Icons type="lucide:shield-check" class="size-5 text-zinc-700 dark:text-zinc-200" />
            </span>
            <Transition
              enter-active-class="transition-all duration-300 ease-out"
              enter-from-class="opacity-0"
              enter-to-class="opacity-100"
              leave-active-class="transition-all duration-300 ease-in"
              leave-from-class="opacity-100"
              leave-to-class="opacity-0">
              <div v-if="!adminStore.isMenuCollapsed" class="flex flex-col min-w-0">
                <div class="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {{ t(`admin.roles.${summary.role}`) }}
                </div>
              </div>
            </Transition>
          </div>
        </template>
      </Menu>
    </div>
    <div class="md:hidden h-14 w-screen">
      <div class="fixed top-0 left-0 right-0 z-50 bg-white dark:bg-zinc-900 transition-all duration-300 ease-in-out">
        <nav aria-label="Global" class="mx-auto flex max-w-7xl items-center justify-between h-14 px-3 lg:px-10">
          <div class="flex lg:hidden">
            <button
              type="button"
              class="w-10 ml-0 -m-2.5 inline-flex items-center justify-center rounded-md p-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              @click="toggleMenu">
              <span class="sr-only">Open main menu</span>
              <IconBurger :is-open="isOpen" />
            </button>
          </div>
          <div class="flex">
            <NuxtLink to="/" class="-m-1.5 p-1.5">
              <IconLogo class="size-6 fill-neutral-700 dark:fill-neutral-200" />
            </NuxtLink>
          </div>

          <div class="lg:flex lg:flex-1 lg:justify-end">
            <span class="flex size-8 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800">
              <Icons type="lucide:shield-check" class="size-4 text-zinc-700 dark:text-zinc-200" />
            </span>
          </div>
        </nav>
        <Transition
          enter-active-class="transition-all duration-300 ease-out"
          enter-from-class="opacity-0 -translate-x-full"
          enter-to-class="opacity-100 translate-x-0"
          leave-active-class="transition-all duration-300 ease-in"
          leave-from-class="opacity-100 translate-x-0"
          leave-to-class="opacity-0 -translate-x-full">
          <div
            v-if="isOpen"
            class="fixed z-50 bg-white dark:bg-zinc-900 shadow-xl"
            :style="{
              top: `${HEADER_HEIGHT}px`,
              height: `calc(100vh - ${HEADER_HEIGHT}px)`,
              width: '100vw'
            }">
            <Menu
              ref="menuApp"
              :groups="menu"
              :only-icons="false"
              class="shadow-none border-0 w-full h-full"
              :styles="{
                height: '100%',
                class: {
                  body: 'p-3 z-30',
                  item: 'h-10 justify-center ml-6 mb-3'
                },
                selectedRows: 'bg-zinc-100 dark:bg-zinc-900'
              }"
              selected
              @onClick="switchPage">
            </Menu>
          </div>
        </Transition>
      </div>
    </div>
  </header>
</template>
