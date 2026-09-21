<script setup lang="ts">
  import { computed, onMounted, ref } from "vue"
  import type { AdminLegalVersionDetail } from "~/composables/useAdminLegal"
  import {
    adminLegalPath,
    diffLegalLines,
    parseLegalKind,
    parseLegalLocale,
    parseLegalVersion
  } from "~/utils/legalTexts"
  import { canPublishLegalTexts } from "~/utils/admin"

  const { t } = useI18n()
  const route = useRoute()
  const { summary } = useAdminDashboard()
  const { loading, failed, requestId, saving, failure, loadVersion, publish } = useAdminLegal()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-legal"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const kind = parseLegalKind(route.params.kind)
  const version = parseLegalVersion(route.params.version)
  if (!kind || !version) throw createError({ statusCode: 404, statusMessage: "Unknown legal text version" })
  const locale = parseLegalLocale(route.query.locale)

  const detail = ref<AdminLegalVersionDetail | null>(null)
  const missing = ref(false)
  const tab = ref<"preview" | "compare">("preview")

  // Публикация (§7): несущественная — одно окно с описанием; существенная — два шага с diff и
  // числом затронутых пользователей.
  const dialog = ref<"closed" | "options" | "material">("closed")
  const isMaterial = ref(false)

  const canPublish = computed(() => (summary.value ? canPublishLegalTexts(summary.value.role) : false))
  const diff = computed(() =>
    detail.value?.current ? diffLegalLines(detail.value.current.body, detail.value.body) : []
  )
  const changedLines = computed(() => diff.value.filter((line) => line.kind !== "same").length)

  const load = async () => {
    const loaded = await loadVersion(kind, locale, version)
    if (loaded === undefined) return
    missing.value = loaded === null
    detail.value = loaded
  }

  const openPublish = () => {
    isMaterial.value = false
    failure.value = null
    dialog.value = "options"
  }

  const confirm = async () => {
    if (!detail.value) return
    if (isMaterial.value && dialog.value === "options") {
      dialog.value = "material"
      return
    }
    const published = await publish({
      kind,
      locale,
      version: detail.value.version,
      isMaterial: isMaterial.value,
      draftUpdatedAt: detail.value.updatedAt
    })
    if (!published) return
    dialog.value = "closed"
    await navigateTo({ path: adminLegalPath(kind, published.version), query: { locale } })
    if (published.version === version) await load()
  }

  const formatDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—"

  onMounted(load)
</script>

<template>
  <section
    class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="legal-version-title">
    <NuxtLink
      :to="{ path: adminLegalPath(kind), query: { locale } }"
      class="mb-4 inline-block font-sans text-sm text-zinc-500 underline underline-offset-4">
      {{ t(`admin.legalTexts.kinds.${kind}`) }}
    </NuxtLink>

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

    <div v-if="loading && !detail" aria-busy="true" data-legal-loading class="grid max-w-3xl gap-3">
      <div class="h-10 w-1/2 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      <div v-for="index in 4" :key="index" class="h-5 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>

    <p v-else-if="missing" data-legal-missing class="max-w-3xl bg-white p-6 font-sans text-sm dark:bg-zinc-900">
      {{ t("admin.legalTexts.versionMissing") }}
    </p>

    <article v-else-if="detail && !failed" class="max-w-4xl" :data-legal-detail-status="detail.status">
      <header class="mb-6">
        <h1 id="legal-version-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">
          {{ t("admin.legalTexts.versionTitle", { version: detail.version }) }}
          <span class="font-sans text-base text-zinc-500">· {{ t(`admin.legalTexts.locales.${detail.locale}`) }}</span>
        </h1>
        <dl class="mt-3 grid gap-1 font-sans text-sm text-zinc-700 dark:text-zinc-200">
          <div class="flex gap-2">
            <dt class="text-zinc-500">{{ t("admin.legalTexts.columns.status") }}:</dt>
            <dd data-legal-detail-status-label>{{ t(`admin.legalTexts.statuses.${detail.status}`) }}</dd>
          </div>
          <div v-if="detail.publishedAt" class="flex gap-2">
            <dt class="text-zinc-500">{{ t("admin.legalTexts.columns.publishedAt") }}:</dt>
            <dd>
              {{ formatDate(detail.publishedAt) }}
              <template v-if="detail.publishedByRole">· {{ t(`admin.roles.${detail.publishedByRole}`) }}</template>
            </dd>
          </div>
          <div class="flex gap-2">
            <dt class="text-zinc-500">{{ t("admin.legalTexts.columns.summary") }}:</dt>
            <dd data-legal-detail-summary>{{ detail.summaryOfChanges }}</dd>
          </div>
          <div v-if="detail.status !== 'draft'" class="flex gap-2">
            <dt class="text-zinc-500">{{ t("admin.legalTexts.columns.material") }}:</dt>
            <dd>{{ detail.isMaterial ? t("admin.legalTexts.material") : t("admin.legalTexts.minor") }}</dd>
          </div>
          <div v-if="detail.status !== 'draft'" class="flex gap-2" data-legal-consent-count>
            <dt class="text-zinc-500">{{ t("admin.legalTexts.columns.consents") }}:</dt>
            <dd class="font-mono">{{ detail.consentCount }}</dd>
          </div>
          <div v-if="detail.pendingConsentCount !== null" class="flex gap-2" data-legal-pending>
            <dt class="text-zinc-500">{{ t("admin.legalTexts.pending") }}:</dt>
            <dd class="font-mono">{{ detail.pendingConsentCount }}</dd>
          </div>
        </dl>

        <p
          v-if="detail.status === 'draft' && !canPublish"
          data-legal-permission
          class="mt-4 font-sans text-sm text-zinc-500">
          {{ t("admin.legalTexts.adminNote") }}
        </p>
        <div v-if="detail.status === 'draft' && canPublish" class="mt-5 hidden gap-3 lg:flex">
          <NuxtLink
            :to="{ path: adminLegalPath(kind), query: { locale } }"
            data-legal-edit
            class="inline-flex min-h-11 items-center px-4 font-sans text-sm font-semibold underline underline-offset-4">
            {{ t("admin.legalTexts.edit") }}
          </NuxtLink>
          <button
            type="button"
            data-legal-publish
            class="min-h-11 bg-zinc-950 px-5 font-sans text-sm font-semibold text-white dark:bg-zinc-50 dark:text-zinc-950"
            @click="openPublish">
            {{ t("admin.legalTexts.publish") }}
          </button>
        </div>
        <p v-if="detail.status === 'draft' && canPublish" class="mt-4 font-sans text-sm text-zinc-500 lg:hidden">
          {{ t("admin.legalTexts.mobileNote") }}
        </p>
      </header>

      <div class="mb-4 flex gap-1" role="tablist">
        <button
          v-for="value in ['preview', 'compare'] as const"
          :key="value"
          type="button"
          role="tab"
          :aria-selected="tab === value"
          :data-legal-tab="value"
          class="min-h-11 border-b-2 px-4 font-sans text-sm font-semibold"
          :class="
            tab === value ? 'border-orange-600 text-zinc-950 dark:text-white' : 'border-transparent text-zinc-500'
          "
          @click="tab = value">
          {{ t(`admin.legalTexts.tabs.${value}`) }}
        </button>
      </div>

      <!-- Текст прошёл серверную проверку статической разметки (`assertSafeLegalHtml`). -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div
        v-if="tab === 'preview'"
        class="legal-body bg-white p-6 dark:bg-zinc-900"
        data-legal-preview
        v-html="detail.body" />

      <div v-else data-legal-compare class="bg-white p-6 font-mono text-xs dark:bg-zinc-900">
        <p v-if="!detail.current" data-legal-compare-none class="font-sans text-sm text-zinc-500">
          {{ t("admin.legalTexts.compareNone") }}
        </p>
        <template v-else>
          <p class="mb-3 font-sans text-sm text-zinc-500">
            {{ t("admin.legalTexts.compareWith", { version: detail.current.version }) }}
          </p>
          <div
            v-for="(line, index) in diff"
            :key="index"
            :data-diff="line.kind"
            class="whitespace-pre-wrap break-words px-2 py-0.5"
            :class="{
              'bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100': line.kind === 'added',
              'bg-red-50 text-red-900 line-through dark:bg-red-950 dark:text-red-100': line.kind === 'removed',
              'text-zinc-500': line.kind === 'same'
            }">
            {{ line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  " }}{{ line.text }}
          </div>
        </template>
      </div>
    </article>

    <div
      v-if="dialog !== 'closed' && detail"
      class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4"
      @click.self="dialog = 'closed'">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-publish-title"
        :data-legal-dialog="dialog"
        class="w-full max-w-lg bg-white p-6 font-sans text-sm text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
        <h2 id="legal-publish-title" class="mb-3 font-serif text-xl">
          {{ t("admin.legalTexts.publishTitle", { version: detail.version }) }}
        </h2>
        <template v-if="dialog === 'options'">
          <p class="mb-3">{{ t("admin.legalTexts.publishSummary", { summary: detail.summaryOfChanges }) }}</p>
          <label class="mb-4 flex items-start gap-2">
            <input v-model="isMaterial" type="checkbox" data-legal-material class="mt-1" />
            <span>{{ t("admin.legalTexts.materialLabel") }}</span>
          </label>
        </template>
        <template v-else>
          <p class="mb-2" data-legal-affected>
            {{
              detail.requiresConsent
                ? t("admin.legalTexts.materialAffected", { count: detail.affectedUsers ?? 0 })
                : t("admin.legalTexts.materialNoConsent")
            }}
          </p>
          <p class="mb-4 text-zinc-500">
            {{
              detail.current
                ? t("admin.legalTexts.materialDiff", { count: changedLines, version: detail.current.version })
                : t("admin.legalTexts.compareNone")
            }}
          </p>
        </template>
        <div
          v-if="failure"
          role="alert"
          data-legal-publish-error
          :data-legal-failure="failure.code ?? 'unknown'"
          class="mb-4 bg-red-50 p-3 text-red-800 dark:bg-red-950 dark:text-red-200">
          <p v-if="failure.code === 'CONFLICT'">{{ t("admin.legalTexts.conflict") }}</p>
          <p v-else>
            {{ t("admin.legalTexts.publishError") }}
            <span v-if="failure.requestId" class="font-mono">requestId: {{ failure.requestId }}</span>
          </p>
          <button
            v-if="failure.code === 'CONFLICT'"
            type="button"
            class="mt-2 font-semibold underline"
            @click="((dialog = 'closed'), load())">
            {{ t("admin.legalTexts.reload") }}
          </button>
        </div>
        <div class="flex justify-end gap-3">
          <button type="button" class="min-h-11 px-4 font-semibold" @click="dialog = 'closed'">
            {{ t("admin.legalTexts.cancel") }}
          </button>
          <button
            type="button"
            data-legal-confirm
            :disabled="saving"
            class="min-h-11 bg-zinc-950 px-5 font-semibold text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950"
            @click="confirm">
            {{ isMaterial && dialog === "options" ? t("admin.legalTexts.next") : t("admin.legalTexts.confirmPublish") }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
  .legal-body {
    font-family: var(--font-serif, serif);
    line-height: 1.7;
  }

  .legal-body :deep(h2) {
    margin: 1.75rem 0 0.75rem;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .legal-body :deep(h2:first-child) {
    margin-top: 0;
  }

  .legal-body :deep(p),
  .legal-body :deep(ul),
  .legal-body :deep(ol) {
    margin: 0 0 0.75rem;
  }
</style>
