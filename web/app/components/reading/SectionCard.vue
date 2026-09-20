<script setup lang="ts">
  /**
   * Карточка рубрики каталога: обложка или цветная плашка по токену, название, описание,
   * счётчик и до трёх превью материалов ссылками (`sections-index.md` §5).
   */
  defineProps<{
    section: {
      slug: string
      name: string
      description?: string | null
      cover?: string | null
      articleCount: number
      preview: readonly { title: string; path: string; author: string }[]
    }
    countLabel: string
  }>()
</script>

<template>
  <article class="flex flex-col gap-4">
    <NuxtLink :to="`/${section.slug}`" class="block">
      <NuxtImg v-if="section.cover" :src="section.cover" :alt="section.name" class="aspect-video w-full object-cover" />
      <div v-else class="aspect-video w-full bg-zinc-100 dark:bg-zinc-900" aria-hidden="true"></div>
    </NuxtLink>

    <div>
      <h2 class="font-waterway text-2xl tracking-wide text-zinc-950 dark:text-zinc-100">
        <NuxtLink :to="`/${section.slug}`" class="transition-colors duration-300 hover:text-red-700">
          {{ section.name }}
        </NuxtLink>
      </h2>
      <p class="mt-1 font-sans text-xs font-bold uppercase text-zinc-500 dark:text-zinc-500">
        {{ countLabel }}
      </p>
      <p
        v-if="section.description"
        class="mt-3 line-clamp-3 font-garamond-libre text-lg text-zinc-600 dark:text-zinc-400">
        {{ section.description }}
      </p>
    </div>

    <!-- Превью — последние материалы рубрики; на узких экранах остаётся один. -->
    <ul v-if="section.preview.length" class="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <li v-for="(article, index) in section.preview" :key="article.path" :class="index > 0 ? 'hidden sm:block' : ''">
        <NuxtLink
          :to="article.path"
          class="font-garamond-libre text-base text-zinc-700 transition-colors duration-300 hover:text-red-700 dark:text-zinc-300 dark:hover:text-red-400">
          {{ article.title }}
        </NuxtLink>
      </li>
    </ul>
  </article>
</template>
