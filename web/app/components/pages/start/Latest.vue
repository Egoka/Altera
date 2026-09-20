<script setup lang="ts">
  import type { ReadingArticle } from "~/types/reading"
  import { buildFeedGroups } from "~/utils/feedGroups"
  import { LATEST_RHYTHM } from "~/utils/feedRhythm"

  /** «Новое»: материалы окна новизны по дате публикации (`home.md` §5 зона 3). */
  const props = defineProps<{ articles: ReadingArticle[]; caption?: string }>()

  const { t } = useI18n()

  /**
   * Число материалов подборки заранее не известно, поэтому ритм идёт по кругу, а остаток
   * ложится в запасную раскладку ровно под него (`feedGroups.ts`): фиксированный список
   * раскладок молча терял хвост ленты.
   */
  const groups = computed(() => buildFeedGroups(props.articles, LATEST_RHYTHM))
</script>

<template>
  <section class="latest-articles pt-16">
    <div>
      <h2 class="font-waterway text-3xl tracking-widest text-zinc-900 dark:text-zinc-300">
        {{ t("home.latest") }}
      </h2>
      <p
        v-if="caption"
        class="mt-2 mb-10 font-sans text-[0.6875rem] font-semibold uppercase tracking-wider text-zinc-500">
        {{ caption }}
      </p>
      <ArticleGroup v-for="group in groups" :key="group.id" :articles="group.articles" :layout="group.layout" />
    </div>
  </section>
</template>
