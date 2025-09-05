<script setup lang="ts">
  import type { ArticleListItem } from "~/query/types"

  const props = defineProps<{
    article: ArticleListItem
  }>()
  const slug = computed(() => `/articles/${props.article.slug}`)
  const contentType = computed(() => `/types/${props.article.contentType.slug}`)

  // Refs для composable
  const containerRef = ref<HTMLElement>()
  const titleRef = ref<HTMLElement>()
  const bottomRef = ref<HTMLElement>()

  const { lineClampStyle, lineClampClasses } = useLineClamp(containerRef, titleRef, bottomRef, {
    lineHeight: 23,
    maxLines: 8,
    minLines: 2
  })
</script>

<template>
  <article v-if="slug && article.title">
    <div class="flex flex-row gap-6 items-stretch">
      <!-- Текст слева на больших экранах, внизу на малых -->
      <div ref="containerRef" class="max-h-48 flex flex-col flex-1 max-w-2/3 md:max-w-1/2 min-h-full">
        <div ref="titleRef" class="sm:mb-4">
          <NuxtLink
            :to="slug"
            class="font-garamond-libre text-lg md:text-2xl md:font-bold text-zinc-900 dark:text-zinc-300 transition-colors leading-tight">
            {{ article.title }}
          </NuxtLink>
        </div>
        <div
          v-if="article.dek"
          :class="[
            'hidden sm:block',
            'font-garamond-libre text-base md:text-lg font-light leading-tight',
            'text-zinc-900 dark:text-zinc-300',
            lineClampClasses
          ]"
          :style="lineClampStyle">
          {{ article.dek }}
        </div>
        <div ref="bottomRef" class="mt-auto flex justify-between flex-wrap gap-x-3 flex-row items-start">
          <ShowType :link="contentType" :name="article.contentType.name" />
          <ShowTime v-if="props.article.publishedAt" :time="props.article.publishedAt" />
        </div>
      </div>
      <!-- Изображение справа на больших экранах, сверху на малых -->
      <div class="flex-1 max-w-1/3 md:max-w-1/2">
        <figure class="relative">
          <NuxtLink :to="slug" class="block group">
            <NuxtImg
              :src="article.featuredImage"
              :alt="article.title"
              class="w-full min-w-28 h-auto max-h-48 rounded-sm object-cover transition-transform duration-300" />
          </NuxtLink>
        </figure>
      </div>
    </div>
  </article>
</template>
