<script setup lang="ts">
  import { computed } from "vue"

  const { t } = useI18n()
  const route = useRoute()
  const { summary, loading, failed, requestId, refresh } = useAdminDashboard()

  definePageMeta({
    i18n: false,
    layout: "admin",
    middleware: ["admin"]
  })

  const period = computed(() => (route.query.period === "30d" ? "30d" : "7d"))
  const changePeriod = (event: Event) => {
    const value = (event.target as HTMLSelectElement).value
    navigateTo({ path: "/admin", query: { period: value === "30d" ? "30d" : "7d" } })
  }
</script>

<template>
  <section class="h-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8" aria-labelledby="admin-dashboard-title">
    <header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p
          class="mb-1 font-sans text-xs font-semibold uppercase tracking-[0.18em] text-orange-700 dark:text-orange-400">
          {{ summary?.role ? t(`admin.roles.${summary.role}`) : t("admin.summary.serviceArea") }}
        </p>
        <h1 id="admin-dashboard-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">
          {{ t("admin.summary.title") }}
        </h1>
      </div>

      <div class="flex items-center gap-3">
        <label for="admin-period" class="font-sans text-sm text-zinc-600 dark:text-zinc-300">
          {{ t("admin.summary.period") }}
        </label>
        <select
          id="admin-period"
          :value="period"
          class="min-h-10 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-950"
          @change="changePeriod">
          <option value="7d">{{ t("admin.summary.period7") }}</option>
          <option value="30d">{{ t("admin.summary.period30") }}</option>
        </select>
        <button
          type="button"
          class="min-h-10 border border-zinc-900 px-4 font-sans text-sm font-semibold transition-colors hover:bg-zinc-900 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 motion-reduce:transition-none dark:border-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-950"
          :disabled="loading"
          @click="refresh">
          {{ t("admin.summary.refresh") }}
        </button>
      </div>
    </header>

    <AppListPanel :loading="loading" :error="failed">
      <p v-if="requestId" class="mb-4 font-mono text-xs text-zinc-500">requestId: {{ requestId }}</p>

      <div v-if="summary?.cards.length" class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="card in summary.cards"
          :key="card.id"
          :data-admin-card="card.id"
          class="min-h-44 border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <div class="mb-5 flex items-start justify-between gap-4">
            <h2 class="font-serif text-xl text-zinc-950 dark:text-zinc-50">
              {{ t(`admin.cards.${card.id}.title`) }}
            </h2>
            <NuxtLink
              :to="card.href"
              class="font-sans text-sm font-semibold text-orange-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:text-orange-400">
              {{ t("admin.summary.open") }}
            </NuxtLink>
          </div>

          <div v-if="card.status === 'ERROR'" role="alert" class="font-sans text-sm text-red-700 dark:text-red-300">
            <p>{{ t("admin.summary.cardError") }}</p>
            <p v-if="card.requestId" class="mt-2 font-mono text-xs">requestId: {{ card.requestId }}</p>
          </div>

          <dl v-else class="grid grid-cols-2 gap-x-4 gap-y-5">
            <div v-for="item in card.metrics" :key="item.id">
              <dt class="font-sans text-xs text-zinc-500 dark:text-zinc-400">
                {{ t(`admin.metrics.${item.id}`) }}
              </dt>
              <dd class="mt-1 font-mono text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
                {{ item.value }}
              </dd>
            </div>
          </dl>
        </article>
      </div>

      <div
        v-else-if="summary && !loading"
        data-admin-empty
        class="border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
        <p class="font-serif text-2xl text-zinc-900 dark:text-zinc-100">{{ t("admin.summary.empty") }}</p>
        <p class="mt-2 font-sans text-sm text-zinc-500 dark:text-zinc-400">{{ t("admin.summary.emptyHint") }}</p>
      </div>
    </AppListPanel>
  </section>
</template>
