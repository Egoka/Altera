<script setup lang="ts">
  import { computed, onMounted, ref, watch } from "vue"
  import {
    ADMIN_JOB_PERIODS,
    ADMIN_JOB_STATUSES,
    JOB_BULK_RETRY_LIMIT,
    defaultJobsQueryState,
    jobsQueryToRoute,
    parseJobsQueryState,
    type AdminJobPeriod,
    type AdminJobRow,
    type AdminJobsQueryState
  } from "~/composables/useAdminJobs"
  import type { AdminJobSortField, AdminJobStatus } from "~/graphql/generated/graphql"

  const { t } = useI18n()
  const route = useRoute()
  const {
    page,
    summary,
    card,
    loading,
    acting,
    listFailure,
    summaryFailure,
    actionFailure,
    refresh,
    openCard,
    closeCard,
    retry,
    cancel,
    retryMany
  } = useAdminJobs()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const state = ref<AdminJobsQueryState>(parseJobsQueryState(route.query as Record<string, unknown>))
  const selected = ref<string[]>([])
  const cancelTarget = ref<AdminJobRow | null>(null)
  const cancelReason = ref("")
  const bulkOpen = ref(false)

  const rows = computed<AdminJobRow[]>(() => page.value?.jobs ?? [])
  const viewer = computed(() => page.value?.viewer ?? { canRetry: false, canCancel: false })
  const hasNoActions = computed(() => !viewer.value.canRetry && !viewer.value.canCancel)
  const failed = computed(() => listFailure.value !== null || summaryFailure.value !== null)
  const failureRequestId = computed(() => listFailure.value?.requestId ?? summaryFailure.value?.requestId ?? null)
  const conflict = computed(() => actionFailure.value?.code === "CONFLICT")
  const overLimit = computed(
    () => selected.value.length > JOB_BULK_RETRY_LIMIT || actionFailure.value?.code === "LIMIT_EXCEEDED"
  )
  const selectedKinds = computed(() => [
    ...new Set(rows.value.filter((row) => selected.value.includes(row.id)).map((row) => row.kind))
  ])

  const apply = async (patch: Partial<AdminJobsQueryState>) => {
    state.value = { ...state.value, ...patch, page: patch.page ?? 1 }
    await navigateTo({
      path: "/admin/jobs",
      query: { ...jobsQueryToRoute(state.value), ...(cardId.value ? { id: cardId.value } : {}) }
    })
  }

  const cardId = computed(() => (typeof route.query.id === "string" ? route.query.id : null))

  const reload = async () => {
    selected.value = []
    await refresh(state.value)
  }

  const toggleStatus = async (status: AdminJobStatus) => {
    const next = state.value.statuses.includes(status)
      ? state.value.statuses.filter((item) => item !== status)
      : [...state.value.statuses, status]
    await apply({ statuses: next.length ? next : defaultJobsQueryState().statuses })
  }

  const toggleSelected = (id: string) => {
    selected.value = selected.value.includes(id)
      ? selected.value.filter((item) => item !== id)
      : [...selected.value, id]
  }

  const openDetail = async (id: string) => {
    await navigateTo({ path: "/admin/jobs", query: { ...jobsQueryToRoute(state.value), id } })
  }

  const dismissDetail = async () => {
    closeCard()
    await navigateTo({ path: "/admin/jobs", query: jobsQueryToRoute(state.value) })
  }

  const runRetry = async (id: string) => {
    await retry(id)
    await reload()
    if (cardId.value) await openCard(cardId.value)
  }

  const confirmCancel = async () => {
    if (!cancelTarget.value || !cancelReason.value.trim()) return
    await cancel(cancelTarget.value.id, cancelReason.value.trim())
    cancelTarget.value = null
    cancelReason.value = ""
    await reload()
  }

  const confirmBulkRetry = async () => {
    await retryMany([...selected.value])
    bulkOpen.value = false
    await reload()
  }

  const formatDate = (value: string | null | undefined) =>
    value
      ? new Date(value).toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        })
      : "—"
  const formatDuration = (value: number | null | undefined) =>
    typeof value === "number" ? `${Math.round(value / 100) / 10} c` : "—"
  const formatRate = (value: number) => `${Math.round(value * 1000) / 10}%`

  // Раздел читается только в браузере: на сервере запрос очереди было бы некому дождаться.
  const syncFromRoute = async () => {
    state.value = parseJobsQueryState(route.query as Record<string, unknown>)
    await reload()
    if (cardId.value) await openCard(cardId.value)
    else closeCard()
  }

  watch(() => route.query, syncFromRoute)
  onMounted(syncFromRoute)
</script>

<template>
  <div class="h-full overflow-y-auto px-4 py-6 sm:px-8">
    <header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">{{ t("admin.jobs.title") }}</h1>
        <p class="mt-2 max-w-2xl font-sans text-sm text-zinc-600 dark:text-zinc-300">
          {{ t("admin.jobs.description") }}
        </p>
      </div>
      <button
        type="button"
        data-jobs-refresh
        class="min-h-11 bg-zinc-950 px-5 font-sans text-sm font-semibold text-white hover:bg-orange-700 dark:bg-zinc-100 dark:text-zinc-950"
        @click="reload">
        {{ t("admin.jobs.refresh") }}
      </button>
    </header>

    <section class="mb-6" aria-label="admin.jobs.metrics">
      <div v-if="!summary" aria-busy="true" class="grid gap-2 sm:grid-cols-3">
        <div v-for="index in 3" :key="index" class="h-20 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <dl v-else-if="summary" data-jobs-summary class="grid gap-2 sm:grid-cols-3">
        <div class="border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <dt class="font-sans text-xs text-zinc-500">{{ t("admin.jobs.metricDepth") }}</dt>
          <dd class="mt-1 font-mono text-2xl text-zinc-950 dark:text-zinc-50">
            {{ summary.depthByKind.reduce((total, item) => total + item.depth, 0) }}
          </dd>
          <dd class="mt-1 font-sans text-xs text-zinc-500">
            <span v-for="item in summary.depthByKind" :key="item.kind" class="mr-2"
              >{{ item.kind }} · {{ item.depth }}</span
            >
            <span v-if="!summary.depthByKind.length">{{ t("admin.jobs.noPending") }}</span>
          </dd>
        </div>
        <div class="border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <dt class="font-sans text-xs text-zinc-500">{{ t("admin.jobs.metricOldest") }}</dt>
          <dd class="mt-1 font-mono text-2xl text-zinc-950 dark:text-zinc-50">
            {{ summary.oldestPendingAgeSec === null ? "—" : `${summary.oldestPendingAgeSec} c` }}
          </dd>
        </div>
        <div class="border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <dt class="font-sans text-xs text-zinc-500">{{ t("admin.jobs.metricFailureRate") }}</dt>
          <dd class="mt-1 font-mono text-2xl text-zinc-950 dark:text-zinc-50">{{ formatRate(summary.failureRate) }}</dd>
          <dd class="mt-1 font-sans text-xs text-zinc-500">
            {{ summary.failedInPeriod }} / {{ summary.finishedInPeriod }}
          </dd>
        </div>
      </dl>
    </section>

    <div class="mb-5 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
      <div>
        <label class="mb-1 block font-sans text-xs text-zinc-500" for="jobs-kind">{{
          t("admin.jobs.filterKind")
        }}</label>
        <select
          id="jobs-kind"
          data-jobs-kind
          :value="state.kind ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="apply({ kind: ($event.target as HTMLSelectElement).value || null })">
          <option value="">{{ t("admin.jobs.allKinds") }}</option>
          <option v-for="kind in page?.kinds ?? []" :key="kind" :value="kind">{{ kind }}</option>
        </select>
      </div>

      <fieldset class="flex flex-wrap items-center gap-2">
        <legend class="mb-1 font-sans text-xs text-zinc-500">{{ t("admin.jobs.filterStatus") }}</legend>
        <button
          v-for="status in ADMIN_JOB_STATUSES"
          :key="status"
          type="button"
          :data-jobs-status="status"
          :aria-pressed="state.statuses.includes(status)"
          class="min-h-11 border px-3 font-sans text-xs"
          :class="
            state.statuses.includes(status)
              ? 'border-orange-600 bg-orange-50 text-orange-800 dark:bg-orange-950 dark:text-orange-200'
              : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'
          "
          @click="toggleStatus(status)">
          {{ t(`admin.jobs.status.${status}`) }}
        </button>
      </fieldset>

      <div>
        <label class="mb-1 block font-sans text-xs text-zinc-500" for="jobs-period">{{
          t("admin.jobs.filterPeriod")
        }}</label>
        <select
          id="jobs-period"
          data-jobs-period
          :value="state.period"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="apply({ period: ($event.target as HTMLSelectElement).value as AdminJobPeriod })">
          <option v-for="period in ADMIN_JOB_PERIODS" :key="period" :value="period">
            {{ t(`admin.jobs.period.${period}`) }}
          </option>
        </select>
      </div>

      <div>
        <label class="mb-1 block font-sans text-xs text-zinc-500" for="jobs-object">{{
          t("admin.jobs.filterObject")
        }}</label>
        <input
          id="jobs-object"
          data-jobs-object
          type="search"
          :value="state.objectId ?? ''"
          :placeholder="t('admin.jobs.filterObject')"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="apply({ objectId: ($event.target as HTMLInputElement).value.trim() || null })" />
      </div>

      <button
        type="button"
        data-jobs-stuck
        :aria-pressed="state.stuckOnly"
        class="min-h-11 border px-3 font-sans text-xs"
        :class="
          state.stuckOnly
            ? 'border-orange-600 bg-orange-50 text-orange-800 dark:bg-orange-950 dark:text-orange-200'
            : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'
        "
        @click="apply({ stuckOnly: !state.stuckOnly })">
        {{ t("admin.jobs.filterStuck") }}
      </button>

      <div>
        <label class="mb-1 block font-sans text-xs text-zinc-500" for="jobs-sort">{{ t("admin.jobs.sort") }}</label>
        <select
          id="jobs-sort"
          data-jobs-sort
          :value="state.sort"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="apply({ sort: ($event.target as HTMLSelectElement).value as AdminJobSortField })">
          <option value="createdAt">{{ t("admin.jobs.sortCreatedAt") }}</option>
          <option value="duration">{{ t("admin.jobs.sortDuration") }}</option>
          <option value="attempts">{{ t("admin.jobs.sortAttempts") }}</option>
        </select>
      </div>
    </div>

    <p
      v-if="hasNoActions"
      data-jobs-no-actions
      class="mb-5 border border-zinc-300 bg-zinc-50 p-3 font-sans text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      {{ t("admin.jobs.ownerOnly") }}
    </p>

    <div
      v-if="failed"
      role="alert"
      data-jobs-error
      class="mb-5 border border-red-300 bg-red-50 p-4 font-sans text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {{ t("admin.jobs.error") }}
      <span v-if="failureRequestId" class="font-mono">requestId: {{ failureRequestId }}</span>
    </div>

    <div
      v-if="conflict"
      role="alert"
      data-jobs-conflict
      class="mb-5 border border-amber-300 bg-amber-50 p-4 font-sans text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {{ t("admin.jobs.conflict") }}
    </div>

    <div
      v-if="overLimit"
      role="alert"
      data-jobs-limit
      class="mb-5 border border-amber-300 bg-amber-50 p-4 font-sans text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {{ t("admin.jobs.limit", { limit: JOB_BULK_RETRY_LIMIT }) }}
    </div>

    <div v-if="viewer.canRetry && selected.length" class="mb-4 flex items-center gap-3">
      <button
        type="button"
        data-jobs-bulk-open
        class="min-h-11 border border-zinc-300 px-4 font-sans text-sm dark:border-zinc-700"
        :disabled="overLimit"
        @click="bulkOpen = true">
        {{ t("admin.jobs.bulkRetry", { count: selected.length }) }}
      </button>
    </div>

    <div v-if="loading || !page" aria-busy="true" data-jobs-loading class="grid gap-2">
      <div v-for="index in 5" :key="index" class="h-14 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>

    <div v-else class="grid gap-2">
      <article
        v-for="row in rows"
        :key="row.id"
        :data-job-row="row.id"
        :data-job-status="row.status"
        class="grid grid-cols-1 gap-3 border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-[auto_1fr_auto] sm:items-center">
        <input
          v-if="viewer.canRetry && row.retryable"
          type="checkbox"
          :data-job-select="row.id"
          :aria-label="row.kind"
          :checked="selected.includes(row.id)"
          class="size-4"
          @change="toggleSelected(row.id)" />
        <span v-else class="hidden sm:block sm:size-4" />

        <button type="button" class="min-w-0 text-left" :data-job-open="row.id" @click="openDetail(row.id)">
          <span class="font-mono text-sm text-zinc-950 dark:text-zinc-50">{{ row.kind }}</span>
          <span class="ml-3 font-sans text-xs uppercase tracking-wide text-orange-700 dark:text-orange-400">
            {{ t(`admin.jobs.status.${row.status}`) }}
          </span>
          <span class="mt-1 block font-sans text-xs text-zinc-500">
            {{ t("admin.jobs.created") }}: {{ formatDate(row.createdAt) }} · {{ t("admin.jobs.attempts") }}:
            {{ row.attemptCount }}/{{ row.maxAttempts }} · {{ t("admin.jobs.duration") }}:
            {{ formatDuration(row.durationMs) }}
          </span>
          <span v-if="row.objectId" class="mt-1 block font-mono text-xs text-zinc-400">
            {{ row.objectType }} · {{ row.objectId }}
          </span>
          <span v-if="row.lastErrorClass" class="mt-1 block font-mono text-xs text-red-700 dark:text-red-400">
            {{ row.lastErrorClass }}<span v-if="row.lastErrorRequestId"> · {{ row.lastErrorRequestId }}</span>
          </span>
        </button>

        <div class="flex flex-wrap gap-2">
          <button
            v-if="viewer.canRetry && row.retryable"
            type="button"
            :data-job-retry="row.id"
            :disabled="acting"
            class="min-h-11 border border-zinc-300 px-3 font-sans text-xs dark:border-zinc-700"
            @click="runRetry(row.id)">
            {{ t("admin.jobs.retry") }}
          </button>
          <button
            v-if="viewer.canCancel && row.cancellable"
            type="button"
            :data-job-cancel="row.id"
            :disabled="acting"
            class="min-h-11 border border-red-300 px-3 font-sans text-xs text-red-700 dark:border-red-800 dark:text-red-400"
            @click="cancelTarget = row">
            {{ t("admin.jobs.cancel") }}
          </button>
        </div>
      </article>

      <p
        v-if="!rows.length"
        data-jobs-empty
        class="border border-dashed border-zinc-300 p-12 text-center font-serif text-2xl dark:border-zinc-700">
        {{ t("admin.jobs.empty") }}
      </p>
    </div>

    <nav v-if="page && page.pagination.totalPages > 1" class="mt-5 flex items-center gap-3 font-sans text-sm">
      <button
        type="button"
        data-jobs-prev
        :disabled="!page.pagination.hasPreviousPage"
        class="min-h-11 border border-zinc-300 px-3 disabled:opacity-40 dark:border-zinc-700"
        @click="apply({ page: state.page - 1 })">
        ←
      </button>
      <span class="font-mono">{{ page.pagination.currentPage }} / {{ page.pagination.totalPages }}</span>
      <button
        type="button"
        data-jobs-next
        :disabled="!page.pagination.hasNextPage"
        class="min-h-11 border border-zinc-300 px-3 disabled:opacity-40 dark:border-zinc-700"
        @click="apply({ page: state.page + 1 })">
        →
      </button>
    </nav>

    <aside
      v-if="card"
      data-job-card
      class="mt-6 border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div class="flex items-start justify-between">
        <div>
          <h2 class="font-mono text-lg text-zinc-950 dark:text-zinc-50">{{ card.job.kind }}</h2>
          <p class="mt-1 font-sans text-xs text-zinc-500">
            {{ t(`admin.jobs.status.${card.job.status}`) }} · {{ card.job.id }}
          </p>
        </div>
        <button type="button" data-job-card-close class="min-h-11 px-3 font-sans text-sm" @click="dismissDetail">
          ✕
        </button>
      </div>

      <NuxtLink
        v-if="card.objectHref"
        :to="card.objectHref"
        data-job-object
        class="mt-4 inline-block font-sans text-sm text-orange-700 dark:text-orange-400">
        {{ t("admin.jobs.openObject") }}
      </NuxtLink>
      <p v-else-if="card.job.objectId" class="mt-4 font-mono text-xs text-zinc-500">
        {{ card.job.objectType }} · {{ card.job.objectId }}
      </p>

      <h3 class="mt-5 font-sans text-xs uppercase tracking-wide text-zinc-500">{{ t("admin.jobs.parameters") }}</h3>
      <dl v-if="card.parameters.length" class="mt-2 grid gap-1 font-mono text-xs">
        <div v-for="parameter in card.parameters" :key="parameter.key" class="flex gap-2">
          <dt class="text-zinc-500">{{ parameter.key }}</dt>
          <dd class="text-zinc-950 dark:text-zinc-50">{{ parameter.value }}</dd>
        </div>
      </dl>
      <p v-else class="mt-2 font-sans text-xs text-zinc-500">{{ t("admin.jobs.noParameters") }}</p>

      <h3 class="mt-5 font-sans text-xs uppercase tracking-wide text-zinc-500">
        {{ t("admin.jobs.attemptsHistory") }}
      </h3>
      <ol v-if="card.attempts.length" class="mt-2 grid gap-1 font-mono text-xs">
        <li v-for="attempt in card.attempts" :key="attempt.number" :data-job-attempt="attempt.number">
          #{{ attempt.number }} · {{ t(`admin.jobs.status.${attempt.status}`) }} · {{ formatDate(attempt.startedAt) }}
          <span v-if="attempt.errorClass" class="text-red-700 dark:text-red-400">
            · {{ attempt.errorClass }}<span v-if="attempt.errorRequestId"> · {{ attempt.errorRequestId }}</span>
          </span>
        </li>
      </ol>
      <p v-else class="mt-2 font-sans text-xs text-zinc-500">{{ t("admin.jobs.noAttempts") }}</p>

      <h3 class="mt-5 font-sans text-xs uppercase tracking-wide text-zinc-500">{{ t("admin.jobs.actionsHistory") }}</h3>
      <ol v-if="card.actions.length" class="mt-2 grid gap-1 font-sans text-xs">
        <li v-for="(action, index) in card.actions" :key="index" :data-job-action="action.action">
          {{ t(`admin.jobs.action.${action.action}`) }} · {{ action.actorName ?? action.actorId }} ·
          {{ formatDate(action.createdAt) }}
          <span v-if="action.reason">· {{ action.reason }}</span>
        </li>
      </ol>
      <p v-else class="mt-2 font-sans text-xs text-zinc-500">{{ t("admin.jobs.noActions") }}</p>
    </aside>

    <div
      v-if="cancelTarget"
      data-jobs-cancel-modal
      class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
      <div class="w-full max-w-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 class="font-serif text-xl text-zinc-950 dark:text-zinc-50">{{ t("admin.jobs.cancelTitle") }}</h2>
        <p class="mt-2 font-sans text-sm text-zinc-600 dark:text-zinc-300">
          {{ t("admin.jobs.cancelHint", { kind: cancelTarget.kind }) }}
        </p>
        <label class="mt-4 block font-sans text-xs text-zinc-500" for="jobs-cancel-reason">{{
          t("admin.jobs.reason")
        }}</label>
        <input
          id="jobs-cancel-reason"
          v-model="cancelReason"
          data-jobs-cancel-reason
          class="mt-1 min-h-11 w-full border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-950" />
        <div class="mt-5 flex gap-2">
          <button
            type="button"
            class="min-h-11 flex-1 border border-zinc-300 font-sans text-sm dark:border-zinc-700"
            @click="cancelTarget = null">
            {{ t("admin.jobs.close") }}
          </button>
          <button
            type="button"
            data-jobs-cancel-confirm
            :disabled="!cancelReason.trim() || acting"
            class="min-h-11 flex-1 border border-red-300 font-sans text-sm text-red-700 disabled:opacity-40 dark:border-red-800 dark:text-red-400"
            @click="confirmCancel">
            {{ t("admin.jobs.confirm") }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="bulkOpen"
      data-jobs-bulk-modal
      class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
      <div class="w-full max-w-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 class="font-serif text-xl text-zinc-950 dark:text-zinc-50">{{ t("admin.jobs.bulkRetryTitle") }}</h2>
        <p class="mt-2 font-sans text-sm text-zinc-600 dark:text-zinc-300">
          {{ t("admin.jobs.bulkRetryHint", { count: selected.length, kinds: selectedKinds.join(", ") }) }}
        </p>
        <div class="mt-5 flex gap-2">
          <button
            type="button"
            class="min-h-11 flex-1 border border-zinc-300 font-sans text-sm dark:border-zinc-700"
            @click="bulkOpen = false">
            {{ t("admin.jobs.close") }}
          </button>
          <button
            type="button"
            data-jobs-bulk-confirm
            :disabled="acting || overLimit"
            class="min-h-11 flex-1 border border-zinc-300 font-sans text-sm disabled:opacity-40 dark:border-zinc-700"
            @click="confirmBulkRetry">
            {{ t("admin.jobs.confirm") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
