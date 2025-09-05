<script setup lang="ts">
  import type { ArticleResponse } from "~/types/article"

  const props = defineProps<{
    article: ArticleResponse
  }>()
  const slug = computed(() => `/articles/${props.article.slug}`)
  const contentType = computed(() => `/types/${props.article.contentType.slug}`)
  const author = computed(() => `/authors/${props.article.author.slug}`)

  // Refs для composable
  const containerRef = ref<HTMLElement>()
  const titleRef = ref<HTMLElement>()
  const bottomRef = ref<HTMLElement>()

  // Используем composable для динамического line-clamp
  const { lineClampStyle, lineClampClasses } = useLineClamp(containerRef, titleRef, bottomRef, {
    lineHeight: 33, // text-lg + leading-relaxed
    maxLines: 8,
    minLines: 2
  })
</script>

<template>
  <article class="py-6 lg:py-8 text-center lg:text-left">
    <div class="flex flex-col lg:flex-row gap-6 lg:gap-8">
      <!-- Текстовая часть (левая сторона) -->
      <div ref="containerRef" class="h-64 lg:h-80 xl:h-96 flex flex-col flex-1 lg:max-w-1/2 order-2 lg:order-1">
        <!-- Заголовок -->
        <NuxtLink :to="slug" class="block group">
          <h2
            ref="titleRef"
            class="font-garamond-libre text-2xl lg:text-3xl xl:text-4xl font-medium text-zinc-900 dark:text-zinc-300 leading-tight">
            {{ article.title }}
          </h2>
        </NuxtLink>

        <!-- Подзаголовок -->
        <p
          v-if="article.dek"
          :class="[
            'font-garamond-libre text-justify text-lg lg:text-xl font-light leading-relaxed',
            'text-zinc-700 dark:text-zinc-300',
            'mb-4',
            lineClampClasses
          ]"
          :style="lineClampStyle">
          {{ article.dek }}
        </p>
        <div ref="bottomRef" class="mt-auto flex justify-between flex-wrap gap-x-3 flex-row items-start">
          <ShowAuthor :link="author" :name="article.author.name" class="block" />
          <ShowType :link="contentType" :name="article.contentType.name" class="block" />
        </div>
      </div>

      <!-- Изображение (правая сторона) -->
      <div class="flex-1 lg:max-w-1/2 order-1 lg:order-2">
        <figure class="relative">
          <NuxtLink :to="slug" class="block group">
            <NuxtImg
              :src="article.featuredImage"
              :alt="article.title"
              class="w-full h-64 lg:h-80 xl:h-96 object-cover rounded-lg transition-transform duration-300" />
          </NuxtLink>
        </figure>
      </div>
    </div>
  </article>
</template>
