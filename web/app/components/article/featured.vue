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
  <article class="py-6 lg:py-8 text-center lg:text-left">
    <div class="flex flex-col lg:flex-row gap-6 lg:gap-8">
      <!-- Текстовая часть (левая сторона) -->
      <div class="flex-1 lg:max-w-1/2">
        <div class="space-y-4">
          <!-- Заголовок -->
          <NuxtLink :to="slug" class="block group">
            <h2
              class="font-garamond-libre text-2xl lg:text-3xl xl:text-4xl font-medium text-zinc-900 dark:text-zinc-300 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-tight">
              {{ article.title }}
            </h2>
          </NuxtLink>

          <!-- Подзаголовок -->
          <p
            v-if="article.dek"
            class="font-waterway text-lg lg:text-xl text-zinc-700 dark:text-zinc-300 font-light leading-relaxed">
            {{ article.dek }}
          </p>

          <!-- Автор -->
          <div class="pt-2">
            <NuxtLink
              :to="author"
              class="font-waterway text-sm lg:text-base font-medium text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 uppercase tracking-wider transition-colors">
              {{ article.author.name }}
            </NuxtLink>
          </div>

          <!-- Тип контента -->
          <div class="pt-1">
            <NuxtLink
              :to="contentType"
              class="text-xs lg:text-sm text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors font-light">
              {{ article.contentType.name }}
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Изображение (правая сторона) -->
      <div class="flex-1 lg:max-w-1/2">
        <figure class="relative">
          <NuxtLink :to="slug" class="block group">
            <NuxtImg
              :src="article.featuredImage"
              :alt="article.title"
              class="w-full h-64 lg:h-80 xl:h-96 object-cover rounded-lg transition-transform duration-300 group-hover:scale-[1.02]" />
          </NuxtLink>

          <!-- Кредиты фотографа (как на изображении) -->
          <figcaption class="text-xs text-zinc-500 dark:text-zinc-400 font-light mt-2 text-right">
            <span class="opacity-75">© {{ article.author.name }}</span>
          </figcaption>
        </figure>
      </div>
    </div>
  </article>
</template>
