<script setup lang="ts">
  import type { ArticleCardFragment } from "~/graphql/generated/graphql"
  import type { CardMeta } from "~/types/layout"

  const props = defineProps<{
    article: ArticleCardFragment
    /**
     * Ступень заголовка.
     * `lead` — ведущий слот группы, заголовок на ступень крупнее.
     * `index` — карточка ровного каталога: снимок занимает всю колонку, и под ним
     * заголовок в 20 px читается как подпись к фотографии, а не как заголовок.
     * Ступень 25/30 даёт около тридцати знаков в строке — середину заголовочной
     * меры, тогда как 20 px дают тридцать восемь, а 31 px — двадцать четыре и
     * возвращают частые переносы (владелец, 2026-09-14).
     */
    scale?: "lead" | "index"
    /** Служебная строка: части по порядку, по умолчанию автор · рубрика. */
    meta?: CardMeta
  }>()
  const slug = computed(() => (props.article.section ? `/${props.article.section.slug}/${props.article.slug}` : ""))
  const titleScale = computed(() => {
    if (props.scale === "lead") return "text-card md:text-title"
    // Обрезка третьей строкой — страховка от единичного длинного заголовка:
    // в ровном каталоге он один ломал бы высоту всего ряда.
    if (props.scale === "index") return "text-title-compact line-clamp-3"
    return "text-card"
  })
</script>

<template>
  <article v-if="slug">
    <figure class="mb-4">
      <NuxtLink :to="slug" class="block group">
        <NuxtImg
          :src="article.featuredImage ?? undefined"
          :alt="article.title"
          class="w-full aspect-3/2 object-cover rounded-sm transition-transform duration-300" />
      </NuxtLink>
    </figure>

    <div>
      <NuxtLink
        :to="slug"
        :class="['font-garamond-libre font-bold text-zinc-900 transition-colors dark:text-zinc-300', titleScale]">
        {{ article.title }}
      </NuxtLink>
      <div :class="['flex flex-row flex-wrap items-baseline gap-x-2 gap-y-1', scale === 'index' ? 'mt-2' : 'mt-1']">
        <ArticleMeta :article="article" :parts="meta" />
      </div>
    </div>
  </article>
</template>

<style scoped></style>
