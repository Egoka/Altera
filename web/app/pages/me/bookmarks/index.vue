<script setup lang="ts">
  import {
    AddBookmarkDocument,
    GetMyBookmarksDocument,
    RemoveBookmarkDocument,
    type GetMyBookmarksQuery
  } from "~/graphql/generated/graphql"

  definePageMeta({
    i18n: false,
    layout: "auth",
    requiresAuth: true
  })

  const { t } = useI18n()

  useHead({
    title: () => `${t("bookmarks.pageTitle")} — Altera`,
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })

  type BookmarksData = GetMyBookmarksQuery["myBookmarks"]
  type BookmarkItem = BookmarksData["items"][number]

  // Возврат удалённой закладки доступен пять секунд (`bookmarks.md` §6).
  const UNDO_WINDOW_MS = 5_000

  const route = useRoute()
  const onlyUnavailable = computed(() => String(route.query.unavailable ?? "") === "1")

  const fetchBookmarks = async (cursor?: string | null): Promise<BookmarksData> => {
    const result = await useGraphQL(GetMyBookmarksDocument, {
      cursor: cursor ?? undefined,
      limit: 20,
      unavailable: onlyUnavailable.value ? true : undefined
    })

    if (result.errors?.length) throw new Error(result.errors[0]?.message ?? "Не удалось загрузить закладки")
    if (!result.data?.myBookmarks) throw new Error("Не удалось загрузить закладки")
    return result.data.myBookmarks
  }

  const { data, status, error, refresh } = await useAsyncData("my-bookmarks", () => fetchBookmarks(), {
    server: false,
    watch: [onlyUnavailable]
  })

  const items = ref<BookmarkItem[]>([])
  const counts = ref<BookmarksData["counts"]>({ total: 0, unavailable: 0 })
  const pageInfo = ref<BookmarksData["pageInfo"]>({ endCursor: null, hasNextPage: false })

  watch(
    data,
    (next) => {
      items.value = next?.items ?? []
      counts.value = next?.counts ?? counts.value
      pageInfo.value = next?.pageInfo ?? { endCursor: null, hasNextPage: false }
    },
    { immediate: true }
  )

  const loadingMore = ref(false)
  const loadMore = async () => {
    if (!pageInfo.value.endCursor || loadingMore.value) return
    loadingMore.value = true
    try {
      const next = await fetchBookmarks(pageInfo.value.endCursor)
      items.value = [...items.value, ...next.items]
      pageInfo.value = next.pageInfo
    } finally {
      loadingMore.value = false
    }
  }

  const busyArticleId = ref<string | null>(null)
  const undo = ref<{ item: BookmarkItem; index: number } | null>(null)
  let undoTimer: ReturnType<typeof setTimeout> | null = null

  const clearUndo = () => {
    if (undoTimer) clearTimeout(undoTimer)
    undoTimer = null
    undo.value = null
  }

  onBeforeUnmount(clearUndo)

  const remove = async (articleId: string) => {
    if (busyArticleId.value) return
    const index = items.value.findIndex((item) => item.article.id === articleId)
    const item = items.value[index]
    if (!item) return

    busyArticleId.value = articleId
    try {
      const result = await useGraphQL(RemoveBookmarkDocument, { articleId })
      if (result.errors?.length) throw new Error(result.errors[0]?.message ?? "Не удалось убрать закладку")

      items.value = items.value.filter((candidate) => candidate.article.id !== articleId)
      counts.value = {
        total: Math.max(0, counts.value.total - 1),
        unavailable: item.article.available ? counts.value.unavailable : Math.max(0, counts.value.unavailable - 1)
      }

      clearUndo()
      undo.value = { item, index }
      undoTimer = setTimeout(clearUndo, UNDO_WINDOW_MS)
    } finally {
      busyArticleId.value = null
    }
  }

  const restore = async () => {
    const pending = undo.value
    if (!pending || busyArticleId.value) return

    busyArticleId.value = pending.item.article.id
    try {
      const result = await useGraphQL(AddBookmarkDocument, { articleId: pending.item.article.id })
      if (result.errors?.length) throw new Error(result.errors[0]?.message ?? "Не удалось вернуть закладку")

      const restored = [...items.value]
      restored.splice(pending.index, 0, pending.item)
      items.value = restored
      counts.value = {
        total: counts.value.total + 1,
        unavailable: pending.item.article.available ? counts.value.unavailable : counts.value.unavailable + 1
      }
      clearUndo()
    } finally {
      busyArticleId.value = null
    }
  }
</script>

<template>
  <main class="min-h-full bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
    <div class="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <header class="pb-8">
        <p class="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-orange-600">
          {{ t("bookmarks.eyebrow") }}
        </p>
        <h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">
          {{ t("bookmarks.pageTitle") }} · {{ counts.total }}
        </h1>
        <p class="mt-4 max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-300">
          {{ t("bookmarks.description") }}
        </p>
      </header>

      <nav :aria-label="t('bookmarks.filtersLabel')" class="pb-6">
        <ul class="flex flex-wrap gap-2">
          <li>
            <NuxtLink
              to="/me/bookmarks"
              :aria-current="onlyUnavailable ? undefined : 'page'"
              :class="[
                'inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600',
                onlyUnavailable
                  ? 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  : 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
              ]">
              {{ t("bookmarks.tabs.all") }}
              <span :class="onlyUnavailable ? 'text-zinc-400' : 'text-orange-300'">{{ counts.total }}</span>
            </NuxtLink>
          </li>
          <li>
            <NuxtLink
              :to="{ path: '/me/bookmarks', query: { unavailable: '1' } }"
              :aria-current="onlyUnavailable ? 'page' : undefined"
              :class="[
                'inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600',
                onlyUnavailable
                  ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800'
              ]">
              {{ t("bookmarks.tabs.unavailable") }}
              <span :class="onlyUnavailable ? 'text-orange-300' : 'text-zinc-400'">{{ counts.unavailable }}</span>
            </NuxtLink>
          </li>
        </ul>
      </nav>

      <div
        v-if="undo"
        data-testid="bookmark-undo"
        role="status"
        class="mb-6 flex flex-wrap items-center justify-between gap-4 bg-zinc-100 px-5 py-4 dark:bg-zinc-900">
        <p class="text-sm text-zinc-700 dark:text-zinc-200">{{ t("bookmarks.removed") }}</p>
        <button
          type="button"
          class="rounded-full border border-zinc-400 px-5 py-2 text-sm font-semibold transition hover:border-orange-600 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:border-zinc-600"
          @click="restore">
          {{ t("bookmarks.undo") }}
        </button>
      </div>

      <section aria-live="polite">
        <div v-if="status === 'pending'" :aria-label="t('bookmarks.loadingLabel')" class="space-y-3 py-4">
          <div v-for="index in 4" :key="index" class="h-24 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
        </div>

        <div
          v-else-if="error"
          data-testid="bookmarks-error"
          class="my-10 border-l-4 border-red-600 bg-red-50 p-6 dark:bg-red-950/40">
          <h2 class="text-lg font-bold">{{ t("bookmarks.loadErrorTitle") }}</h2>
          <p class="mt-2 text-sm text-zinc-700 dark:text-zinc-200">{{ t("bookmarks.loadErrorDescription") }}</p>
          <button
            type="button"
            class="mt-5 rounded-full border border-zinc-950 px-5 py-2.5 text-sm font-semibold hover:bg-zinc-950 hover:text-white dark:border-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-950"
            @click="refresh()">
            {{ t("bookmarks.retry") }}
          </button>
        </div>

        <div v-else-if="items.length === 0" data-testid="bookmarks-empty" class="my-10 px-6 py-16 text-center">
          <h2 class="text-2xl font-semibold">{{ t("bookmarks.emptyTitle") }}</h2>
          <p class="mx-auto mt-3 max-w-md text-zinc-600 dark:text-zinc-300">{{ t("bookmarks.emptyDescription") }}</p>
          <NuxtLink to="/" class="mt-6 inline-block underline underline-offset-4">
            {{ t("bookmarks.emptyLink") }}
          </NuxtLink>
        </div>

        <div v-else class="divide-y divide-zinc-200 dark:divide-zinc-800">
          <MeBookmarkCard
            v-for="item in items"
            :key="item.article.id"
            :bookmark="item"
            :busy="busyArticleId === item.article.id"
            @remove="remove" />

          <div v-if="pageInfo.hasNextPage" class="py-8 text-center">
            <button
              type="button"
              :disabled="loadingMore"
              class="rounded-full border border-zinc-300 px-6 py-3 text-sm font-semibold transition hover:border-orange-500 hover:text-orange-700 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700"
              @click="loadMore">
              {{ loadingMore ? t("bookmarks.loadingMore") : t("bookmarks.showMore") }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
