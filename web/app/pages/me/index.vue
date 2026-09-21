<script setup lang="ts">
  import { GetDashboardArticlesDocument, GetMyBookmarksDocument } from "~/graphql/generated/graphql"
  import { useAccountDashboardState } from "~/middleware/account-dashboard"
  import { selectAttention } from "~/utils/accountDashboard"
  import AccountCard from "~/components/me/AccountCard.vue"
  import AttentionList from "~/components/me/AttentionList.vue"
  import LinkList from "~/components/me/LinkList.vue"
  import MyArticleRow from "~/components/me/MyArticleRow.vue"
  import SubscriptionStatus from "~/components/me/SubscriptionStatus.vue"

  definePageMeta({
    i18n: false,
    layout: "auth",
    requiresAuth: true,
    middleware: ["account-dashboard"]
  })

  // Спецификация: docs/spec/30-account/reader/dashboard.md. Таблица состояний — §8; редиректы
  // «Нет доступа», «Заблокирован» и служебной записи решает middleware `account-dashboard`.
  const { t } = useI18n()

  useHead({
    title: () => `${t("account.dashboard.pageTitle")} — Altera`,
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })

  const account = useAccountDashboardState()
  const subscription = computed(() => account.value?.subscription ?? null)
  const hasArticles = computed(() => account.value?.hasArticles ?? false)

  // Подзапросы отвечают независимо: отказ одной зоны не роняет остальные (§8 «Ошибка данных»).
  const articles = await useAsyncData(
    "dashboard-articles",
    async () => {
      if (!hasArticles.value) return null
      const result = await useGraphQL(GetDashboardArticlesDocument)
      if (!result.data) throw new Error(String(result.errors?.[0]?.extensions?.code ?? "INTERNAL_ERROR"))
      return result.data
    },
    { server: false }
  )

  const bookmarks = await useAsyncData(
    "dashboard-bookmarks",
    async () => {
      const result = await useGraphQL(GetMyBookmarksDocument, { limit: 5 })
      if (!result.data) throw new Error(String(result.errors?.[0]?.extensions?.code ?? "INTERNAL_ERROR"))
      return result.data.myBookmarks
    },
    { server: false }
  )

  // Обратный отсчёт окна «перередактировать» (журнал #9) обновляется раз в полминуты.
  const now = ref(Date.now())
  let clock: ReturnType<typeof setInterval> | null = null
  onMounted(() => (clock = setInterval(() => (now.value = Date.now()), 30_000)))
  onBeforeUnmount(() => clock && clearInterval(clock))

  const articlesLoading = computed(
    () => hasArticles.value && articles.status.value !== "success" && !articles.error.value
  )
  const bookmarksLoading = computed(() => bookmarks.status.value !== "success" && !bookmarks.error.value)
  const attention = computed(() => selectAttention(articles.data.value?.attention.items ?? [], now.value))
  const latest = computed(() => articles.data.value?.latest.items ?? [])
  const bookmarkItems = computed(() => bookmarks.data.value?.items ?? [])
  const expired = computed(() => subscription.value?.state === "expired")

  const pageState = computed(() => {
    if (articlesLoading.value || bookmarksLoading.value) return "loading"
    if (articles.error.value || bookmarks.error.value) return "zone_error"
    if (expired.value) return "plan_limit"
    if (!hasArticles.value && bookmarkItems.value.length === 0) return "empty"
    return "ready"
  })

  const serviceLinks = computed(() => [
    { to: "/me/sessions", label: t("account.dashboard.links.sessions"), testid: "dashboard-link-sessions" },
    { to: "/me/email", label: t("account.dashboard.links.email"), testid: "dashboard-link-email" },
    { to: "/me/export", label: t("account.dashboard.links.export"), testid: "dashboard-link-export" },
    { to: "/me/delete", label: t("account.dashboard.links.delete"), testid: "dashboard-link-delete" },
    { to: "/legal/terms", label: t("account.dashboard.links.terms"), testid: "dashboard-link-terms" },
    { to: "/legal/privacy", label: t("account.dashboard.links.privacy"), testid: "dashboard-link-privacy" }
  ])

  const bookmarkPath = (item: (typeof bookmarkItems.value)[number]) =>
    item.article.section ? `/${item.article.section.slug}/${item.article.slug}` : null
</script>

<template>
  <section
    v-if="account && subscription"
    class="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-16"
    :data-dashboard-state="pageState">
    <h1 class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">{{ t("account.dashboard.pageTitle") }}</h1>

    <!-- Телефон и планшет — одна колонка в порядке зон 2–7, десктоп — две колонки (§9). -->
    <div class="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-16">
      <div class="contents lg:flex lg:flex-col lg:gap-10">
        <AccountCard class="order-1" :account="account" />

        <AttentionList v-if="attention.length" class="order-3" :items="attention" :now="now" />

        <section class="order-4 flex flex-col gap-3" data-testid="dashboard-articles">
          <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            {{ t("account.dashboard.articles.title") }}
          </h2>

          <div v-if="articlesLoading" data-testid="dashboard-articles-skeleton" class="flex flex-col gap-3">
            <span class="h-16 w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" />
            <span class="h-16 w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" />
          </div>

          <div
            v-else-if="articles.error.value"
            role="alert"
            data-testid="dashboard-articles-error"
            class="flex flex-col gap-2">
            <p class="font-sans text-base text-zinc-900 dark:text-zinc-100">{{ t("account.dashboard.zoneError") }}</p>
            <button
              type="button"
              class="self-start border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 hover:border-orange-600 hover:text-orange-700 dark:text-zinc-400"
              @click="articles.refresh()">
              {{ t("account.dashboard.retry") }}
            </button>
          </div>

          <template v-else-if="hasArticles">
            <div class="flex flex-col">
              <MyArticleRow v-for="article in latest" :key="article.id" :article="article" />
            </div>
            <NuxtLink
              to="/me/articles"
              data-testid="dashboard-all-articles"
              class="self-start border-b border-orange-600 font-sans text-sm text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
              {{ t("account.dashboard.articles.all") }}
            </NuxtLink>
          </template>

          <!-- Без статей авторские разделы скрыты (журнал §8.21); первое «Создать статью»
               открывает базовое авторство без оплаты (журнал §24.1, §25.1). -->
          <div v-else-if="!expired" data-testid="dashboard-write-invite" class="flex flex-col items-start gap-3">
            <p class="font-sans text-base text-zinc-700 dark:text-zinc-300">
              {{ t("account.dashboard.articles.invite") }}
            </p>
            <NuxtLink
              to="/me/articles/new"
              data-testid="dashboard-create-article"
              class="inline-flex min-h-11 items-center justify-center rounded-full bg-zinc-950 px-5 font-sans text-sm font-semibold text-white transition hover:bg-orange-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-orange-400">
              {{ t("account.dashboard.articles.create") }}
            </NuxtLink>
          </div>

          <div v-else data-testid="dashboard-choose-plan" class="flex flex-col items-start gap-3">
            <p class="font-sans text-base text-zinc-700 dark:text-zinc-300">
              {{ t("account.dashboard.articles.planNeeded") }}
            </p>
            <NuxtLink
              to="/pricing"
              class="border-b border-orange-600 font-sans text-sm font-semibold text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
              {{ t("account.dashboard.articles.choosePlan") }}
            </NuxtLink>
          </div>
        </section>
      </div>

      <div class="contents lg:flex lg:flex-col lg:gap-10">
        <SubscriptionStatus class="order-2" :subscription="subscription" />

        <section class="order-5 flex flex-col gap-3" data-testid="dashboard-bookmarks">
          <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            {{ t("account.dashboard.bookmarks.title") }}
          </h2>

          <div v-if="bookmarksLoading" data-testid="dashboard-bookmarks-skeleton" class="flex flex-col gap-3">
            <span class="h-10 w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" />
            <span class="h-10 w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" />
          </div>

          <div
            v-else-if="bookmarks.error.value"
            role="alert"
            data-testid="dashboard-bookmarks-error"
            class="flex flex-col gap-2">
            <p class="font-sans text-base text-zinc-900 dark:text-zinc-100">{{ t("account.dashboard.zoneError") }}</p>
            <button
              type="button"
              class="self-start border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 hover:border-orange-600 hover:text-orange-700 dark:text-zinc-400"
              @click="bookmarks.refresh()">
              {{ t("account.dashboard.retry") }}
            </button>
          </div>

          <template v-else-if="bookmarkItems.length">
            <ul class="flex flex-col gap-3">
              <li
                v-for="item in bookmarkItems"
                :key="item.article.id"
                :data-available="item.article.available ? 'true' : 'false'"
                :class="['flex flex-col', item.article.available ? '' : 'opacity-60 grayscale']">
                <NuxtLink
                  v-if="item.article.available && bookmarkPath(item)"
                  :to="bookmarkPath(item)!"
                  class="font-sans text-base font-medium text-zinc-950 hover:text-orange-700 dark:text-zinc-50">
                  {{ item.article.title }}
                </NuxtLink>
                <span v-else class="font-sans text-base font-medium text-zinc-950 dark:text-zinc-50">
                  {{ item.article.title }}
                </span>
                <span class="font-sans text-sm text-zinc-500 dark:text-zinc-400">{{ item.article.author.name }}</span>
              </li>
            </ul>
            <NuxtLink
              to="/me/bookmarks"
              data-testid="dashboard-all-bookmarks"
              class="self-start border-b border-orange-600 font-sans text-sm text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
              {{ t("account.dashboard.bookmarks.all") }}
            </NuxtLink>
          </template>

          <div v-else data-testid="dashboard-read-invite" class="flex flex-col items-start gap-2">
            <p class="font-sans text-base text-zinc-700 dark:text-zinc-300">
              {{ t("account.dashboard.bookmarks.empty") }}
            </p>
            <NuxtLink
              to="/"
              class="border-b border-orange-600 font-sans text-sm text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
              {{ t("account.dashboard.bookmarks.read") }}
            </NuxtLink>
          </div>
        </section>

        <LinkList class="order-6" :title="t('account.dashboard.links.title')" :links="serviceLinks" />
      </div>
    </div>
  </section>
</template>
