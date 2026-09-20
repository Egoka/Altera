<script setup lang="ts">
  import { computed, onMounted, ref } from "vue"
  import { AUDIT_ZONES, auditEntityLink, buildAuditQuery, parseAuditQuery, toAuditFilters } from "~/utils/audit"

  const { t } = useI18n()
  const route = useRoute()
  const {
    entries,
    page,
    summary,
    pending,
    failed,
    requestId,
    rateLimitRetryAfter,
    load,
    loadMore,
    openEntry,
    exportCsv
  } = useAdminAudit()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const zones = AUDIT_ZONES
  const state = ref(parseAuditQuery(route.query))
  const exportConfirmOpen = ref(false)
  const exportedFile = ref<{ filename: string; rows: number } | null>(null)

  const currentFilters = () => toAuditFilters(state.value, new Date())
  const refresh = () => load(currentFilters())

  // Запись открывается на сервере: вне зоны служебной роли адрес отвечает 404, а не пустой панелью.
  const entryId = computed(() => state.value.entryId)
  const { data: entry, error: entryError } = await useAsyncData(
    "admin-audit-entry",
    () => (entryId.value ? openEntry(entryId.value) : Promise.resolve(null)),
    { watch: [entryId] }
  )
  if (entryError.value) {
    throw createError({ statusCode: 404, statusMessage: "Audit entry not found" })
  }

  const syncUrl = () => navigateTo({ path: "/admin/audit", query: buildAuditQuery(state.value) })
  const applyFilters = async () => {
    state.value.entryId = ""
    await syncUrl()
    await refresh()
  }
  const resetFilters = async () => {
    state.value = parseAuditQuery({})
    await syncUrl()
    await refresh()
  }
  const openDetail = async (id: string) => {
    state.value.entryId = id
    await syncUrl()
  }
  const closeDetail = async () => {
    state.value.entryId = ""
    await syncUrl()
  }

  const isFullJournal = computed(() => page.value?.zone === null)
  const actorOptions = computed(() => summary.value?.byActor.filter((bucket) => bucket.key !== "system") ?? [])
  const entityLink = computed(() =>
    entry.value ? auditEntityLink(entry.value.entityType, entry.value.entityId) : null
  )
  const diffRows = computed(() => {
    const diff = entry.value?.diff
    if (!diff || typeof diff !== "object" || Array.isArray(diff)) return []
    return Object.entries(diff as Record<string, unknown>).map(([field, value]) => ({
      field,
      value: typeof value === "string" ? value : JSON.stringify(value)
    }))
  })

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" })

  const confirmExport = async () => {
    exportConfirmOpen.value = false
    const file = await exportCsv(currentFilters())
    if (!file) return
    exportedFile.value = { filename: file.filename, rows: file.rows }
    if (!import.meta.client) return
    const url = URL.createObjectURL(new Blob([file.csv], { type: `${file.contentType};charset=utf-8` }))
    const link = document.createElement("a")
    link.href = url
    link.download = file.filename
    // Ссылка добавляется в документ: браузер отменяет загрузку с отсоединённого элемента.
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  onMounted(refresh)
</script>

<template>
  <section class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8">
    <header class="mb-7">
      <p class="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-orange-700 dark:text-orange-400">
        {{ t("admin.audit.eyebrow") }}
      </p>
      <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 class="font-serif text-3xl text-zinc-950 dark:text-zinc-50 sm:text-4xl">{{ t("admin.audit.title") }}</h1>
          <p class="mt-2 max-w-2xl font-sans text-sm text-zinc-600 dark:text-zinc-300">
            {{ t("admin.audit.description") }}
          </p>
          <p class="mt-2 font-sans text-xs text-zinc-500 dark:text-zinc-400" data-audit-scope>
            {{ isFullJournal ? t("admin.audit.scopeFull") : t(`admin.audit.scope.${page?.zone ?? "own"}`) }}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-audit-refresh
            class="min-h-11 border border-zinc-300 px-4 font-sans text-sm dark:border-zinc-700"
            @click="refresh">
            {{ t("admin.audit.refresh") }}
          </button>
          <button
            v-if="page?.canExport"
            type="button"
            data-audit-export
            class="min-h-11 bg-zinc-950 px-5 font-sans text-sm font-semibold text-white hover:bg-orange-700 dark:bg-zinc-100 dark:text-zinc-950"
            @click="exportConfirmOpen = true">
            {{ t("admin.audit.export") }}
          </button>
        </div>
      </div>
    </header>

    <form class="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" @submit.prevent="applyFilters">
      <div v-if="isFullJournal">
        <label class="mb-1 block font-sans text-xs text-zinc-500" for="audit-zone">{{ t("admin.audit.zone") }}</label>
        <select
          id="audit-zone"
          v-model="state.zone"
          data-audit-filter-zone
          class="min-h-11 w-full border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <option :value="null">{{ t("admin.audit.allZones") }}</option>
          <option v-for="zone in zones" :key="zone" :value="zone">{{ t(`admin.audit.scope.${zone}`) }}</option>
        </select>
      </div>
      <div>
        <label class="mb-1 block font-sans text-xs text-zinc-500" for="audit-action">{{
          t("admin.audit.action")
        }}</label>
        <select
          id="audit-action"
          v-model="state.action"
          data-audit-filter-action
          class="min-h-11 w-full border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <option value="">{{ t("admin.audit.allActions") }}</option>
          <option v-for="action in page?.availableActions ?? []" :key="action" :value="action">{{ action }}</option>
        </select>
      </div>
      <div>
        <label class="mb-1 block font-sans text-xs text-zinc-500" for="audit-actor">{{ t("admin.audit.actor") }}</label>
        <select
          id="audit-actor"
          v-model="state.actor"
          data-audit-filter-actor
          :disabled="state.system"
          class="min-h-11 w-full border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <option value="">{{ t("admin.audit.allActors") }}</option>
          <option v-for="actor in actorOptions" :key="actor.key" :value="actor.key">
            {{ actor.label ?? actor.key }}
          </option>
        </select>
        <label class="mt-2 flex items-center gap-2 font-sans text-xs text-zinc-500">
          <input v-model="state.system" type="checkbox" data-audit-filter-system />
          {{ t("admin.audit.systemOnly") }}
        </label>
      </div>
      <div>
        <label class="mb-1 block font-sans text-xs text-zinc-500" for="audit-period">{{
          t("admin.audit.period")
        }}</label>
        <input
          id="audit-period"
          v-model="state.period"
          data-audit-filter-period
          :placeholder="t('admin.audit.periodHint')"
          class="min-h-11 w-full border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </div>
      <div>
        <label class="mb-1 block font-sans text-xs text-zinc-500" for="audit-entity">{{
          t("admin.audit.entity")
        }}</label>
        <input
          id="audit-entity"
          v-model="state.entityType"
          data-audit-filter-entity-type
          :placeholder="t('admin.audit.entityTypeHint')"
          class="min-h-11 w-full border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </div>
      <div>
        <label class="mb-1 block font-sans text-xs text-zinc-500" for="audit-entity-id">{{
          t("admin.audit.entityId")
        }}</label>
        <input
          id="audit-entity-id"
          v-model="state.entityId"
          data-audit-filter-entity-id
          class="min-h-11 w-full border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </div>
      <div>
        <label class="mb-1 block font-sans text-xs text-zinc-500" for="audit-subject">{{
          t("admin.audit.subject")
        }}</label>
        <input
          id="audit-subject"
          v-model="state.subject"
          data-audit-filter-subject
          class="min-h-11 w-full border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </div>
      <div>
        <label class="mb-1 block font-sans text-xs text-zinc-500" for="audit-request-id">requestId</label>
        <input
          id="audit-request-id"
          v-model="state.requestId"
          data-audit-filter-request-id
          class="min-h-11 w-full border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </div>
      <div class="flex items-end gap-3 xl:col-span-4">
        <button
          type="submit"
          data-audit-apply
          class="min-h-11 border border-zinc-950 px-5 font-sans text-sm font-semibold dark:border-zinc-100">
          {{ t("admin.audit.apply") }}
        </button>
        <button
          type="button"
          data-audit-reset
          class="min-h-11 px-3 font-sans text-sm text-zinc-500 underline"
          @click="resetFilters">
          {{ t("admin.audit.reset") }}
        </button>
        <p v-if="summary" class="ml-auto font-sans text-sm text-zinc-500" data-audit-summary>
          {{ t("admin.audit.summaryTotal", { total: summary.total }) }}
        </p>
      </div>
    </form>

    <p
      v-if="rateLimitRetryAfter !== null"
      role="alert"
      data-audit-rate-limited
      class="mb-5 border border-amber-300 bg-amber-50 p-4 font-sans text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {{ t("admin.audit.rateLimited", { retryAfter: rateLimitRetryAfter }) }}
      <span class="font-mono">RATE_LIMITED</span>
    </p>
    <p v-if="exportedFile" data-audit-exported class="mb-5 font-sans text-sm text-zinc-600 dark:text-zinc-300">
      {{ t("admin.audit.exported", { filename: exportedFile.filename, rows: exportedFile.rows }) }}
    </p>

    <div
      v-if="failed"
      role="alert"
      data-audit-error
      class="mb-5 border border-red-300 bg-red-50 p-4 font-sans text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {{ t("admin.audit.error") }}
      <span v-if="requestId" class="font-mono">requestId: {{ requestId }}</span>
    </div>

    <!-- Карточка записи живёт рядом со списком: прямая ссылка `?id=` открывает её при любом состоянии списка. -->
    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div v-if="pending && !entries.length" aria-busy="true" data-audit-loading class="grid gap-2">
        <div v-for="index in 5" :key="index" class="h-14 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <div v-else-if="!entries.length && !failed" data-audit-empty class="p-12 text-center">
        <p class="font-serif text-2xl text-zinc-950 dark:text-zinc-50">{{ t("admin.audit.empty") }}</p>
      </div>

      <div v-else class="grid gap-2" :aria-busy="pending">
        <article
          v-for="item in entries"
          :key="item.id"
          :data-audit-row="item.id"
          class="grid gap-1 border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <button type="button" class="text-left" :data-audit-open="item.id" @click="openDetail(item.id)">
            <span class="font-mono text-xs text-zinc-500">{{ formatDate(item.createdAt) }}</span>
            <span class="ml-3 font-mono text-sm text-orange-700 dark:text-orange-400">{{ item.action }}</span>
            <span class="mt-1 block font-sans text-sm text-zinc-700 dark:text-zinc-200">
              {{
                item.actor.isSystem
                  ? t("admin.audit.systemActor")
                  : `${item.actor.name ?? item.actor.id} · ${t(`admin.roles.${item.actor.role}`)}`
              }}
            </span>
            <span class="mt-1 block font-sans text-xs text-zinc-500">
              {{ item.entityType }} · {{ item.entityId }}
              <template v-if="item.changedFields.length">· {{ item.changedFields.join(", ") }}</template>
            </span>
          </button>
        </article>
        <button
          v-if="page?.nextCursor"
          type="button"
          data-audit-more
          class="min-h-11 border border-zinc-300 px-4 font-sans text-sm dark:border-zinc-700"
          @click="loadMore(currentFilters())">
          {{ t("admin.audit.more") }}
        </button>
      </div>

      <aside
        v-if="entry"
        data-audit-detail
        class="border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="font-mono text-sm text-orange-700 dark:text-orange-400">{{ entry.action }}</p>
            <p class="font-mono text-xs text-zinc-500">{{ formatDate(entry.createdAt) }}</p>
          </div>
          <button type="button" data-audit-detail-close class="font-sans text-sm text-zinc-500" @click="closeDetail">
            {{ t("common.close") }}
          </button>
        </div>
        <dl class="mt-4 grid gap-3 font-sans text-sm">
          <div>
            <dt class="text-xs text-zinc-500">{{ t("admin.audit.actor") }}</dt>
            <dd>
              {{
                entry.actor.isSystem
                  ? t("admin.audit.systemActor")
                  : `${entry.actor.name ?? entry.actor.id} · ${t(`admin.roles.${entry.actor.role}`)}`
              }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">{{ t("admin.audit.entity") }}</dt>
            <dd>
              <NuxtLink v-if="entityLink" :to="entityLink" data-audit-entity-link class="underline">
                {{ entry.entityType }} · {{ entry.entityId }}
              </NuxtLink>
              <span v-else>{{ entry.entityType }} · {{ entry.entityId }}</span>
            </dd>
          </div>
          <div v-if="entry.subject">
            <dt class="text-xs text-zinc-500">{{ t("admin.audit.subject") }}</dt>
            <dd data-audit-detail-subject>{{ entry.subject }}</dd>
          </div>
          <div v-if="entry.context">
            <dt class="text-xs text-zinc-500">{{ t("admin.audit.context") }}</dt>
            <dd>{{ entry.context }}</dd>
          </div>
          <div v-if="entry.purpose">
            <dt class="text-xs text-zinc-500">{{ t("admin.audit.purpose") }}</dt>
            <dd>{{ entry.purpose }}</dd>
          </div>
          <div v-if="diffRows.length">
            <dt class="text-xs text-zinc-500">{{ t("admin.audit.diff") }}</dt>
            <dd class="grid gap-1" data-audit-detail-diff>
              <span v-for="diffRow in diffRows" :key="diffRow.field" class="font-mono text-xs">
                {{ diffRow.field }}: {{ diffRow.value }}
              </span>
            </dd>
          </div>
          <div v-if="entry.requestId">
            <dt class="text-xs text-zinc-500">requestId</dt>
            <dd class="font-mono text-xs">{{ entry.requestId }}</dd>
          </div>
          <div>
            <dt class="text-xs text-zinc-500">{{ t("admin.audit.recordedAt") }}</dt>
            <dd class="font-mono text-xs">{{ entry.createdAt }}</dd>
          </div>
        </dl>
      </aside>
    </div>

    <div
      v-if="exportConfirmOpen"
      role="dialog"
      aria-modal="true"
      data-audit-export-confirm
      class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4">
      <div class="max-w-md bg-white p-6 dark:bg-zinc-900">
        <h2 class="font-serif text-2xl text-zinc-950 dark:text-zinc-50">{{ t("admin.audit.exportConfirmTitle") }}</h2>
        <p class="mt-3 font-sans text-sm text-zinc-600 dark:text-zinc-300">{{ t("admin.audit.exportConfirmText") }}</p>
        <div class="mt-5 flex gap-3">
          <button
            type="button"
            data-audit-export-cancel
            class="min-h-11 px-4 font-sans text-sm text-zinc-500 underline"
            @click="exportConfirmOpen = false">
            {{ t("common.cancel") }}
          </button>
          <button
            type="button"
            data-audit-export-confirm-button
            class="min-h-11 bg-zinc-950 px-5 font-sans text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950"
            @click="confirmExport">
            {{ t("admin.audit.exportConfirmAction") }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
