<script setup lang="ts">
  defineProps<{ title: string; description?: string; actionLabel?: string; actionTo?: string }>()
</script>

<template>
  <section class="border-y border-zinc-200 py-16 text-center dark:border-zinc-800" aria-labelledby="empty-state-title">
    <h2 id="empty-state-title" class="font-waterway text-3xl tracking-wide text-zinc-950 dark:text-zinc-100">
      {{ title }}
    </h2>
    <p v-if="description" class="mx-auto mt-3 max-w-xl font-garamond-libre text-lg text-zinc-600 dark:text-zinc-400">
      {{ description }}
    </p>
    <NuxtLink
      v-if="actionLabel && actionTo"
      :to="actionTo"
      class="mt-7 inline-flex border-b-2 border-orange-600 pb-1 font-serif font-semibold text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
      {{ actionLabel }}
    </NuxtLink>
  </section>
</template>
