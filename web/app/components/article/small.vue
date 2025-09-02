<script setup lang="ts">
  import type { ArticleResponse } from "~/types/article"

  const props = defineProps<{
    article: ArticleResponse
  }>()
  const slug = computed(() => `/articles/${props.article.slug}`)
  const contentType = computed(() => `/types/${props.article.contentType.slug}`)
  const author = computed(() => `/authors/${props.article.author.slug}`)
</script>

<template>
  <article v-if="slug && article.title">
    <div class="flex flex-row gap-6 items-start">
      <div class="flex-1 min-w-0">
        <div class="mb-2 leading-4">
          <NuxtLink
            :to="slug"
            class="font-garamond-libre text-md font-medium text-zinc-900 dark:text-zinc-300 transition-colors mb-5">
            {{ article.title }}
          </NuxtLink>
        </div>
        <NuxtLink
          :to="author"
          class="font-waterway text-[10px] font-medium text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
          {{ article.author.name }}
        </NuxtLink>
      </div>

      <!-- Изображение (правая сторона) -->
      <figure class="relative flex-shrink-0">
        <NuxtLink :to="slug" class="block group">
          <NuxtImg
            :src="article.featuredImage"
            :alt="article.title"
            class="max-w-28 w-28 h-20 rounded-sm object-cover transition-transform duration-300" />
        </NuxtLink>

        <figcaption class="text-xs text-zinc-500 dark:text-zinc-400 font-light mt-2">
          <NuxtLink :to="contentType" class="transition-colors">
            {{ article.contentType.name }}
          </NuxtLink>
        </figcaption>
      </figure>
    </div>
  </article>
</template>
