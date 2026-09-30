<script setup lang="ts">
  import { computed, watch } from "vue"
  import {
    ADMIN_AI_KINDS,
    ADMIN_AI_PERIODS,
    ADMIN_AI_STATUSES,
    parseAdminAiQueryState
  } from "~/composables/useAdminAiProcesses"
  import { canReadAiStats } from "~/utils/admin"

  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const { summary } = useAdminDashboard()
  const { items, pagination, viewerRole, stats, loading, listFailure, statsFailure, refresh } = useAdminAiProcesses()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-ai"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const queryState = computed(() => parseAdminAiQueryState(route.query as Record<string, unknown>))
  const canSeeStats = computed(() => (summary.value ? canReadAiStats(summary.value.role) : false))
  const activeTab = computed(() => (route.query.tab === "stats" && canSeeStats.value ? "stats" : "records"))

  watch([queryState, canSeeStats], ([state, includeStats]) => refresh(state, includeStats), { immediate: true })

  const setQuery = (patch: Record<string, string | undefined>, resetPage = true) => {
    const query: Record<string, string> = { ...(route.query as Record<string, string>) }
    for (const [key, value] of Object.entries(patch)) {
      if (value) query[key] = value
      else delete query[key]
    }
    if (resetPage) delete query.page
    return router.replace({ query })
  }

  const onSelect = (key: string, event: Event) => setQuery({ [key]: (event.target as HTMLSelectElement).value })
  const onSearch = (event: Event) => setQuery({ q: (event.target as HTMLInputElement).value })
  const goToPage = (page: number) => setQuery({ page: String(page) }, false)

  const formatDate = (value: string | null | undefined) =>
    value
      ? new Date(value).toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        })
      : "—"

  const formatDuration = (value: number | null | undefined) =>
    value == null ? "—" : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`
</script>

<template>
  <section
    class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="ai-title">
    <header class="mb-6 border-b border-zinc-200 pb-5 dark:border-zinc-800">
      <p class="font-mono text-xs uppercase tracking-[0.22em] text-orange-700 dark:text-orange-400">
        {{ t("admin.aiProcesses.eyebrow") }}
      </p>
      <h1 id="ai-title" class="mt-2 font-serif text-3xl text-zinc-950 dark:text-zinc-50 sm:text-4xl">
        {{ t("admin.aiProcesses.title") }}
      </h1>
      <p class="mt-2 max-w-3xl font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.aiProcesses.description") }}
      </p>
      <p data-ai-readonly-note class="mt-3 font-sans text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {{ t("admin.aiProcesses.readOnly") }}
      </p>
    </header>

    <nav class="mb-6 flex gap-2" :aria-label="t('admin.aiProcesses.tabsLabel')">
      <button
        type="button"
        data-ai-tab="records"
        class="min-h-11 border px-4 font-sans text-sm"
        :class="
          activeTab === 'records'
            ? 'border-zinc-950 bg-zinc-950 text-white dark:border-white dark:bg-white dark:text-zinc-950'
            : 'border-zinc-300 dark:border-zinc-700'
        "
        @click="setQuery({ tab: undefined })">
        {{ t("admin.aiProcesses.tabs.records") }}
      </button>
      <button
        v-if="canSeeStats"
        type="button"
        data-ai-tab="stats"
        class="min-h-11 border px-4 font-sans text-sm"
        :class="
          activeTab === 'stats'
            ? 'border-zinc-950 bg-zinc-950 text-white dark:border-white dark:bg-white dark:text-zinc-950'
            : 'border-zinc-300 dark:border-zinc-700'
        "
        @click="setQuery({ tab: 'stats' })">
        {{ t("admin.aiProcesses.tabs.stats") }}
      </button>
    </nav>

    <div class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label class="flex flex-col gap-1 font-sans text-xs text-zinc-500">
        {{ t("admin.aiProcesses.filters.search") }}
        <input
          type="search"
          :value="route.query.q ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          @change="onSearch" />
      </label>
      <label class="flex flex-col gap-1 font-sans text-xs text-zinc-500">
        {{ t("admin.aiProcesses.filters.kind") }}
        <select
          :value="route.query.kind ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSelect('kind', $event)">
          <option value="">{{ t("admin.aiProcesses.filters.allKinds") }}</option>
          <option v-for="kind in ADMIN_AI_KINDS" :key="kind" :value="kind">
            {{ t(`admin.aiProcesses.kind.${kind}`) }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1 font-sans text-xs text-zinc-500">
        {{ t("admin.aiProcesses.filters.status") }}
        <select
          :value="route.query.status ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSelect('status', $event)">
          <option value="">{{ t("admin.aiProcesses.filters.allStatuses") }}</option>
          <option v-for="status in ADMIN_AI_STATUSES" :key="status" :value="status">
            {{ t(`admin.aiProcesses.status.${status}`) }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1 font-sans text-xs text-zinc-500">
        {{ t("admin.aiProcesses.filters.period") }}
        <select
          :value="queryState.period"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSelect('period', $event)">
          <option v-for="period in ADMIN_AI_PERIODS" :key="period" :value="period">
            {{ t(`admin.aiProcesses.period.${period}`) }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1 font-sans text-xs text-zinc-500">
        {{ t("admin.aiProcesses.filters.verdict") }}
        <input
          :value="route.query.verdict ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSelect('verdict', $event)" />
      </label>
      <label class="flex flex-col gap-1 font-sans text-xs text-zinc-500">
        {{ t("admin.aiProcesses.filters.reason") }}
        <input
          :value="route.query.reason ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSelect('reason', $event)" />
      </label>
      <label class="flex flex-col gap-1 font-sans text-xs text-zinc-500">
        {{ t("admin.aiProcesses.filters.sort") }}
        <select
          :value="queryState.sort"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSelect('sort', $event)">
          <option value="createdAt">{{ t("admin.aiProcesses.sort.createdAt") }}</option>
          <option value="duration">{{ t("admin.aiProcesses.sort.duration") }}</option>
        </select>
      </label>
    </div>

    <div v-if="loading" data-ai-state="loading" aria-busy="true">
      <div
        v-for="row in 5"
        :key="row"
        class="mb-2 h-16 animate-pulse bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800"></div>
    </div>

    <div
      v-else-if="activeTab === 'stats' && statsFailure"
      data-ai-state="error"
      role="alert"
      class="border border-red-300 bg-white px-5 py-8 text-center dark:border-red-900 dark:bg-zinc-900">
      <p>{{ t("admin.aiProcesses.loadError") }}</p>
      <p v-if="statsFailure.requestId" class="mt-2 font-mono text-xs text-zinc-500">
        requestId: {{ statsFailure.requestId }}
      </p>
    </div>

    <div
      v-else-if="activeTab === 'stats' && stats"
      data-ai-stats
      class="grid gap-px bg-zinc-300 dark:bg-zinc-700 sm:grid-cols-2 lg:grid-cols-4">
      <article class="bg-white p-5 dark:bg-zinc-900">
        <p class="font-sans text-xs uppercase tracking-wide text-zinc-500">
          {{ t("admin.aiProcesses.stats.processes") }}
        </p>
        <p class="mt-2 font-serif text-3xl">{{ stats.processCount }}</p>
      </article>
      <article class="bg-white p-5 dark:bg-zinc-900">
        <p class="font-sans text-xs uppercase tracking-wide text-zinc-500">
          {{ t("admin.aiProcesses.stats.totalCost") }}
        </p>
        <p data-ai-total-cost class="mt-2 font-mono text-2xl">{{ stats.totalCostMinor }}</p>
        <p class="mt-1 text-xs text-zinc-500">{{ t("admin.aiProcesses.stats.minorUnits") }}</p>
      </article>
      <article class="bg-white p-5 dark:bg-zinc-900">
        <p class="font-sans text-xs uppercase tracking-wide text-zinc-500">{{ t("admin.aiProcesses.stats.median") }}</p>
        <p class="mt-2 font-mono text-2xl">{{ formatDuration(stats.medianDurationMs) }}</p>
      </article>
      <article class="bg-white p-5 dark:bg-zinc-900">
        <p class="font-sans text-xs uppercase tracking-wide text-zinc-500">
          {{ t("admin.aiProcesses.stats.providerErrors") }}
        </p>
        <p class="mt-2 font-serif text-3xl">{{ stats.providerErrors }}</p>
      </article>
      <article class="bg-white p-5 dark:bg-zinc-900 sm:col-span-2">
        <p class="font-sans text-xs uppercase tracking-wide text-zinc-500">
          {{ t("admin.aiProcesses.stats.reasons") }}
        </p>
        <ul class="mt-3 space-y-2 font-sans text-sm">
          <li v-for="reason in stats.rejectionReasons" :key="reason.category" class="flex justify-between gap-4">
            <span>{{ reason.category }}</span
            ><span class="font-mono">{{ Math.round(reason.share * 100) }}%</span>
          </li>
        </ul>
      </article>
      <article class="bg-white p-5 dark:bg-zinc-900 sm:col-span-2">
        <p class="font-sans text-xs uppercase tracking-wide text-zinc-500">
          {{ t("admin.aiProcesses.stats.planShare") }}
        </p>
        <p class="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          {{
            stats.planSharePercent == null ? t("admin.aiProcesses.stats.notCalculated") : `${stats.planSharePercent}%`
          }}
        </p>
      </article>
    </div>

    <div
      v-else-if="listFailure"
      data-ai-state="error"
      role="alert"
      class="border border-red-300 bg-white px-5 py-8 text-center dark:border-red-900 dark:bg-zinc-900">
      <p>{{ t("admin.aiProcesses.loadError") }}</p>
      <p v-if="listFailure.requestId" class="mt-2 font-mono text-xs text-zinc-500">
        requestId: {{ listFailure.requestId }}
      </p>
      <button
        type="button"
        class="mt-4 min-h-11 border border-zinc-950 px-4 text-sm dark:border-white"
        @click="refresh(queryState, canSeeStats)">
        {{ t("admin.aiProcesses.retry") }}
      </button>
    </div>

    <p
      v-else-if="items.length === 0"
      data-ai-state="empty"
      class="bg-white px-5 py-12 text-center text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
      {{ t("admin.aiProcesses.empty") }}
    </p>

    <div v-else class="overflow-x-auto">
      <table data-ai-table class="w-full min-w-[760px] border-collapse font-sans text-sm">
        <thead>
          <tr
            class="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700">
            <th class="py-3">{{ t("admin.aiProcesses.columns.process") }}</th>
            <th>{{ t("admin.aiProcesses.columns.object") }}</th>
            <th>{{ t("admin.aiProcesses.columns.status") }}</th>
            <th>{{ t("admin.aiProcesses.columns.verdict") }}</th>
            <th>{{ t("admin.aiProcesses.columns.model") }}</th>
            <th>{{ t("admin.aiProcesses.columns.prompt") }}</th>
            <th>{{ t("admin.aiProcesses.columns.duration") }}</th>
            <th>{{ t("admin.aiProcesses.columns.created") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in items"
            :key="row.id"
            :data-ai-row="row.id"
            :data-ai-status="row.status"
            class="border-b border-zinc-200 dark:border-zinc-800">
            <td class="py-4">
              <NuxtLink :to="`/admin/ai/${row.id}`" class="font-mono text-xs underline underline-offset-4">{{
                row.id
              }}</NuxtLink
              ><span class="mt-1 block text-xs text-zinc-500">{{ t(`admin.aiProcesses.kind.${row.kind}`) }}</span>
            </td>
            <td>
              <NuxtLink v-if="row.object.href" :to="row.object.href" class="underline underline-offset-4">{{
                row.object.title
              }}</NuxtLink
              ><span v-else>{{ row.object.title }}</span
              ><span v-if="row.object.subtitle" class="block text-xs text-zinc-500">{{ row.object.subtitle }}</span>
            </td>
            <td>
              <span
                class="inline-flex border border-current px-2 py-1 text-xs"
                :class="
                  row.status === 'failed'
                    ? 'text-red-700 dark:text-red-400'
                    : row.status === 'completed'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-orange-700 dark:text-orange-400'
                "
                >{{ t(`admin.aiProcesses.status.${row.status}`) }}</span
              >
            </td>
            <td>{{ row.verdict ?? "—" }}</td>
            <td class="font-mono text-xs">{{ row.model ?? "—" }}</td>
            <td class="font-mono text-xs">{{ row.promptVersion ?? "—" }}</td>
            <td>{{ formatDuration(row.durationMs) }}</td>
            <td class="whitespace-nowrap">{{ formatDate(row.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="pagination && pagination.totalPages > 1" class="mt-5 flex items-center justify-between">
        <button
          type="button"
          class="min-h-11 border border-zinc-300 px-4 text-sm disabled:opacity-40 dark:border-zinc-700"
          :disabled="!pagination.hasPreviousPage"
          @click="goToPage(queryState.page - 1)">
          {{ t("admin.aiProcesses.previous") }}
        </button>
        <span class="text-sm text-zinc-500">{{ pagination.currentPage }} / {{ pagination.totalPages }}</span>
        <button
          type="button"
          class="min-h-11 border border-zinc-300 px-4 text-sm disabled:opacity-40 dark:border-zinc-700"
          :disabled="!pagination.hasNextPage"
          @click="goToPage(queryState.page + 1)">
          {{ t("admin.aiProcesses.next") }}
        </button>
      </div>
    </div>

    <p class="mt-5 font-mono text-xs text-zinc-500">
      {{ t("admin.aiProcesses.scope", { role: viewerRole ?? summary?.role ?? "—" }) }}
    </p>
  </section>
</template>
