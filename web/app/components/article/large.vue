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
    <div class="flex flex-col sm:flex-row gap-6 items-start">
      <!-- Текст (слева на sm+, снизу на минимальном экране) -->
      <div class="flex-1 sm:max-w-1/2 order-2 sm:order-1">
        <div class="mb-4">
          <NuxtLink
            :to="slug"
            class="font-garamond-libre text-2xl font-bold text-gray-900 dark:text-white transition-colors leading-tight mb-5">
            {{ article.title }}
          </NuxtLink>
        </div>
        <div
          v-if="article.dek"
          class="font-garamond-libre text-md text-gray-900 dark:text-white font-light leading-tight mb-4">
          {{ article.dek }}
        </div>
        <NuxtLink
          :to="author"
          class="font-waterway text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 uppercase tracking-wide">
          {{ article.author.name }}
        </NuxtLink>
      </div>

      <!-- Изображение (справа на sm+, сверху на минимальном экране) -->
      <div class="flex-1 sm:max-w-1/2 order-1 sm:order-2">
        <figure class="relative">
          <NuxtLink :to="slug" class="block group">
            <NuxtImg
              :src="article.featuredImage"
              :alt="article.title"
              class="w-full h-48 max-h-48 rounded-sm object-cover transition-transform duration-300" />
          </NuxtLink>

          <figcaption class="text-xs text-gray-500 dark:text-gray-400 font-light mt-2">
            <NuxtLink :to="contentType" class="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
              {{ article.contentType.name }}
            </NuxtLink>
          </figcaption>
        </figure>
      </div>
    </div>
  </article>
</template>
