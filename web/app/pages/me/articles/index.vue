<script setup lang="ts">
  import { GetMyArticlesDocument, type GetMyArticlesQuery, type MyArticleStatus } from "~/graphql/generated/graphql"

  definePageMeta({
    i18n: false,
    layout: "auth",
    requiresAuth: true
  })

  const { t } = useI18n()

  useHead({
    title: () => `${t("myArticles.pageTitle")} — Altera`,
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })

  type MyArticlesData = GetMyArticlesQuery["myArticles"]

  const route = useRoute()
  const allowedStatuses = new Set<MyArticleStatus>([
    "draft",
    "ai_check",
    "review",
    "rework",
    "published",
    "rejected",
    "archived"
  ])
  const selectedStatuses = computed<MyArticleStatus[]>(() => {
    const raw = Array.isArray(route.query.status) ? route.query.status.join(",") : route.query.status
    return String(raw ?? "")
      .split(",")
      .filter((status): status is MyArticleStatus => allowedStatuses.has(status as MyArticleStatus))
  })
  const selectedStatusKey = computed(() => selectedStatuses.value.join(","))

  const fetchArticles = async (cursor?: string | null): Promise<MyArticlesData> => {
    const result = await useGraphQL(GetMyArticlesDocument, {
      status: selectedStatuses.value.length ? selectedStatuses.value : undefined,
      cursor: cursor ?? undefined,
      limit: 20
    })

    if (result.errors?.length) throw new Error(result.errors[0]?.message ?? "Не удалось загрузить материалы")
    if (!result.data?.myArticles) throw new Error("Не удалось загрузить материалы")
    return result.data.myArticles
  }

  const { data, status, error, refresh } = await useAsyncData("my-articles", () => fetchArticles(), {
    server: false,
    watch: [selectedStatusKey]
  })

  const items = ref<MyArticlesData["items"]>([])
  const counts = ref<MyArticlesData["counts"]>({
    total: 0,
    draft: 0,
    ai_check: 0,
    review: 0,
    rework: 0,
    published: 0,
    rejected: 0,
    archived: 0
  })
  const pageInfo = ref<MyArticlesData["pageInfo"]>({ endCursor: null, hasNextPage: false })

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
      const next = await fetchArticles(pageInfo.value.endCursor)
      items.value = [...items.value, ...next.items]
      pageInfo.value = next.pageInfo
    } finally {
      loadingMore.value = false
    }
  }

  const tabs = computed(() => [
    { label: t("myArticles.tabs.all"), status: null, count: counts.value.total },
    { label: t("myArticles.tabs.draft"), status: "draft", count: counts.value.draft },
    { label: t("myArticles.tabs.review"), status: "review", count: counts.value.review },
    { label: t("myArticles.tabs.rework"), status: "rework", count: counts.value.rework },
    { label: t("myArticles.tabs.published"), status: "published", count: counts.value.published },
    { label: t("myArticles.tabs.rejected"), status: "rejected", count: counts.value.rejected },
    { label: t("myArticles.tabs.archived"), status: "archived", count: counts.value.archived }
  ])

  const isTabActive = (tabStatus: string | null) =>
    tabStatus === null
      ? selectedStatuses.value.length === 0
      : selectedStatuses.value.includes(tabStatus as MyArticleStatus)
</script>

<template>
  <main class="min-h-full bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
    <div class="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <header
        class="grid gap-8 border-b border-zinc-950 pb-8 dark:border-zinc-100 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <p class="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-orange-600">
            {{ t("myArticles.eyebrow") }}
          </p>
          <h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">{{ t("myArticles.pageTitle") }}</h1>
          <p class="mt-4 max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-300">
            {{ t("myArticles.description") }}
          </p>
        </div>
        <NuxtLink
          to="/me/articles/new"
          class="inline-flex min-h-12 items-center justify-center rounded-full bg-orange-600 px-6 text-sm font-bold text-white transition hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600">
          {{ t("myArticles.create") }}
        </NuxtLink>
      </header>

      <nav
        :aria-label="t('myArticles.filtersLabel')"
        class="-mx-4 overflow-x-auto border-b border-zinc-200 px-4 dark:border-zinc-800 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <ul class="flex min-w-max gap-1 py-4">
          <li v-for="tab in tabs" :key="tab.label">
            <NuxtLink
              :to="tab.status ? { path: '/me/articles', query: { status: tab.status } } : '/me/articles'"
              :aria-current="isTabActive(tab.status) ? 'page' : undefined"
              :class="[
                'inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600',
                isTabActive(tab.status)
                  ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white'
              ]">
              {{ tab.label }}
              <span :class="isTabActive(tab.status) ? 'text-orange-300' : 'text-zinc-400'">{{ tab.count }}</span>
            </NuxtLink>
          </li>
        </ul>
      </nav>

      <section aria-live="polite" class="mt-5">
        <div v-if="status === 'pending'" :aria-label="t('myArticles.loadingLabel')" class="space-y-3 py-4">
          <div
            v-for="index in 4"
            :key="index"
            class="h-28 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900"></div>
        </div>

        <div v-else-if="error" class="my-10 border-l-4 border-red-600 bg-red-50 p-6 dark:bg-red-950/40">
          <h2 class="text-lg font-bold">{{ t("myArticles.loadErrorTitle") }}</h2>
          <p class="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
            {{ t("myArticles.loadErrorDescription") }}
          </p>
          <button
            type="button"
            class="mt-5 rounded-full border border-zinc-950 px-5 py-2.5 text-sm font-semibold hover:bg-zinc-950 hover:text-white dark:border-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-950"
            @click="refresh()">
            {{ t("myArticles.retry") }}
          </button>
        </div>

        <div
          v-else-if="items.length === 0"
          class="my-10 border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
          <h2 class="text-2xl font-semibold">{{ t("myArticles.emptyTitle") }}</h2>
          <p class="mx-auto mt-3 max-w-md text-zinc-600 dark:text-zinc-300">
            {{ t("myArticles.emptyDescription") }}
          </p>
        </div>

        <div v-else>
          <MeMyArticleRow v-for="article in items" :key="article.id" :article="article" />
          <div v-if="pageInfo.hasNextPage" class="border-t border-zinc-200 py-8 text-center dark:border-zinc-800">
            <button
              type="button"
              :disabled="loadingMore"
              class="rounded-full border border-zinc-300 px-6 py-3 text-sm font-semibold transition hover:border-orange-500 hover:text-orange-700 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700"
              @click="loadMore">
              {{ loadingMore ? t("myArticles.loadingMore") : t("myArticles.showMore") }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
