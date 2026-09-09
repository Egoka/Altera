<script setup lang="ts">
  import type SectionTag from "~/types/sectionTag"

  interface Props {
    tag: SectionTag
  }
  defineProps<Props>()
</script>

<template>
  <header v-if="tag" class="w-full border-b border-zinc-200 dark:border-zinc-800">
    <div class="w-full pb-8 pt-12 sm:pb-6 sm:pt-10 md:pb-10 md:pt-14">
      <div class="max-w-7xl mx-auto px-8 sm:px-10">
        <h1
          class="font-waterway tracking-widest text-center md:text-left text-3xl md:text-4xl sm:text-3xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
          {{ tag.name }}
        </h1>
      </div>
    </div>
  </header>
</template>

<style scoped></style>
