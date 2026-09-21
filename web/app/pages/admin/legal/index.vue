<script setup lang="ts">
  import { computed, onMounted, ref } from "vue"
  import type { LegalTextKind, LegalTextStatus, Locale } from "~/graphql/generated/graphql"
  import type { AdminLegalKind, AdminLegalVersionRow } from "~/composables/useAdminLegal"
  import {
    LEGAL_TEXT_KINDS,
    LEGAL_TEXT_LOCALES,
    LEGAL_TEXT_STATUSES,
    adminLegalPath,
    parseLegalKind,
    parseLegalLocale,
    parseLegalStatus
  } from "~/utils/legalTexts"
  import { canPublishLegalTexts } from "~/utils/admin"

  const { t } = useI18n()
  const route = useRoute()
  const { summary } = useAdminDashboard()
  const { loading, failed, requestId, loadKinds, loadVersions } = useAdminLegal()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-legal"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  // Фильтры §4 живут в URL: вид и статус — «все» по умолчанию, локаль — русская.
  const kind = ref<LegalTextKind | null>(parseLegalKind(route.query.kind))
  const locale = ref<Locale>(parseLegalLocale(route.query.locale))
  const status = ref<LegalTextStatus | null>(parseLegalStatus(route.query.status))

  const kinds = ref<AdminLegalKind[] | null>(null)
  const versions = ref<AdminLegalVersionRow[] | null>(null)

  const canPublish = computed(() => (summary.value ? canPublishLegalTexts(summary.value.role) : false))
  const shownKinds = computed(() => (kinds.value ?? []).filter((item) => !kind.value || item.kind === kind.value))
  const stateOf = (item: AdminLegalKind) => item.locales.find((state) => state.locale === locale.value)

  const load = async () => {
    const [loadedKinds, loadedVersions] = await Promise.all([
      loadKinds(),
      loadVersions({ kind: kind.value, locale: locale.value, status: status.value })
    ])
    if (loadedKinds && loadedVersions) {
      kinds.value = loadedKinds
      versions.value = loadedVersions
    }
  }

  const applyFilters = async () => {
    const query: Record<string, string> = { locale: locale.value }
    if (kind.value) query.kind = kind.value
    if (status.value) query.status = status.value
    await navigateTo({ path: "/admin/legal", query })
    await load()
  }

  const formatDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"

  onMounted(load)
</script>

<template>
  <section
    class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="legal-title">
    <header class="mb-7 pb-5">
      <p class="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-orange-700 dark:text-orange-400">
        {{ t("admin.legalTexts.eyebrow") }}
      </p>
      <h1 id="legal-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50 sm:text-4xl">
        {{ t("admin.legalTexts.title") }}
      </h1>
      <p class="mt-2 max-w-2xl font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.legalTexts.description") }}
      </p>
      <p data-legal-permission class="mt-3 max-w-2xl font-sans text-sm text-zinc-500 dark:text-zinc-400">
        {{ canPublish ? t("admin.legalTexts.ownerNote") : t("admin.legalTexts.adminNote") }}
      </p>
    </header>

    <form class="mb-6 flex flex-wrap items-end gap-3" data-legal-filters @submit.prevent="applyFilters">
      <label class="grid gap-1 font-sans text-xs text-zinc-500">
        {{ t("admin.legalTexts.filters.kind") }}
        <select
          v-model="kind"
          data-legal-filter="kind"
          class="min-h-10 bg-white px-3 text-sm text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
          @change="applyFilters">
          <option :value="null">{{ t("admin.legalTexts.filters.all") }}</option>
          <option v-for="value in LEGAL_TEXT_KINDS" :key="value" :value="value">
            {{ t(`admin.legalTexts.kinds.${value}`) }}
          </option>
        </select>
      </label>
      <label class="grid gap-1 font-sans text-xs text-zinc-500">
        {{ t("admin.legalTexts.filters.locale") }}
        <select
          v-model="locale"
          data-legal-filter="locale"
          class="min-h-10 bg-white px-3 text-sm text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
          @change="applyFilters">
          <option v-for="value in LEGAL_TEXT_LOCALES" :key="value" :value="value">
            {{ t(`admin.legalTexts.locales.${value}`) }}
          </option>
        </select>
      </label>
      <label class="grid gap-1 font-sans text-xs text-zinc-500">
        {{ t("admin.legalTexts.filters.status") }}
        <select
          v-model="status"
          data-legal-filter="status"
          class="min-h-10 bg-white px-3 text-sm text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
          @change="applyFilters">
          <option :value="null">{{ t("admin.legalTexts.filters.all") }}</option>
          <option v-for="value in LEGAL_TEXT_STATUSES" :key="value" :value="value">
            {{ t(`admin.legalTexts.statuses.${value}`) }}
          </option>
        </select>
      </label>
    </form>

    <div
      v-if="failed"
      role="alert"
      data-legal-error
      class="mb-5 max-w-3xl bg-red-50 p-4 font-sans text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
      <p>
        {{ t("admin.legalTexts.error") }}
        <span v-if="requestId" class="font-mono">requestId: {{ requestId }}</span>
      </p>
      <button type="button" class="mt-3 min-h-10 font-semibold underline" @click="load">
        {{ t("admin.legalTexts.retry") }}
      </button>
    </div>

    <div v-if="loading" aria-busy="true" data-legal-loading class="grid max-w-5xl gap-3">
      <div v-for="index in 4" :key="index" class="h-16 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>

    <template v-else-if="kinds && versions && !failed">
      <ul class="mb-10 grid max-w-5xl gap-2 sm:grid-cols-2 xl:grid-cols-3" data-legal-kinds>
        <li
          v-for="item in shownKinds"
          :key="item.kind"
          :data-legal-kind="item.kind"
          class="bg-white p-4 font-sans text-sm dark:bg-zinc-900">
          <NuxtLink
            :to="{ path: adminLegalPath(item.kind), query: { locale } }"
            class="font-semibold text-zinc-950 underline-offset-4 hover:underline dark:text-zinc-50">
            {{ t(`admin.legalTexts.kinds.${item.kind}`) }}
          </NuxtLink>
          <template v-if="stateOf(item)?.currentVersion">
            <p class="mt-2 text-zinc-700 dark:text-zinc-200" data-legal-current>
              {{ t("admin.legalTexts.currentLine", { version: stateOf(item)?.currentVersion }) }}
              · {{ formatDate(stateOf(item)?.publishedAt) }}
            </p>
            <p v-if="item.requiresConsent" class="mt-1 text-zinc-500" data-legal-consent>
              {{
                t("admin.legalTexts.consentShare", {
                  current: stateOf(item)?.usersWithCurrentConsent ?? 0,
                  total: stateOf(item)?.usersTotal ?? 0
                })
              }}
            </p>
          </template>
          <p v-else class="mt-2 text-zinc-500" data-legal-empty>{{ t("admin.legalTexts.notPublished") }}</p>
          <p v-if="stateOf(item)?.draftVersion" class="mt-1 text-orange-700 dark:text-orange-400" data-legal-draft>
            {{ t("admin.legalTexts.draftLine", { version: stateOf(item)?.draftVersion }) }}
          </p>
        </li>
      </ul>

      <h2 class="mb-3 font-serif text-xl text-zinc-950 dark:text-zinc-50">{{ t("admin.legalTexts.versionsTitle") }}</h2>
      <div v-if="versions.length" class="max-w-5xl overflow-x-auto">
        <table class="w-full min-w-[40rem] font-sans text-sm" data-legal-versions>
          <thead class="text-left text-xs text-zinc-500">
            <tr>
              <th class="px-3 py-2 font-medium">{{ t("admin.legalTexts.columns.kind") }}</th>
              <th class="px-3 py-2 font-medium">{{ t("admin.legalTexts.columns.version") }}</th>
              <th class="px-3 py-2 font-medium">{{ t("admin.legalTexts.columns.status") }}</th>
              <th class="px-3 py-2 font-medium">{{ t("admin.legalTexts.columns.publishedAt") }}</th>
              <th class="px-3 py-2 font-medium">{{ t("admin.legalTexts.columns.summary") }}</th>
              <th class="px-3 py-2 font-medium">{{ t("admin.legalTexts.columns.consents") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in versions"
              :key="row.id"
              :data-legal-version="`${row.kind}-${row.version}`"
              :data-legal-status="row.status"
              class="bg-white dark:bg-zinc-900">
              <td class="px-3 py-3">{{ t(`admin.legalTexts.kinds.${row.kind}`) }}</td>
              <td class="px-3 py-3">
                <NuxtLink
                  :to="{ path: adminLegalPath(row.kind, row.version), query: { locale: row.locale } }"
                  class="font-mono font-semibold underline underline-offset-4">
                  v{{ row.version }}
                </NuxtLink>
              </td>
              <td class="px-3 py-3">
                {{ t(`admin.legalTexts.statuses.${row.status}`) }}
                <span v-if="row.isMaterial" class="block text-xs text-orange-700 dark:text-orange-400">
                  {{ t("admin.legalTexts.material") }}
                </span>
              </td>
              <td class="px-3 py-3">{{ formatDate(row.publishedAt) }}</td>
              <td class="px-3 py-3 text-zinc-600 dark:text-zinc-300">{{ row.summaryOfChanges }}</td>
              <td class="px-3 py-3 font-mono">{{ row.status === "draft" ? "—" : row.consentCount }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p
        v-else
        data-legal-versions-empty
        class="max-w-5xl bg-white p-6 font-sans text-sm text-zinc-600 dark:bg-zinc-900">
        {{ t("admin.legalTexts.versionsEmpty") }}
      </p>
    </template>
  </section>
</template>
