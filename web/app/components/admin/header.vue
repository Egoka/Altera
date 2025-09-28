<script setup lang="ts">
  import type { GroupMenu, ItemMenu, MenuExpose } from "#fishtvue"

  const menuGroups = (): GroupMenu[] => {
    const { $i18n } = useNuxtApp()
    const { t } = $i18n
    return [
      {
        class: "item-menu",
        items: [
          {
            name: "Dashboard",
            title: t("admin.menu.Dashboard"),
            icon: "lucide:layout-dashboard",
            to: "/admin"
          },
          {
            title: t("admin.menu.Articles"),
            icon: "lucide:file-text",
            to: "/admin/articles"
          },
          {
            title: t("admin.menu.Types"),
            icon: "lucide:layers",
            to: "/admin/types"
          },
          {
            title: t("admin.menu.Users"),
            icon: "lucide:users",
            to: "/admin/users"
          },
          {
            title: t("admin.menu.Tags"),
            icon: "lucide:tag",
            to: "/admin/tags"
          }
        ]
      }
    ]
  }

  const HEADER_HEIGHT = 56

  const menuApp = ref<MenuExpose>()
  const activePage = ref("")
  const isOpen = ref(false)
  const menu = ref(menuGroups())
  const route = useRoute()

  const findActiveMenuItem = () => menuApp.value?.listGroups[0]?.items?.find((item) => item.to === route.path)

  onMounted(() => {
    const activeItem = findActiveMenuItem()
    if (activeItem) {
      activePage.value = activeItem.to
      menuApp.value?.setSelectedItem(activeItem["_key"] ?? "")
    } else {
      activePage.value = menuApp.value?.listGroups?.[0]?.items?.[0]?.to
      menuApp.value?.setSelectedItem(menuApp.value?.listGroups[0]?.items?.[0]?.["_key"] ?? "")
    }
  })

  watch(
    () => route.path,
    () => {
      const activeItem = findActiveMenuItem()
      if (activeItem) {
        activePage.value = activeItem.to
        menuApp.value?.setSelectedItem(activeItem["_key"] ?? "")
      }
    }
  )
  function switchPage(_: any, data: ItemMenu) {
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
    <div class="hidden md:flex h-full">
      <Menu
        ref="menuApp"
        :groups="menu"
        only-icons
        class="shadow-none border-0 min-w-[64px]"
        :styles="{
          height: '100%',
          class: {
            body: 'p-3 z-30',
            title: 'p-0 mb-3',
            item: 'size-10 justify-center mb-3'
          },
          selectedRows: 'bg-zinc-100 dark:bg-zinc-900'
        }"
        selected
        @onClick="switchPage">
        <template #title>
          <NuxtLink to="/" class="size-10 flex items-center justify-center">
            <IconLogo class="size-6 fill-neutral-700 dark:fill-neutral-200" />
          </NuxtLink>
        </template>
        <template #footer>
          <img src="/avatars/William_Taylor.jpg" alt="avatar" class="mt-3 size-10 rounded-full object-cover" />
        </template>
      </Menu>
    </div>
    <div class="md:hidden h-11 w-[calc(100vw-24px)]">
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
            <img src="/avatars/William_Taylor.jpg" alt="avatar" class="size-8 rounded-full object-cover" />
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

<style scoped lang="css">
  :deep(.item-menu) {
    height: calc(100vh - 48px - 52px - 13px - 56px);
  }
</style>
