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
    lineHeight: 20, // text-md + leading-tight
    maxLines: 6,
    minLines: 1
    // containerHeight вычисляется автоматически из containerRef
  })
</script>

<template>
  <article v-if="slug && article.title">
    <div class="flex flex-col sm:flex-row gap-6 items-start">
      <div ref="containerRef" class="h-48 max-h-48 flex flex-col flex-1 sm:max-w-1/2 order-2 sm:order-1">
        <div ref="titleRef" class="mb-4">
          <NuxtLink
            :to="slug"
            class="font-garamond-libre text-2xl font-bold text-zinc-900 dark:text-zinc-300 transition-colors leading-tight mb-5">
            {{ article.title }}
          </NuxtLink>
        </div>
        <div
          v-if="article.dek"
          :class="[
            'font-garamond-libre text-md font-light leading-tight',
            'text-zinc-900 dark:text-zinc-300',
            'mb-4',
            lineClampClasses
          ]"
          :style="lineClampStyle">
          {{ article.dek }}
        </div>
        <div ref="bottomRef" class="mt-auto flex justify-between flex-wrap gap-x-3 flex-row items-start">
          <ShowAuthor :link="author" :name="article.author.name" class="block" />
          <ShowType :link="contentType" :name="article.contentType.name" class="block" />
        </div>
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
        </figure>
      </div>
    </div>
  </article>
</template>
