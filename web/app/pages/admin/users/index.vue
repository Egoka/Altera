<script setup lang="ts">
  import { computed } from "vue"
  import { USER_ARCHIVE_MODES, USER_PLANS, USER_ROLES, USER_SORTS, USER_STATUSES } from "~/composables/useAdminUsers"

  /**
   * Список раздела «Пользователи» (`docs/spec/40-admin/users.md` §4, §9). Адрес здесь всегда маска:
   * полный открывает только карточка, и её открытие пишется в аудит (журнал §28.7).
   */
  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const { items, pagination, viewerCanManage, pending, failed, requestId, page, refresh } = useAdminUsersList()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-users"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const setQuery = (patch: Record<string, string | undefined>) => {
    const query: Record<string, string> = { ...(route.query as Record<string, string>) }
    for (const [key, value] of Object.entries(patch)) {
      if (value) query[key] = value
      else delete query[key]
    }
    delete query.page
    return router.replace({ query })
  }

  const onSelect = (key: string, event: Event) => setQuery({ [key]: (event.target as HTMLSelectElement).value })
  const onSearch = (event: Event) => setQuery({ q: (event.target as HTMLInputElement).value })
  const goToPage = (next: number) => router.replace({ query: { ...route.query, page: String(next) } })

  const status = computed(() => (route.query.status as string | undefined) ?? "active")

  const formatDate = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        })
      : "—"

  const planLabel = (row: (typeof items.value)[number]) =>
    t(`admin.users.planState.${row.plan.state}`, { tier: t(`admin.users.tier.${row.plan.tier}`) })

  const statusLabel = (row: (typeof items.value)[number]) =>
    row.status === "active"
      ? t("admin.users.status.active")
      : t(`admin.users.archiveMode.${row.archiveMode ?? "admin"}`)
</script>

<template>
  <section
    class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="users-title">
    <header class="mb-7 pb-5">
      <h1 id="users-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50 sm:text-4xl">
        {{ t("admin.users.title") }}
      </h1>
      <p class="mt-2 max-w-2xl font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.users.description") }}
      </p>
    </header>

    <p data-users-masked-note class="mb-5 font-sans text-sm text-zinc-600 dark:text-zinc-300">
      {{ t("admin.users.maskedNote") }}
    </p>

    <p v-if="!viewerCanManage" data-users-readonly-note class="mb-5 font-sans text-sm text-zinc-600 dark:text-zinc-300">
      {{ t("admin.users.readOnlyNote") }}
    </p>

    <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div class="flex flex-col gap-1">
        <label class="font-sans text-xs text-zinc-500" for="users-search">{{ t("admin.users.searchLabel") }}</label>
        <input
          id="users-search"
          data-users-search
          type="search"
          :value="route.query.q ?? ''"
          :placeholder="t('admin.users.searchHint')"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSearch" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="font-sans text-xs text-zinc-500" for="users-role">{{ t("admin.users.filterRole") }}</label>
        <select
          id="users-role"
          data-users-filter="role"
          :value="route.query.role ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSelect('role', $event)">
          <option value="">{{ t("admin.users.allRoles") }}</option>
          <option v-for="value in USER_ROLES" :key="value" :value="value">
            {{ t(`admin.users.role.${value}`) }}
          </option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="font-sans text-xs text-zinc-500" for="users-status">{{ t("admin.users.filterStatus") }}</label>
        <select
          id="users-status"
          data-users-filter="status"
          :value="status"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSelect('status', $event)">
          <option v-for="value in USER_STATUSES" :key="value" :value="value">
            {{ t(`admin.users.status.${value}`) }}
          </option>
        </select>
      </div>
      <div v-if="status === 'archived'" class="flex flex-col gap-1">
        <label class="font-sans text-xs text-zinc-500" for="users-mode">{{ t("admin.users.filterMode") }}</label>
        <select
          id="users-mode"
          data-users-filter="mode"
          :value="route.query.mode ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSelect('mode', $event)">
          <option value="">{{ t("admin.users.allModes") }}</option>
          <option v-for="value in USER_ARCHIVE_MODES" :key="value" :value="value">
            {{ t(`admin.users.archiveMode.${value}`) }}
          </option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="font-sans text-xs text-zinc-500" for="users-plan">{{ t("admin.users.filterPlan") }}</label>
        <select
          id="users-plan"
          data-users-filter="plan"
          :value="route.query.plan ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSelect('plan', $event)">
          <option value="">{{ t("admin.users.allPlans") }}</option>
          <option v-for="value in USER_PLANS" :key="value" :value="value">
            {{ t(`admin.users.plan.${value}`) }}
          </option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="font-sans text-xs text-zinc-500" for="users-published">
          {{ t("admin.users.filterPublished") }}
        </label>
        <select
          id="users-published"
          data-users-filter="published"
          :value="route.query.published ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSelect('published', $event)">
          <option value="">{{ t("admin.users.allPublications") }}</option>
          <option value="yes">{{ t("admin.users.withPublications") }}</option>
          <option value="no">{{ t("admin.users.withoutPublications") }}</option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="font-sans text-xs text-zinc-500" for="users-sort">{{ t("admin.users.sortLabel") }}</label>
        <select
          id="users-sort"
          data-users-sort
          :value="route.query.sort ?? 'registered'"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSelect('sort', $event)">
          <option v-for="value in USER_SORTS" :key="value" :value="value">
            {{ t(`admin.users.sort.${value}`) }}
          </option>
        </select>
      </div>
    </div>

    <div v-if="pending" data-users-state="loading" aria-busy="true" :aria-label="t('admin.users.loading')">
      <span class="sr-only">{{ t("admin.users.loading") }}</span>
      <div
        v-for="row in 5"
        :key="row"
        class="mb-2 h-11 animate-pulse bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800"></div>
    </div>

    <div
      v-else-if="failed"
      data-users-state="error"
      role="alert"
      class="border border-red-300 bg-white px-4 py-8 text-center font-sans text-sm dark:border-red-900 dark:bg-zinc-900">
      <p class="text-zinc-900 dark:text-zinc-100">{{ t("admin.users.loadError") }}</p>
      <p v-if="requestId" class="mt-2 font-mono text-xs text-zinc-500">requestId: {{ requestId }}</p>
      <button
        type="button"
        class="mt-4 min-h-11 border border-zinc-950 px-4 font-sans text-sm font-semibold dark:border-zinc-100"
        @click="refresh()">
        {{ t("admin.users.retry") }}
      </button>
    </div>

    <p
      v-else-if="items.length === 0"
      data-users-state="empty"
      class="bg-white px-4 py-12 text-center font-sans text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
      {{ t("admin.users.empty") }}
    </p>

    <table v-else data-users-table class="w-full border-collapse font-sans text-sm">
      <thead>
        <tr class="text-left text-xs uppercase tracking-wide text-zinc-500">
          <th scope="col" class="py-2">{{ t("admin.users.columnName") }}</th>
          <th scope="col" class="py-2">{{ t("admin.users.columnEmail") }}</th>
          <th scope="col" class="py-2">{{ t("admin.users.columnRole") }}</th>
          <th scope="col" class="py-2">{{ t("admin.users.columnPlan") }}</th>
          <th scope="col" class="py-2">{{ t("admin.users.columnStatus") }}</th>
          <th scope="col" class="py-2">{{ t("admin.users.columnRegistered") }}</th>
          <th scope="col" class="py-2">{{ t("admin.users.columnLastActive") }}</th>
          <th scope="col" class="py-2">{{ t("admin.users.columnArticles") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in items" :key="row.id" :data-users-row="row.id" :data-users-status="row.status">
          <td class="py-2">
            <NuxtLink :to="`/admin/users/${row.id}`" class="underline underline-offset-4">{{ row.name }}</NuxtLink>
            <span class="block text-xs text-zinc-500">@{{ row.handle }}</span>
          </td>
          <td data-users-email class="py-2">{{ row.email }}</td>
          <td class="py-2">{{ t(`admin.users.role.${row.role}`) }}</td>
          <td data-users-plan class="py-2">{{ planLabel(row) }}</td>
          <td data-users-status-label class="py-2">{{ statusLabel(row) }}</td>
          <td class="py-2 whitespace-nowrap">{{ formatDate(row.createdAt) }}</td>
          <td class="py-2 whitespace-nowrap">{{ formatDate(row.lastActiveAt) }}</td>
          <td class="py-2">{{ row.articlesCount }}</td>
        </tr>
      </tbody>
    </table>

    <nav v-if="pagination && pagination.totalPages > 1" class="mt-5 flex items-center gap-3" aria-label="pagination">
      <button
        type="button"
        data-users-prev
        class="min-h-11 border border-zinc-300 px-3 font-sans text-sm disabled:opacity-40 dark:border-zinc-700"
        :disabled="!pagination.hasPreviousPage"
        @click="goToPage(page - 1)">
        {{ t("admin.users.previous") }}
      </button>
      <span class="font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.users.pageOf", { page: pagination.currentPage, total: pagination.totalPages }) }}
      </span>
      <button
        type="button"
        data-users-next
        class="min-h-11 border border-zinc-300 px-3 font-sans text-sm disabled:opacity-40 dark:border-zinc-700"
        :disabled="!pagination.hasNextPage"
        @click="goToPage(page + 1)">
        {{ t("admin.users.next") }}
      </button>
    </nav>
  </section>
</template>
