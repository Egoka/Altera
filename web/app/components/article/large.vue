<script setup lang="ts">
  import type { ArticleCardFragment } from "~/graphql/generated/graphql"
  import type { CardMeta } from "~/types/layout"

  const props = defineProps<{
    article: ArticleCardFragment
    /** Ведущий слот группы — заголовок на ступень крупнее. */
    scale?: "lead"
    /** Служебная строка: части по порядку, по умолчанию автор · рубрика. */
    meta?: CardMeta
  }>()
  const slug = computed(() => (props.article.section ? `/${props.article.section.slug}/${props.article.slug}` : ""))
</script>

<template>
  <article v-if="slug && article.title">
    <div class="flex flex-col items-start gap-7 sm:flex-row sm:gap-6">
      <div class="order-2 flex flex-1 flex-col sm:max-w-1/2">
        <NuxtLink
          :to="slug"
          :class="[
            'font-garamond-libre font-bold text-zinc-900 transition-colors dark:text-zinc-300',
            scale === 'lead' ? 'text-card md:text-lead' : 'text-card md:text-title'
          ]">
          {{ article.title }}
        </NuxtLink>
        <p
          v-if="article.dek"
          class="mt-1 font-garamond-libre text-card-dek font-normal text-zinc-600 dark:text-zinc-400 line-clamp-2">
          {{ article.dek }}
        </p>
        <div class="mt-2 flex flex-row flex-wrap items-baseline gap-x-2 gap-y-1">
          <ArticleMeta :article="article" :parts="meta" />
        </div>
      </div>

      <!-- Изображение (слева на sm+, сверху на минимальном экране) -->
      <div class="order-1 w-full flex-1 sm:max-w-1/2">
        <figure class="relative">
          <NuxtLink :to="slug" class="block group">
            <NuxtImg
              :src="article.featuredImage ?? undefined"
              :alt="article.title"
              class="w-full aspect-3/2 rounded-sm object-cover transition-transform duration-300" />
          </NuxtLink>
        </figure>
      </div>
    </div>
  </article>
</template>
