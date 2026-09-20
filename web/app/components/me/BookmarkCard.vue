<script setup lang="ts">
  import { computed } from "vue"
  import type { GetMyBookmarksQuery } from "~/graphql/generated/graphql"

  type Bookmark = GetMyBookmarksQuery["myBookmarks"]["items"][number]

  const props = defineProps<{ bookmark: Bookmark; busy?: boolean }>()
  const emit = defineEmits<{ remove: [articleId: string] }>()
  const { locale, t } = useI18n()

  // Недоступный материал остаётся в списке приглушённым и чёрно-белым (журнал §25.10).
  const article = computed(() => props.bookmark.article)
  const available = computed(() => article.value.available)
  const articlePath = computed(() =>
    article.value.section ? `/${article.value.section.slug}/${article.value.slug}` : ""
  )
  const bookmarkedAt = computed(() =>
    new Intl.DateTimeFormat(locale.value, { day: "numeric", month: "long", timeZone: "UTC" }).format(
      new Date(props.bookmark.bookmarkedAt)
    )
  )
</script>

<template>
  <article
    :data-article-id="article.id"
    :data-available="available ? 'true' : 'false'"
    :aria-label="article.title"
    :class="[
      'grid gap-4 py-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-start',
      available ? '' : 'opacity-60 grayscale'
    ]">
    <div class="min-w-0">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <span v-if="article.section" class="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">
          {{ article.section.name }}
        </span>
        <span
          v-if="!available"
          data-testid="bookmark-unavailable"
          class="rounded-full bg-zinc-200 px-3 py-1 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {{ t("bookmarks.unavailable") }}
        </span>
      </div>

      <h2 class="font-garamond-libre text-2xl font-bold leading-tight text-zinc-950 dark:text-zinc-50">
        <NuxtLink
          v-if="available && articlePath"
          :to="articlePath"
          class="underline-offset-4 transition-colors hover:text-orange-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 motion-reduce:transition-none dark:hover:text-orange-400">
          {{ article.title }}
        </NuxtLink>
        <span v-else>{{ article.title }}</span>
      </h2>

      <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
        <span>{{ article.author.name }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ t("bookmarks.savedAt", { date: bookmarkedAt }) }}</span>
      </div>

      <p v-if="!available" class="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("bookmarks.unavailableDetail") }}
      </p>
    </div>

    <button
      type="button"
      data-testid="bookmark-remove"
      :disabled="busy"
      :aria-busy="busy || undefined"
      :aria-label="t('bookmarks.remove')"
      :title="t('bookmarks.remove')"
      class="inline-flex size-10 items-center justify-center rounded-full border border-zinc-300 text-lg text-zinc-700 transition-colors hover:border-orange-600 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none dark:border-zinc-700 dark:text-zinc-200 md:justify-self-end"
      @click="emit('remove', article.id)">
      <span aria-hidden="true">✕</span>
    </button>
  </article>
</template>
