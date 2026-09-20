<script setup lang="ts">
  import { computed, ref } from "vue"
  import type { AdminMailRow } from "~/composables/useAdminMail"

  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const { summary } = useAdminDashboard()
  const {
    items,
    providerWaiting,
    pagination,
    pending,
    failed,
    requestId,
    errorCode,
    period,
    page,
    refresh,
    resendMany
  } = useAdminMailList()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  /** Максимум писем в массовом повторе (`docs/spec/40-admin/mail.md` §6). */
  const BULK_RESEND_LIMIT = 100
  const statuses = ["queued", "sent", "bounced", "failed"] as const

  const canResend = computed(() => summary.value?.role === "owner")
  const selected = ref(new Set<string>())
  const confirmOpen = ref(false)
  const limitExceeded = ref(false)
  const resentCount = ref<number | null>(null)

  const selectedRows = computed(() => items.value.filter((mail) => selected.value.has(mail.id)))
  const selectedTemplates = computed(() => [...new Set(selectedRows.value.map((mail) => mail.template))].join(", "))
  const showLimit = computed(() => limitExceeded.value || errorCode.value === "VALIDATION_ERROR")
  const showConflict = computed(() => errorCode.value === "CONFLICT")

  const setQuery = (patch: Record<string, string | undefined>) => {
    const query: Record<string, string> = { ...(route.query as Record<string, string>) }
    for (const [key, value] of Object.entries(patch)) {
      if (value) query[key] = value
      else delete query[key]
    }
    delete query.page
    return router.replace({ query })
  }

  const onFilter = (key: string, event: Event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement
    return setQuery({ [key]: target.value })
  }

  const toggle = (mail: AdminMailRow) => {
    const next = new Set(selected.value)
    if (next.has(mail.id)) next.delete(mail.id)
    else next.add(mail.id)
    selected.value = next
  }

  const openConfirm = () => {
    limitExceeded.value = selected.value.size > BULK_RESEND_LIMIT
    resentCount.value = null
    confirmOpen.value = !limitExceeded.value
  }

  const submitBulk = async () => {
    const result = await resendMany([...selected.value])
    confirmOpen.value = false
    if (result) {
      resentCount.value = result.resendMails.resent
      selected.value = new Set()
      await refresh()
    }
  }

  const goToPage = (next: number) => router.replace({ query: { ...route.query, page: String(next) } })

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })
</script>

<template>
  <section
    class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="mail-title">
    <header class="mb-7 border-b border-zinc-300 pb-5 dark:border-zinc-700">
      <h1 id="mail-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50 sm:text-4xl">
        {{ t("admin.mail.title") }}
      </h1>
      <p class="mt-2 max-w-2xl font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.mail.description") }}
      </p>
    </header>

    <p
      v-if="providerWaiting"
      data-mail-provider-waiting
      class="mb-5 border border-amber-300 bg-amber-50 px-4 py-3 font-sans text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {{ t("admin.mail.providerWaiting") }}
    </p>

    <div class="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div class="flex flex-col gap-1">
        <label class="font-sans text-xs text-zinc-500" for="mail-template">{{ t("admin.mail.filterTemplate") }}</label>
        <input
          id="mail-template"
          data-mail-filter="template"
          type="search"
          :value="route.query.template ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onFilter('template', $event)" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="font-sans text-xs text-zinc-500" for="mail-status">{{ t("admin.mail.filterStatus") }}</label>
        <select
          id="mail-status"
          data-mail-filter="status"
          :value="route.query.status ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onFilter('status', $event)">
          <option value="">{{ t("admin.mail.allStatuses") }}</option>
          <option v-for="value in statuses" :key="value" :value="value">
            {{ t(`admin.mail.status.${value}`) }}
          </option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="font-sans text-xs text-zinc-500" for="mail-period">{{ t("admin.mail.filterPeriod") }}</label>
        <select
          id="mail-period"
          data-mail-filter="period"
          :value="period"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onFilter('period', $event)">
          <option value="7d">{{ t("admin.mail.period7") }}</option>
          <option value="30d">{{ t("admin.mail.period30") }}</option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="font-sans text-xs text-zinc-500" for="mail-recipient">
          {{ t("admin.mail.filterRecipient") }}
        </label>
        <input
          id="mail-recipient"
          data-mail-filter="recipient"
          type="search"
          :value="route.query.recipient ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onFilter('recipient', $event)" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="font-sans text-xs text-zinc-500" for="mail-query">{{ t("admin.mail.filterQuery") }}</label>
        <input
          id="mail-query"
          data-mail-filter="q"
          type="search"
          :value="route.query.q ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onFilter('q', $event)" />
      </div>
      <button
        v-if="canResend"
        type="button"
        data-mail-bulk-resend
        class="min-h-11 border border-zinc-950 px-4 font-sans text-sm font-semibold text-zinc-950 disabled:opacity-40 dark:border-zinc-100 dark:text-zinc-100"
        :disabled="selected.size === 0 || pending"
        @click="openConfirm">
        {{ t("admin.mail.resendSelected", { count: selected.size }) }}
      </button>
    </div>

    <p
      v-if="showLimit"
      data-mail-state="limit"
      role="alert"
      class="mb-5 border border-red-300 bg-red-50 px-4 py-3 font-sans text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      {{ t("admin.mail.limitExceeded", { limit: BULK_RESEND_LIMIT }) }}
    </p>
    <p
      v-else-if="showConflict"
      data-mail-state="conflict"
      role="alert"
      class="mb-5 border border-amber-300 bg-amber-50 px-4 py-3 font-sans text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {{ t("admin.mail.conflict") }}
    </p>
    <p v-else-if="resentCount !== null" data-mail-resent class="mb-5 font-sans text-sm text-zinc-600">
      {{ t("admin.mail.resendDone", { count: resentCount }) }}
    </p>

    <div v-if="pending" data-mail-state="loading" aria-busy="true" :aria-label="t('admin.mail.loading')">
      <span class="sr-only">{{ t("admin.mail.loading") }}</span>
      <div
        v-for="row in 5"
        :key="row"
        class="mb-2 h-11 animate-pulse bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800"></div>
    </div>

    <div
      v-else-if="failed"
      data-mail-state="error"
      role="alert"
      class="border border-red-300 bg-white px-4 py-8 text-center font-sans text-sm dark:border-red-900 dark:bg-zinc-900">
      <p class="text-zinc-900 dark:text-zinc-100">{{ t("admin.mail.loadError") }}</p>
      <p v-if="requestId" class="mt-2 font-mono text-xs text-zinc-500">requestId: {{ requestId }}</p>
      <button
        type="button"
        class="mt-4 min-h-11 border border-zinc-950 px-4 font-sans text-sm font-semibold dark:border-zinc-100"
        @click="refresh()">
        {{ t("admin.mail.retry") }}
      </button>
    </div>

    <p
      v-else-if="items.length === 0"
      data-mail-state="empty"
      class="border border-zinc-300 bg-white px-4 py-12 text-center font-sans text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      {{ t("admin.mail.empty") }}
    </p>

    <table v-else data-mail-table class="w-full border-collapse font-sans text-sm">
      <thead>
        <tr
          class="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700">
          <th v-if="canResend" scope="col" class="w-10 py-2"><span class="sr-only">—</span></th>
          <th scope="col" class="py-2">{{ t("admin.mail.columnTime") }}</th>
          <th scope="col" class="py-2">{{ t("admin.mail.columnTemplate") }}</th>
          <th scope="col" class="py-2">{{ t("admin.mail.columnRecipient") }}</th>
          <th scope="col" class="py-2">{{ t("admin.mail.columnSubject") }}</th>
          <th scope="col" class="py-2">{{ t("admin.mail.columnStatus") }}</th>
          <th scope="col" class="py-2">{{ t("admin.mail.columnProvider") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="mail in items"
          :key="mail.id"
          :data-mail-row="mail.id"
          :data-mail-status="mail.status"
          class="border-b border-zinc-200 dark:border-zinc-800">
          <td v-if="canResend" class="py-2">
            <input
              type="checkbox"
              :data-mail-select="mail.id"
              :aria-label="mail.subject"
              :checked="selected.has(mail.id)"
              @change="toggle(mail)" />
          </td>
          <td class="py-2 whitespace-nowrap">{{ formatDate(mail.createdAt) }}</td>
          <td class="py-2">{{ mail.template }}</td>
          <td data-mail-recipient class="py-2">
            {{ mail.recipientEmail ?? mail.recipientHandle ?? t("admin.mail.recipientHidden") }}
          </td>
          <td class="py-2">
            <NuxtLink :to="`/admin/mail/${mail.id}`" class="underline underline-offset-4">{{ mail.subject }}</NuxtLink>
          </td>
          <td class="py-2">{{ t(`admin.mail.status.${mail.status}`) }}</td>
          <td class="py-2">{{ mail.provider ?? "—" }}</td>
        </tr>
      </tbody>
    </table>

    <nav v-if="pagination && pagination.totalPages > 1" class="mt-5 flex items-center gap-3" aria-label="pagination">
      <button
        type="button"
        data-mail-prev
        class="min-h-11 border border-zinc-300 px-3 font-sans text-sm disabled:opacity-40 dark:border-zinc-700"
        :disabled="!pagination.hasPreviousPage"
        @click="goToPage(page - 1)">
        {{ t("admin.mail.previous") }}
      </button>
      <span class="font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.mail.pageOf", { page: pagination.currentPage, total: pagination.totalPages }) }}
      </span>
      <button
        type="button"
        data-mail-next
        class="min-h-11 border border-zinc-300 px-3 font-sans text-sm disabled:opacity-40 dark:border-zinc-700"
        :disabled="!pagination.hasNextPage"
        @click="goToPage(page + 1)">
        {{ t("admin.mail.next") }}
      </button>
    </nav>

    <div
      v-if="confirmOpen"
      data-mail-confirm
      role="dialog"
      aria-modal="true"
      :aria-label="t('admin.mail.confirmTitle')"
      class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
      <div class="w-full max-w-md bg-white p-6 dark:bg-zinc-900">
        <h2 class="font-serif text-xl text-zinc-950 dark:text-zinc-50">{{ t("admin.mail.confirmTitle") }}</h2>
        <p class="mt-3 font-sans text-sm text-zinc-600 dark:text-zinc-300">
          {{ t("admin.mail.confirmBody", { count: selected.size, templates: selectedTemplates }) }}
        </p>
        <p class="mt-2 font-sans text-sm text-zinc-600 dark:text-zinc-300">{{ t("admin.mail.confirmSecrets") }}</p>
        <div class="mt-5 flex gap-3">
          <button
            type="button"
            data-mail-confirm-cancel
            class="min-h-11 flex-1 border border-zinc-300 font-sans text-sm dark:border-zinc-700"
            @click="confirmOpen = false">
            {{ t("admin.mail.cancel") }}
          </button>
          <button
            type="button"
            data-mail-confirm-submit
            class="min-h-11 flex-1 border border-zinc-950 font-sans text-sm font-semibold dark:border-zinc-100"
            @click="submitBulk">
            {{ t("admin.mail.confirmSubmit") }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
