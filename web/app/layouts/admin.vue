<script setup lang="ts">
  import AdminHeader from "@/components/admin/header.vue"
  import AdminMain from "@/components/admin/main.vue"

  const adminStore = useAdminStore()

  // Инициализация из localStorage при монтировании
  onMounted(() => {
    adminStore.initFromLocalStorage()
  })
</script>

<template>
  <div class="flex flex-col md:flex-row w-full h-screen bg-white dark:bg-zinc-800 sm:p-3 items-start gap-0 md:gap-3">
    <AdminHeader
      :class="['transition-all duration-300', adminStore.isMenuCollapsed ? 'w-[68px]' : 'w-[250px]']" />
    <AdminMain
      :class="[
        'transition-all duration-300',
        adminStore.isMenuCollapsed ? 'w-screen sm:w-full md:w-[calc(100vw-106px)]' : 'w-screen sm:w-full md:w-[calc(100vw-286px)]'
      ]">
      <slot />
    </AdminMain>
  </div>
</template>
