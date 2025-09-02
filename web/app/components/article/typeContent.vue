<script setup lang="ts">
  import type { ArticleResponse } from "~/types/article"
  import { format, parseISO } from "date-fns"

  const props = defineProps<{
    article: ArticleResponse
  }>()
  const slug = computed(() => `/articles/${props.article.slug}`)
  const author = computed(() => `/authors/${props.article.author.slug}`)

  const formattedDate = computed(() => {
    if (props.article.publishedAt) {
      return format(parseISO(props.article.publishedAt), "MMMM d, yyyy")
    }
    return ""
  })
</script>

<template>
  <article v-if="slug && article.title">
    <div class="flex flex-row gap-6 items-stretch">
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
      <div class="flex flex-col justify-between flex-1 max-w-2/3 md:max-w-1/2 min-h-full">
        <div class="sm:mb-4">
          <NuxtLink
            :to="slug"
            class="font-garamond-libre text-lg md:text-2xl md:font-bold text-zinc-900 dark:text-zinc-300 dark:text-white transition-colors leading-tight">
            {{ article.title }}
          </NuxtLink>
        </div>
        <div
          v-if="article.dek"
          class="hidden sm:block font-garamond-libre text-base md:text-lg text-zinc-900 dark:text-zinc-300 dark:text-white font-light leading-tight mb-4">
          {{ article.dek }}
        </div>
        <div class="flex justify-between flex-col sm:flex-row items-start sm:mt-6 text-center">
          <NuxtLink
            :to="author"
            class="font-cormorant font-normal uppercase tracking-wide text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400">
            {{ article.author.name }}
          </NuxtLink>
          <time v-if="formattedDate" class="uppercase text-xs sm:text-sm font-medium">
            {{ formattedDate }}
          </time>
        </div>
      </div>
    </div>
  </article>
</template>
