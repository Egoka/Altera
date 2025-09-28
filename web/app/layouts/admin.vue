<script setup lang="ts"></script>

<template>
  <div class="flex flex-col md:flex-row w-full h-screen bg-zinc-100 dark:bg-zinc-900 sm:p-3 items-start gap-3">
    <AdminHeader />
    <AdminMain>
      <slot />
    </AdminMain>
  </div>
</template>
