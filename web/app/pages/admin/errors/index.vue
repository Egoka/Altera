<script setup lang="ts">
  import { computed, ref } from "vue"
  import type {
    ErrorLogFilters,
    ErrorPeriodInput,
    ErrorStreamFilter,
    ErrorWorkStatus
  } from "~/graphql/generated/graphql"

  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const {
    items,
    pagination,
    stats,
    health,
    pending,
    failed,
    requestId,
    errorCode,
    rateLimitRetryAfter,
    load,
    loadStats,
    loadHealth,
    resolveMany,
    exportCsv
  } = useAdminErrors()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-errors"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const periodAnchor = useState("admin.errors.periodAnchor", () => new Date().toISOString())
  const selected = ref<string[]>([])
  const resolveConfirmOpen = ref(false)
  const tab = computed(() => (typeof route.query.tab === "string" ? route.query.tab : "log"))
  const period = computed<ErrorPeriodInput>(() => {
    const to = new Date(periodAnchor.value)
    const from = new Date(to)
    const value = typeof route.query.period === "string" ? route.query.period : "24h"
    if (value === "30d") from.setUTCDate(from.getUTCDate() - 30)
    else if (value === "7d") from.setUTCDate(from.getUTCDate() - 7)
    else from.setUTCHours(from.getUTCHours() - 24)
    return { from: from.toISOString(), to: to.toISOString() }
  })
  const filters = computed<ErrorLogFilters>(() => ({
    period: period.value,
    stream:
      typeof route.query.stream === "string" && route.query.stream ? (route.query.stream as ErrorStreamFilter) : null,
    q: typeof route.query.q === "string" && route.query.q ? route.query.q : null,
    service: typeof route.query.service === "string" && route.query.service ? route.query.service : null,
    code: typeof route.query.code === "string" && route.query.code ? route.query.code : null,
    route: typeof route.query.route === "string" && route.query.route ? route.query.route : null,
    workStatus:
      typeof route.query.workStatus === "string" && route.query.workStatus
        ? [route.query.workStatus as ErrorWorkStatus]
        : null
  }))
  const latestHealth = computed(() => health.value[0] ?? null)
  const degradedComponents = computed(
    () => latestHealth.value?.components.filter((component) => component.status === "down") ?? []
  )

  const refresh = async () => {
    await load(filters.value, Number(route.query.page) || 1)
    if (failed.value) return
    await Promise.all([loadStats(period.value), loadHealth(period.value)])
  }
  useAsyncData("admin-errors", refresh, { lazy: true, server: false })

  const updateQuery = (patch: Record<string, string | undefined>) => {
    const query = { ...(route.query as Record<string, string>) }
    for (const [key, value] of Object.entries(patch)) value ? (query[key] = value) : delete query[key]
    if (!("page" in patch)) delete query.page
    return router.replace({ query })
  }
  const onFilter = (key: string, event: Event) =>
    updateQuery({ [key]: (event.target as HTMLInputElement | HTMLSelectElement).value }).then(refresh)
  const goToPage = (page: number) => updateQuery({ page: String(page) }).then(refresh)
  const resolveSelected = async () => {
    if (!(await resolveMany(selected.value))) return
    resolveConfirmOpen.value = false
    selected.value = []
    await refresh()
  }
  const downloadCsv = async () => {
    const file = await exportCsv(filters.value)
    if (!file || !import.meta.client) return
    const url = URL.createObjectURL(new Blob([file.csv], { type: `${file.contentType};charset=utf-8` }))
    const link = document.createElement("a")
    link.href = url
    link.download = file.filename
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }
  const formatDate = (value: string) =>
    new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" })
</script>

<template>
  <section class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8">
    <header class="mb-6 border-b border-zinc-300 pb-5 dark:border-zinc-700">
      <p class="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-red-700 dark:text-red-400">
        {{ t("admin.errors.eyebrow") }}
      </p>
      <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="font-serif text-3xl text-zinc-950 dark:text-zinc-50 sm:text-4xl">{{ t("admin.errors.title") }}</h1>
          <p class="mt-2 max-w-2xl font-sans text-sm text-zinc-600 dark:text-zinc-300">
            {{ t("admin.errors.description") }}
          </p>
        </div>
        <button
          data-errors-export
          class="min-h-11 border border-zinc-950 px-4 font-sans text-sm dark:border-zinc-100"
          @click="downloadCsv">
          {{ t("admin.errors.export") }}
        </button>
      </div>
    </header>

    <aside
      data-health-pulse
      class="mb-6 border-l-4 border-emerald-600 bg-white p-4 dark:bg-zinc-900"
      :class="{
        '!border-amber-500': latestHealth?.status === 'degraded',
        '!border-red-600': latestHealth?.status === 'unavailable'
      }">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <strong class="font-mono text-xs uppercase tracking-wider">{{ t("admin.errors.health") }}</strong>
        <span class="font-sans text-sm">{{ latestHealth?.status ?? t("admin.errors.healthUnknown") }}</span>
        <span v-for="component in degradedComponents" :key="component.name" class="font-mono text-xs">
          {{ component.name }} · {{ component.status }}
        </span>
      </div>
      <p
        v-if="latestHealth && latestHealth.status !== 'ok'"
        data-health-degraded
        class="mt-2 font-sans text-sm text-amber-800 dark:text-amber-200">
        {{ t("admin.errors.healthDegraded") }}
      </p>
    </aside>

    <nav class="mb-5 flex gap-1 border-b border-zinc-300 dark:border-zinc-700" :aria-label="t('admin.errors.tabs')">
      <button
        v-for="value in ['log', 'charts', 'health']"
        :key="value"
        type="button"
        class="min-h-11 border-b-2 px-4 font-sans text-sm"
        :class="tab === value ? 'border-red-600 text-zinc-950 dark:text-white' : 'border-transparent text-zinc-500'"
        @click="updateQuery({ tab: value })">
        {{ t(`admin.errors.tab.${value}`) }}
      </button>
    </nav>

    <p
      v-if="errorCode === 'CONFLICT'"
      data-errors-conflict
      role="alert"
      class="mb-4 border border-amber-400 bg-amber-50 p-3 font-sans text-sm text-amber-900">
      {{ t("admin.errors.conflict") }} · <span class="font-mono">CONFLICT</span>
    </p>
    <p
      v-if="rateLimitRetryAfter !== null"
      data-errors-rate-limited
      role="alert"
      class="mb-4 border border-amber-400 bg-amber-50 p-3 font-sans text-sm text-amber-900">
      {{ t("admin.errors.rateLimited", { seconds: rateLimitRetryAfter }) }} ·
      <span class="font-mono">RATE_LIMITED</span>
    </p>
    <p
      v-if="failed"
      data-errors-error
      role="alert"
      class="mb-4 border border-red-400 bg-red-50 p-3 font-sans text-sm text-red-900">
      {{ t("admin.errors.loadError") }} <span v-if="requestId" class="font-mono">requestId: {{ requestId }}</span>
    </p>

    <div v-if="tab === 'charts'" class="grid gap-4 md:grid-cols-2" data-errors-charts>
      <article class="border border-zinc-300 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <p class="font-sans text-sm text-zinc-500">{{ t("admin.errors.currentTotal") }}</p>
        <p class="font-serif text-4xl">{{ stats?.currentTotal ?? 0 }}</p>
        <p class="font-mono text-xs text-zinc-500">
          {{ t("admin.errors.previousTotal") }}: {{ stats?.previousTotal ?? 0 }}
        </p>
      </article>
      <article class="border border-zinc-300 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 class="mb-3 font-serif text-xl">{{ t("admin.errors.byService") }}</h2>
        <p v-for="bucket in stats?.byService ?? []" :key="bucket.key" class="flex justify-between font-mono text-sm">
          <span>{{ bucket.key }}</span
          ><strong>{{ bucket.count }}</strong>
        </p>
      </article>
      <article class="border border-zinc-300 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 class="mb-3 font-serif text-xl">{{ t("admin.errors.timeline") }}</h2>
        <p
          v-for="point in stats?.timeline ?? []"
          :key="point.bucket"
          class="flex justify-between gap-4 font-mono text-xs">
          <time>{{ formatDate(point.bucket) }}</time
          ><strong>{{ point.count }}</strong>
        </p>
      </article>
      <article class="border border-zinc-300 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 class="mb-3 font-serif text-xl">{{ t("admin.errors.byCode") }}</h2>
        <p v-for="bucket in stats?.byCode ?? []" :key="bucket.key" class="flex justify-between gap-4 font-mono text-xs">
          <span class="truncate">{{ bucket.key }}</span
          ><strong>{{ bucket.count }}</strong>
        </p>
      </article>
    </div>

    <div v-else-if="tab === 'health'" class="grid gap-3" data-health-history>
      <article
        v-for="snapshot in health"
        :key="snapshot.id"
        class="border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <div class="flex justify-between gap-4">
          <strong>{{ snapshot.status }}</strong
          ><time class="font-mono text-xs">{{ formatDate(snapshot.checkedAt) }}</time>
        </div>
        <p class="mt-2 font-mono text-xs">
          {{ snapshot.components.map((item) => `${item.name}: ${item.status}`).join(" · ") }}
        </p>
      </article>
    </div>

    <template v-else>
      <div class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <input
          data-errors-filter="q"
          :value="route.query.q ?? ''"
          :placeholder="t('admin.errors.search')"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onFilter('q', $event)" />
        <select
          data-errors-filter="service"
          :value="route.query.service ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onFilter('service', $event)">
          <option value="">{{ t("admin.errors.allServices") }}</option>
          <option v-for="service in ['api', 'web', 'worker']" :key="service" :value="service">{{ service }}</option>
        </select>
        <input
          data-errors-filter="code"
          :value="route.query.code ?? ''"
          :placeholder="t('admin.errors.code')"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onFilter('code', $event)" />
        <input
          data-errors-filter="route"
          :value="route.query.route ?? ''"
          :placeholder="t('admin.errors.route')"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onFilter('route', $event)" />
        <select
          data-errors-filter="workStatus"
          :value="route.query.workStatus ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onFilter('workStatus', $event)">
          <option value="">{{ t("admin.errors.allStatuses") }}</option>
          <option v-for="status in ['new', 'in_progress', 'resolved']" :key="status" :value="status">
            {{ t(`admin.errors.status.${status}`) }}
          </option>
        </select>
        <select
          data-errors-filter="stream"
          :value="route.query.stream ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onFilter('stream', $event)">
          <option value="">{{ t("admin.errors.defaultStream") }}</option>
          <option value="page">{{ t("admin.errors.stream.page") }}</option>
        </select>
        <select
          data-errors-filter="period"
          :value="route.query.period ?? '24h'"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onFilter('period', $event)">
          <option value="24h">24 {{ t("admin.errors.hours") }}</option>
          <option value="7d">7 {{ t("admin.errors.days") }}</option>
          <option value="30d">30 {{ t("admin.errors.days") }}</option>
        </select>
      </div>
      <div v-if="selected.length" class="mb-3 flex items-center gap-3">
        <span class="font-sans text-sm">{{ t("admin.errors.selected", { count: selected.length }) }}</span>
        <button
          data-errors-bulk-open
          class="min-h-11 bg-zinc-950 px-4 font-sans text-sm text-white dark:bg-zinc-100 dark:text-zinc-950"
          @click="resolveConfirmOpen = true">
          {{ t("admin.errors.resolve") }}
        </button>
      </div>
      <div
        v-if="resolveConfirmOpen"
        data-errors-bulk-confirm
        role="dialog"
        aria-modal="true"
        class="mb-5 border border-zinc-950 bg-white p-4 dark:border-zinc-100 dark:bg-zinc-900">
        <p class="font-serif text-xl">{{ t("admin.errors.resolveConfirm", { count: selected.length }) }}</p>
        <div class="mt-3 flex gap-3">
          <button
            data-errors-bulk-confirm-button
            class="min-h-11 bg-zinc-950 px-4 font-sans text-sm text-white dark:bg-zinc-100 dark:text-zinc-950"
            @click="resolveSelected">
            {{ t("admin.errors.confirm") }}
          </button>
          <button class="min-h-11 px-4 font-sans text-sm underline" @click="resolveConfirmOpen = false">
            {{ t("admin.errors.cancel") }}
          </button>
        </div>
      </div>
      <div v-if="pending && !items.length" data-errors-loading aria-busy="true" class="grid gap-2">
        <div
          v-for="index in 5"
          :key="index"
          class="h-14 animate-pulse bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800" />
      </div>
      <p
        v-else-if="!items.length && !failed"
        data-errors-empty
        class="border border-zinc-300 bg-white p-12 text-center font-serif text-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {{ t("admin.errors.empty") }}
      </p>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[52rem] border-collapse font-sans text-sm">
          <thead>
            <tr class="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th class="py-2">
                <span class="sr-only">{{ t("admin.errors.select") }}</span>
              </th>
              <th>{{ t("admin.errors.error") }}</th>
              <th>{{ t("admin.errors.service") }}</th>
              <th>{{ t("admin.errors.statusLabel") }}</th>
              <th>{{ t("admin.errors.occurrences") }}</th>
              <th>{{ t("admin.errors.lastSeen") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in items"
              :key="item.id"
              :data-error-row="item.id"
              class="border-b border-zinc-200 dark:border-zinc-800">
              <td class="py-3">
                <input
                  v-if="item.stream === 'backend' && item.workStatus !== 'resolved'"
                  v-model="selected"
                  type="checkbox"
                  :data-error-select="item.id"
                  :value="item.id" />
              </td>
              <td class="py-3">
                <NuxtLink
                  v-if="item.stream === 'backend'"
                  :to="`/admin/errors/${item.id}`"
                  :data-error-open="item.id"
                  class="font-mono underline underline-offset-4"
                  >{{ item.code }}</NuxtLink
                ><span v-else class="font-mono">{{ item.code }}</span
                ><span class="block max-w-md truncate text-xs text-zinc-500">{{ item.route ?? item.signature }}</span>
              </td>
              <td>{{ item.service }}</td>
              <td>
                {{ item.workStatus ? t(`admin.errors.status.${item.workStatus}`) : "—" }}
                <span v-if="item.assignedActorId" class="block font-mono text-xs text-zinc-500">
                  {{ item.assignedActorRole }} · {{ item.assignedActorId }}
                </span>
              </td>
              <td>{{ item.occurrences }}</td>
              <td class="font-mono text-xs">{{ formatDate(item.lastSeenAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <nav v-if="pagination && pagination.totalPages > 1" class="mt-5 flex items-center gap-3" aria-label="pagination">
        <button
          class="min-h-11 border border-zinc-300 px-3 disabled:opacity-40"
          :disabled="!pagination.hasPreviousPage"
          @click="goToPage(pagination.currentPage - 1)">
          {{ t("admin.errors.previous") }}
        </button>
        <span class="font-sans text-sm">{{ pagination.currentPage }} / {{ pagination.totalPages }}</span>
        <button
          class="min-h-11 border border-zinc-300 px-3 disabled:opacity-40"
          :disabled="!pagination.hasNextPage"
          @click="goToPage(pagination.currentPage + 1)">
          {{ t("admin.errors.next") }}
        </button>
      </nav>
    </template>
  </section>
</template>
