<template>
  <header v-if="contentType" class="w-full border-b border-zinc-200 dark:border-zinc-800">
    <div class="w-full pb-8 pt-12 sm:pb-6 sm:pt-10 md:pb-10 md:pt-14">
      <div class="max-w-7xl mx-auto px-8 sm:px-10">
        <NuxtImg
          :alt="contentType.name + ' Icon'"
          class="block mx-auto mb-6 md:mb-6 sm:mb-4 w-30 h-30 object-cover invert-30 dark:invert-80"
          :src="contentType.iconUrl"
          width="120"
          height="120" />
        <h1
          class="font-waterway tracking-widest text-center text-5xl md:text-4xl sm:text-3xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
          {{ contentType.name }}
        </h1>
        <p
          class="text-xl md:text-lg sm:text-base text-zinc-600 dark:text-zinc-300 font-serif italic leading-relaxed max-w-2xl mx-auto">
          <em>{{ contentType.description }}</em>
        </p>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
  import type ContentType from "~/types/contentType"

  interface Props {
    contentType: ContentType
  }

  defineProps<Props>()
</script>
