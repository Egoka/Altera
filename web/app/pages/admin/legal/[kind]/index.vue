<script setup lang="ts">
  import { computed, onMounted, ref } from "vue"
  import type { Locale } from "~/graphql/generated/graphql"
  import type { AdminLegalVersionRow } from "~/composables/useAdminLegal"
  import {
    LEGAL_TEXT_LOCALES,
    PAID_LEGAL_KINDS,
    adminLegalPath,
    parseLegalKind,
    parseLegalLocale
  } from "~/utils/legalTexts"
  import { canPublishLegalTexts } from "~/utils/admin"

  const { t } = useI18n()
  const route = useRoute()
  const { summary } = useAdminDashboard()
  const { loading, failed, requestId, saving, failure, loadVersions, loadVersion, saveDraft } = useAdminLegal()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-legal"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const kind = parseLegalKind(route.params.kind)
  if (!kind) throw createError({ statusCode: 404, statusMessage: "Unknown legal text kind" })

  const locale = ref<Locale>(parseLegalLocale(route.query.locale))
  const versions = ref<AdminLegalVersionRow[] | null>(null)
  const body = ref("")
  const summaryOfChanges = ref("")

  const canPublish = computed(() => (summary.value ? canPublishLegalTexts(summary.value.role) : false))
  const draft = computed(() => versions.value?.find((row) => row.status === "draft") ?? null)
  const current = computed(() => versions.value?.find((row) => row.status === "published") ?? null)
  const isPaid = PAID_LEGAL_KINDS.includes(kind)

  const load = async () => {
    const rows = await loadVersions({ kind, locale: locale.value })
    if (!rows) return
    versions.value = rows
    // Черновик открывается с его текстом; новый черновик — с текстом действующей версии.
    const source = draft.value ?? current.value
    const detail = source && canPublish.value ? await loadVersion(kind, locale.value, source.version) : null
    body.value = detail?.body ?? ""
    summaryOfChanges.value = draft.value ? (detail?.summaryOfChanges ?? "") : ""
  }

  const setLocale = async (value: Locale) => {
    locale.value = value
    await navigateTo({ path: adminLegalPath(kind), query: { locale: value } })
    await load()
  }

  const submit = async () => {
    const saved = await saveDraft({
      kind,
      locale: locale.value,
      body: body.value,
      summaryOfChanges: summaryOfChanges.value,
      draftUpdatedAt: draft.value?.updatedAt ?? null
    })
    if (saved) await navigateTo({ path: adminLegalPath(kind, saved.version), query: { locale: locale.value } })
  }

  const formatDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"

  onMounted(load)
</script>

<template>
  <section
    class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="legal-kind-title">
    <NuxtLink
      :to="{ path: '/admin/legal', query: { locale } }"
      class="mb-4 inline-block font-sans text-sm text-zinc-500 underline underline-offset-4">
      {{ t("admin.legalTexts.back") }}
    </NuxtLink>
    <header class="mb-6">
      <h1 id="legal-kind-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">
        {{ t(`admin.legalTexts.kinds.${kind}`) }}
      </h1>
      <p data-legal-permission class="mt-2 max-w-2xl font-sans text-sm text-zinc-500 dark:text-zinc-400">
        {{ canPublish ? t("admin.legalTexts.ownerNote") : t("admin.legalTexts.adminNote") }}
      </p>
      <p
        v-if="isPaid"
        data-legal-paid-notice
        class="mt-3 max-w-2xl bg-amber-50 p-3 font-sans text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        {{ t("admin.legalTexts.paidNotice") }}
      </p>
    </header>

    <div class="mb-6 flex gap-1" role="tablist">
      <button
        v-for="value in LEGAL_TEXT_LOCALES"
        :key="value"
        type="button"
        role="tab"
        :aria-selected="locale === value"
        :data-legal-locale="value"
        class="min-h-11 border-b-2 px-4 font-sans text-sm font-semibold"
        :class="
          locale === value ? 'border-orange-600 text-zinc-950 dark:text-white' : 'border-transparent text-zinc-500'
        "
        @click="setLocale(value)">
        {{ t(`admin.legalTexts.locales.${value}`) }}
      </button>
    </div>

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

    <div v-if="loading && !versions" aria-busy="true" data-legal-loading class="grid max-w-3xl gap-3">
      <div v-for="index in 3" :key="index" class="h-14 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>

    <template v-else-if="versions && !failed">
      <p v-if="!current" data-legal-empty class="mb-6 max-w-3xl bg-white p-4 font-sans text-sm dark:bg-zinc-900">
        {{ t("admin.legalTexts.notPublished") }}
      </p>
      <ol v-if="versions.length" class="mb-10 grid max-w-3xl gap-2" data-legal-kind-versions>
        <li
          v-for="row in versions"
          :key="row.id"
          :data-legal-version="row.version"
          :data-legal-status="row.status"
          class="flex flex-wrap items-baseline gap-x-3 bg-white p-4 font-sans text-sm dark:bg-zinc-900">
          <NuxtLink
            :to="{ path: adminLegalPath(kind, row.version), query: { locale } }"
            class="font-mono font-semibold underline underline-offset-4">
            v{{ row.version }}
          </NuxtLink>
          <span>{{ t(`admin.legalTexts.statuses.${row.status}`) }}</span>
          <span class="text-zinc-500">{{ formatDate(row.publishedAt) }}</span>
          <span v-if="row.isMaterial" class="text-orange-700 dark:text-orange-400">
            {{ t("admin.legalTexts.material") }}
          </span>
          <span class="basis-full text-zinc-600 dark:text-zinc-300">{{ row.summaryOfChanges }}</span>
        </li>
      </ol>

      <!-- Создание и публикация — десктоп (§10); на узком экране раздел только читается. -->
      <p v-if="canPublish" class="max-w-3xl font-sans text-sm text-zinc-500 lg:hidden" data-legal-mobile-note>
        {{ t("admin.legalTexts.mobileNote") }}
      </p>
      <form v-if="canPublish" class="hidden max-w-4xl gap-4 lg:grid" data-legal-draft-form @submit.prevent="submit">
        <h2 class="font-serif text-xl text-zinc-950 dark:text-zinc-50">
          {{ draft ? t("admin.legalTexts.editDraft", { version: draft.version }) : t("admin.legalTexts.newDraft") }}
        </h2>
        <label class="grid gap-1 font-sans text-sm text-zinc-700 dark:text-zinc-200">
          {{ t("admin.legalTexts.bodyLabel") }}
          <textarea
            v-model="body"
            data-legal-body
            rows="16"
            class="bg-white p-3 font-mono text-sm text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100" />
          <span class="text-xs text-zinc-500">{{ t("admin.legalTexts.bodyHint") }}</span>
        </label>
        <label class="grid gap-1 font-sans text-sm text-zinc-700 dark:text-zinc-200">
          {{ t("admin.legalTexts.summaryLabel") }}
          <input
            v-model="summaryOfChanges"
            data-legal-summary
            class="min-h-10 bg-white px-3 text-sm text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100" />
        </label>
        <div
          v-if="failure"
          role="alert"
          data-legal-save-error
          :data-legal-failure="failure.code ?? 'unknown'"
          class="bg-red-50 p-4 font-sans text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          <p v-if="failure.code === 'CONFLICT'">{{ t("admin.legalTexts.conflict") }}</p>
          <p v-else-if="failure.code === 'VALIDATION_ERROR'">
            {{ t(`admin.legalTexts.validation.${failure.field === "body" ? "body" : "summary"}`) }}
          </p>
          <p v-else>
            {{ t("admin.legalTexts.saveError") }}
            <span v-if="failure.requestId" class="font-mono">requestId: {{ failure.requestId }}</span>
          </p>
          <button
            v-if="failure.code === 'CONFLICT'"
            type="button"
            class="mt-3 min-h-10 font-semibold underline"
            @click="load">
            {{ t("admin.legalTexts.reload") }}
          </button>
        </div>
        <div>
          <button
            type="submit"
            data-legal-save
            :disabled="saving"
            class="min-h-11 bg-zinc-950 px-5 font-sans text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950">
            {{ t("admin.legalTexts.saveDraft") }}
          </button>
        </div>
      </form>
    </template>
  </section>
</template>
