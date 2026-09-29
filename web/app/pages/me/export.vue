<script setup lang="ts">
  import {
    DownloadAccountExportDocument,
    GetMyAccountExportsDocument,
    RequestAccountExportDocument,
    type AccountExportFieldsFragment,
    type AccountExportScope
  } from "~/graphql/generated/graphql"

  definePageMeta({ i18n: false, layout: "auth", requiresAuth: true })

  interface GraphQLErrorLike {
    extensions?: Record<string, unknown> | null
  }
  interface GraphQLEnvelope<T> {
    data?: T | null
    errors?: readonly GraphQLErrorLike[]
  }

  type PageState = "loading" | "data_error" | "ready"
  const allScopes: AccountExportScope[] = ["profile", "articles", "media", "review"]
  const { t, locale } = useI18n()

  useHead({
    title: () => `${t("account.export.pageTitle")} — Altera`,
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })

  const extension = (errors: readonly GraphQLErrorLike[] | undefined, key: string) => errors?.[0]?.extensions?.[key]

  const leaveOnAccessFailure = async (errors: readonly GraphQLErrorLike[] | undefined): Promise<boolean> => {
    const code = extension(errors, "code")
    if (code === "FORBIDDEN") {
      await navigateTo("/me/archived", { replace: true, redirectCode: 302 })
      return true
    }
    if (code === "UNAUTHENTICATED") {
      await navigateTo({ path: "/login", query: { next: "/me/export" } }, { replace: true, redirectCode: 302 })
      return true
    }
    return false
  }

  const fetchExports = async (): Promise<AccountExportFieldsFragment[]> => {
    const envelope = (await useGraphQL(GetMyAccountExportsDocument)) as GraphQLEnvelope<{
      me: { id: string; exports: AccountExportFieldsFragment[] } | null
    }>
    if (!envelope.data?.me) {
      if (await leaveOnAccessFailure(envelope.errors)) return []
      throw createError({ statusCode: 500, statusMessage: "account-export" })
    }
    return envelope.data.me.exports
  }

  const { data, error, status, refresh } = await useAsyncData("my-account-exports", fetchExports, { server: false })
  const exportsList = ref<AccountExportFieldsFragment[] | null>(null)
  watch(data, (next) => (exportsList.value = next ?? exportsList.value), { immediate: true })

  const pageState = computed<PageState>(() => {
    if (error.value) return "data_error"
    if (!exportsList.value || status.value === "pending") return "loading"
    return "ready"
  })
  const hasActive = computed(() => exportsList.value?.some((item) => ["queued", "running"].includes(item.status)))
  const busy = ref(false)
  const notice = ref<string | null>(null)

  let refreshTimer: ReturnType<typeof setInterval> | null = null
  onMounted(() => {
    if (import.meta.env.MODE !== "test") refreshTimer = setInterval(() => hasActive.value && void refresh(), 5_000)
  })
  onUnmounted(() => {
    if (refreshTimer) clearInterval(refreshTimer)
  })

  const requestExport = async () => {
    if (busy.value || hasActive.value) return
    busy.value = true
    notice.value = null
    try {
      const envelope = (await useGraphQL(RequestAccountExportDocument, { scope: allScopes })) as GraphQLEnvelope<{
        requestExport: AccountExportFieldsFragment
      }>
      if (envelope.data) {
        exportsList.value = [envelope.data.requestExport, ...(exportsList.value ?? [])]
        notice.value = t("account.export.requested")
        return
      }
      if (await leaveOnAccessFailure(envelope.errors)) return
      const code = extension(envelope.errors, "code")
      if (code === "RATE_LIMITED") {
        const seconds = Number(extension(envelope.errors, "retryAfter"))
        notice.value = t("account.export.rateLimited", { minutes: Math.max(1, Math.ceil(seconds / 60)) })
      } else if (code === "CONFLICT") {
        notice.value = t("account.export.conflict")
      } else {
        notice.value = t("account.export.error.action", {
          requestId: String(extension(envelope.errors, "requestId") ?? "—")
        })
      }
    } catch {
      notice.value = t("account.export.error.action", { requestId: "—" })
    } finally {
      busy.value = false
    }
  }

  const download = async (id: string) => {
    if (busy.value) return
    busy.value = true
    notice.value = null
    try {
      const envelope = (await useGraphQL(DownloadAccountExportDocument, { id })) as GraphQLEnvelope<{
        exportDownload: string
      }>
      if (envelope.data?.exportDownload) {
        await navigateTo(envelope.data.exportDownload, { external: true })
        return
      }
      if (await leaveOnAccessFailure(envelope.errors)) return
      notice.value =
        extension(envelope.errors, "code") === "NOT_FOUND"
          ? t("account.export.downloadExpired")
          : t("account.export.error.action", { requestId: String(extension(envelope.errors, "requestId") ?? "—") })
    } catch {
      notice.value = t("account.export.error.action", { requestId: "—" })
    } finally {
      busy.value = false
    }
  }

  const date = (value: string) =>
    new Intl.DateTimeFormat(locale.value === "en" ? "en-GB" : "ru-RU", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value))
  const size = (bytes: number | null) => (bytes === null ? "" : `${Math.max(1, Math.ceil(bytes / 1024))} KB`)
</script>

<template>
  <section class="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-16" :data-export-state="pageState">
    <div class="flex flex-col gap-3">
      <p class="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">
        {{ t("account.export.eyebrow") }}
      </p>
      <h1 class="font-serif text-4xl text-zinc-950 dark:text-zinc-50">{{ t("account.export.pageTitle") }}</h1>
      <p class="max-w-2xl font-sans text-base leading-7 text-zinc-600 dark:text-zinc-300">
        {{ t("account.export.intro") }}
      </p>
      <p class="font-sans text-sm text-zinc-500 dark:text-zinc-400">
        <NuxtLink class="underline underline-offset-4" to="/legal/privacy">{{ t("account.export.privacy") }}</NuxtLink>
        <span aria-hidden="true"> · </span>
        <NuxtLink class="underline underline-offset-4" to="/legal/license">{{ t("account.export.license") }}</NuxtLink>
      </p>
    </div>

    <div v-if="pageState === 'loading'" data-testid="export-skeleton" class="grid gap-3" aria-busy="true">
      <span v-for="index in 3" :key="index" class="h-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
    </div>

    <div v-else-if="pageState === 'data_error'" role="alert" class="flex flex-col gap-3">
      <p>{{ t("account.export.error.dataUnavailable") }}</p>
      <button data-testid="export-retry" class="self-start border-b border-zinc-500" type="button" @click="refresh()">
        {{ t("account.export.retry") }}
      </button>
    </div>

    <template v-else>
      <section class="rounded border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 class="font-serif text-2xl">{{ t("account.export.includesTitle") }}</h2>
        <ul class="mt-4 grid gap-2 font-sans text-sm text-zinc-600 dark:text-zinc-300">
          <li v-for="scope in allScopes" :key="scope">{{ t(`account.export.scope.${scope}`) }}</li>
        </ul>
        <button
          type="button"
          data-testid="export-request"
          class="mt-6 w-full rounded bg-orange-700 px-5 py-3 font-sans font-semibold text-white disabled:opacity-50 sm:w-auto"
          :disabled="busy || hasActive"
          @click="requestExport">
          {{ busy ? t("account.export.requesting") : t("account.export.request") }}
        </button>
      </section>

      <p v-if="notice" data-testid="export-notice" role="status" class="font-sans text-sm text-orange-800">
        {{ notice }}
      </p>

      <section class="flex flex-col gap-4">
        <div class="flex items-baseline justify-between gap-4">
          <h2 class="font-serif text-2xl">{{ t("account.export.history") }}</h2>
          <button v-if="hasActive" type="button" class="text-sm underline" @click="refresh()">
            {{ t("account.export.update") }}
          </button>
        </div>
        <p v-if="exportsList?.length === 0" data-testid="export-empty" class="text-zinc-500">
          {{ t("account.export.empty") }}
        </p>
        <article
          v-for="item in exportsList"
          v-else
          :key="item.id"
          :data-export-status="item.status"
          class="grid gap-3 border-t border-zinc-200 py-5 sm:grid-cols-[1fr_auto] sm:items-center dark:border-zinc-800">
          <div>
            <p class="font-sans font-semibold">{{ t(`account.export.status.${item.status}`) }}</p>
            <p class="mt-1 text-sm text-zinc-500">{{ date(item.requestedAt) }}</p>
            <p v-if="item.status === 'ready' && item.expiresAt" class="mt-1 text-sm text-zinc-500">
              {{ t("account.export.expiresAt", { date: date(item.expiresAt) }) }} · {{ size(item.sizeBytes) }}
            </p>
          </div>
          <button
            v-if="item.status === 'ready'"
            type="button"
            data-testid="export-download"
            class="rounded border border-zinc-900 px-4 py-2 text-sm dark:border-zinc-100"
            :disabled="busy"
            @click="download(item.id)">
            {{ t("account.export.download") }}
          </button>
          <button
            v-else-if="item.status === 'failed' || item.status === 'expired'"
            type="button"
            class="text-left text-sm underline sm:text-right"
            :disabled="busy || hasActive"
            @click="requestExport">
            {{ t("account.export.requestAgain") }}
          </button>
        </article>
      </section>
    </template>
  </section>
</template>
