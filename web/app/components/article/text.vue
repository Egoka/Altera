<script setup lang="ts">
  import type { PopularArticleData } from "~/types/article"
  const props = defineProps<{
    index: number
    article: PopularArticleData
  }>()
  const slug = computed(() => `/${props.article.contentType.slug}/${props.article.slug}`)
  const author = computed(() => `/authors/${props.article.author.slug}`)
  
  const router = useRouter()
  
  const handleArticleClick = () => {
    router.push(slug.value)
  }
</script>

<template>
  <article v-if="slug && article.title">
    <div 
      class="flex group space-x-3 cursor-pointer rounded-lg p-2 -m-2 transition-colors duration-200"
      @click="handleArticleClick">
      <span
        :class="[
          'min-w-14 w-6 select-none',
          'mt-1 flex-shrink-0',
          'font-waterway text-5xl md:text-4xl font-bold text-right',
          'text-zinc-400 dark:text-zinc-400 group-hover:text-zinc-600 group-hover:dark:text-zinc-300',
          'transition-colors duration-500'
        ]">
        {{ (index ?? 0) + 1 }}.
      </span>
      <div class="flex-1 min-w-0">
        <h3
          class="font-garamond-libre text-xl lg:text-xl font-medium text-zinc-900 dark:text-zinc-300 transition-colors leading-tight line-clamp-2 group-hover:text-zinc-600 group-hover:dark:text-zinc-200">
          {{ article.title }}
        </h3>
        <div class="mt-1 w-max" @click.stop>
          <ShowAuthor :link="author" :name="article.author.name" />
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped></style>
