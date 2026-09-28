<script setup lang="ts">
  import { computed } from "vue"
  import { SUPPORT_TOPICS, type AdminSupportRow } from "~/composables/useAdminSupport"

  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const { items, openCount, pagination, pending, failed, requestId, page, refresh, answer } = useAdminSupportQueue()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-support"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const statuses = ["received", "answered"] as const

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
    const target = event.target as HTMLSelectElement
    return setQuery({ [key]: target.value })
  }

  const goToPage = (next: number) => router.replace({ query: { ...route.query, page: String(next) } })

  const markAnswered = async (row: AdminSupportRow) => {
    const result = await answer(row.id)
    if (result) await refresh()
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })

  const openLabel = computed(() => t("admin.support.openCount", { count: openCount.value }))
</script>

<template>
  <section
    class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="support-title">
    <header class="mb-7 border-b border-zinc-300 pb-5 dark:border-zinc-700">
      <h1 id="support-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50 sm:text-4xl">
        {{ t("admin.support.title") }}
      </h1>
      <p class="mt-2 max-w-2xl font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.support.description") }}
      </p>
    </header>

    <p data-support-masked-note class="mb-5 font-sans text-sm text-zinc-600 dark:text-zinc-300">
      {{ t("admin.support.maskedNote") }}
    </p>

    <div class="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div class="flex flex-col gap-1">
        <label class="font-sans text-xs text-zinc-500" for="support-status">
          {{ t("admin.support.filterStatus") }}
        </label>
        <select
          id="support-status"
          data-support-filter="status"
          :value="route.query.status ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onFilter('status', $event)">
          <option value="">{{ t("admin.support.allStatuses") }}</option>
          <option v-for="value in statuses" :key="value" :value="value">
            {{ t(`admin.support.status.${value}`) }}
          </option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="font-sans text-xs text-zinc-500" for="support-topic">
          {{ t("admin.support.filterTopic") }}
        </label>
        <select
          id="support-topic"
          data-support-filter="topic"
          :value="route.query.topic ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onFilter('topic', $event)">
          <option value="">{{ t("admin.support.allTopics") }}</option>
          <option v-for="value in SUPPORT_TOPICS" :key="value" :value="value">
            {{ t(`admin.support.topic.${value}`) }}
          </option>
        </select>
      </div>
      <p data-support-open-count class="font-sans text-sm text-zinc-600 dark:text-zinc-300">{{ openLabel }}</p>
    </div>

    <div v-if="pending" data-support-state="loading" aria-busy="true" :aria-label="t('admin.support.loading')">
      <span class="sr-only">{{ t("admin.support.loading") }}</span>
      <div
        v-for="row in 5"
        :key="row"
        class="mb-2 h-11 animate-pulse bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800"></div>
    </div>

    <div
      v-else-if="failed"
      data-support-state="error"
      role="alert"
      class="border border-red-300 bg-white px-4 py-8 text-center font-sans text-sm dark:border-red-900 dark:bg-zinc-900">
      <p class="text-zinc-900 dark:text-zinc-100">{{ t("admin.support.loadError") }}</p>
      <p v-if="requestId" class="mt-2 font-mono text-xs text-zinc-500">requestId: {{ requestId }}</p>
      <button
        type="button"
        class="mt-4 min-h-11 border border-zinc-950 px-4 font-sans text-sm font-semibold dark:border-zinc-100"
        @click="refresh()">
        {{ t("admin.support.retry") }}
      </button>
    </div>

    <p
      v-else-if="items.length === 0"
      data-support-state="empty"
      class="border border-zinc-300 bg-white px-4 py-12 text-center font-sans text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      {{ t("admin.support.empty") }}
    </p>

    <table v-else data-support-table class="w-full border-collapse font-sans text-sm">
      <thead>
        <tr
          class="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700">
          <th scope="col" class="py-2">{{ t("admin.support.columnTicket") }}</th>
          <th scope="col" class="py-2">{{ t("admin.support.columnTime") }}</th>
          <th scope="col" class="py-2">{{ t("admin.support.columnTopic") }}</th>
          <th scope="col" class="py-2">{{ t("admin.support.columnEmail") }}</th>
          <th scope="col" class="py-2">{{ t("admin.support.columnPath") }}</th>
          <th scope="col" class="py-2">{{ t("admin.support.columnStatus") }}</th>
          <th scope="col" class="py-2">
            <span class="sr-only">{{ t("admin.support.columnAction") }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in items"
          :key="row.id"
          :data-support-row="row.id"
          :data-support-status="row.status"
          class="border-b border-zinc-200 dark:border-zinc-800">
          <td class="py-2">
            <NuxtLink :to="`/admin/support/${row.id}`" class="underline underline-offset-4">
              {{ t("admin.support.ticket", { ticketNo: row.ticketNo }) }}
            </NuxtLink>
          </td>
          <td class="py-2 whitespace-nowrap">{{ formatDate(row.createdAt) }}</td>
          <td class="py-2">{{ t(`admin.support.topic.${row.topic}`) }}</td>
          <td data-support-email class="py-2">{{ row.email ?? t("admin.support.emailAbsent") }}</td>
          <td class="py-2">{{ row.path ?? "—" }}</td>
          <td class="py-2">{{ t(`admin.support.status.${row.status}`) }}</td>
          <td class="py-2 text-right">
            <button
              v-if="row.status === 'received'"
              type="button"
              :data-support-answer="row.id"
              class="min-h-11 border border-zinc-950 px-3 font-sans text-sm font-semibold text-zinc-950 disabled:opacity-40 dark:border-zinc-100 dark:text-zinc-100"
              :disabled="pending"
              @click="markAnswered(row)">
              {{ t("admin.support.markAnswered") }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <nav v-if="pagination && pagination.totalPages > 1" class="mt-5 flex items-center gap-3" aria-label="pagination">
      <button
        type="button"
        data-support-prev
        class="min-h-11 border border-zinc-300 px-3 font-sans text-sm disabled:opacity-40 dark:border-zinc-700"
        :disabled="!pagination.hasPreviousPage"
        @click="goToPage(page - 1)">
        {{ t("admin.support.previous") }}
      </button>
      <span class="font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.support.pageOf", { page: pagination.currentPage, total: pagination.totalPages }) }}
      </span>
      <button
        type="button"
        data-support-next
        class="min-h-11 border border-zinc-300 px-3 font-sans text-sm disabled:opacity-40 dark:border-zinc-700"
        :disabled="!pagination.hasNextPage"
        @click="goToPage(page + 1)">
        {{ t("admin.support.next") }}
      </button>
    </nav>
  </section>
</template>
