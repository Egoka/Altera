<script setup lang="ts">
  export interface LinkListItem {
    to: string
    label: string
    testid: string
  }

  // Зона 7 сводки (`dashboard.md` §5–6): служебные ссылки. Карточки «Админка» нет (журнал §25.2).
  defineProps<{ title: string; links: LinkListItem[] }>()
</script>

<template>
  <nav :aria-label="title" class="flex flex-col gap-2">
    <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">{{ title }}</h2>
    <ul class="flex flex-col gap-2 font-sans text-sm">
      <li v-for="link in links" :key="link.to">
        <NuxtLink
          :to="link.to"
          :data-testid="link.testid"
          class="border-b border-zinc-300 pb-0.5 text-zinc-700 hover:border-orange-600 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:border-zinc-700 dark:text-zinc-300">
          {{ link.label }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
