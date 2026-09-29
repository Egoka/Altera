<script setup lang="ts">
  import { computed } from "vue"
  import type { ProfileReviewField, ProfileReviewVerdict } from "~/graphql/generated/graphql"

  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const { items, profiles, pagination, pending, failed, requestId, canDecide, refresh, decideProfile } =
    useAdminReviewList()
  const reload = () => refresh()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-review"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const tab = computed(() => (route.query.tab === "profiles" ? "profiles" : "materials"))
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
  const decide = (userId: string, field: ProfileReviewField, verdict: ProfileReviewVerdict) =>
    decideProfile({ userId, field, verdict, reason: null })
</script>

<template>
  <section
    class="min-h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="review-title">
    <header class="mb-6 border-b border-zinc-200 pb-5 dark:border-zinc-800">
      <p class="mb-2 font-mono text-xs uppercase tracking-[0.22em] text-amber-700 dark:text-amber-400">
        Editorial control
      </p>
      <h1 id="review-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50 sm:text-4xl">
        {{ t("admin.review.title") }}
      </h1>
      <p class="mt-2 max-w-2xl font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.review.description") }}
      </p>
    </header>

    <nav
      class="mb-5 flex gap-1 border-b border-zinc-300 dark:border-zinc-700"
      :aria-label="t('admin.review.tabsLabel')">
      <button
        v-for="value in ['materials', 'profiles']"
        :key="value"
        type="button"
        class="min-h-11 border-b-2 px-4 font-sans text-sm"
        :class="tab === value ? 'border-amber-600 text-zinc-950 dark:text-white' : 'border-transparent text-zinc-500'"
        :data-review-tab="value"
        @click="setQuery({ tab: value === 'materials' ? undefined : value })">
        {{ t(`admin.review.tab.${value}`) }}
      </button>
    </nav>

    <div v-if="tab === 'materials'" class="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <label class="flex flex-col gap-1 font-sans text-xs text-zinc-500">
        {{ t("admin.review.search") }}
        <input
          type="search"
          :value="route.query.q ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSearch" />
      </label>
      <label class="flex flex-col gap-1 font-sans text-xs text-zinc-500">
        {{ t("admin.review.filterState") }}
        <select
          :value="route.query.state ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSelect('state', $event)">
          <option value="">{{ t("admin.review.allStates") }}</option>
          <option v-for="state in ['queued', 'in_review', 'rework']" :key="state" :value="state">
            {{ t(`admin.review.state.${state}`) }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1 font-sans text-xs text-zinc-500">
        {{ t("admin.review.sort") }}
        <select
          :value="route.query.sort ?? 'age'"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onSelect('sort', $event)">
          <option value="age">{{ t("admin.review.sortAge") }}</option>
          <option value="updated">{{ t("admin.review.sortUpdated") }}</option>
        </select>
      </label>
    </div>

    <div v-if="pending" data-review-state="loading" aria-busy="true" class="space-y-3">
      <div v-for="index in 4" :key="index" class="h-16 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>
    <div
      v-else-if="failed"
      data-review-state="error"
      class="border border-red-300 bg-red-50 p-5 dark:border-red-800 dark:bg-red-950">
      <p>{{ t("admin.review.error") }}</p>
      <p v-if="requestId" class="mt-1 font-mono text-xs">{{ requestId }}</p>
      <button type="button" class="mt-4 min-h-11 border border-zinc-950 px-4 dark:border-white" @click="reload">
        {{ t("common.retry") }}
      </button>
    </div>

    <template v-else-if="tab === 'materials'">
      <div
        v-if="!items.length"
        data-review-state="empty"
        class="border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
        {{ t("admin.review.empty") }}
      </div>
      <div
        v-else
        data-review-table
        class="overflow-x-auto border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table class="w-full border-collapse text-left font-sans text-sm">
          <thead class="bg-zinc-100 text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-950">
            <tr>
              <th class="px-4 py-3">{{ t("admin.review.material") }}</th>
              <th class="px-4 py-3">{{ t("admin.review.stateLabel") }}</th>
              <th class="px-4 py-3">{{ t("admin.review.reads") }}</th>
              <th class="px-4 py-3">{{ t("admin.review.updated") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in items"
              :key="row.id"
              data-review-row
              class="border-t border-zinc-200 dark:border-zinc-800">
              <td class="px-4 py-4">
                <NuxtLink
                  :to="`/admin/review/${row.id}`"
                  class="font-medium underline decoration-zinc-300 underline-offset-4"
                  >{{ row.title }}</NuxtLink
                >
                <p data-review-author class="mt-1 text-xs text-zinc-500">
                  {{ row.author.name }} · @{{ row.author.handle }}
                </p>
              </td>
              <td class="px-4 py-4">
                <span class="border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">{{
                  t(`admin.review.state.${row.state ?? "queued"}`)
                }}</span>
              </td>
              <td data-review-reads class="px-4 py-4 font-mono tabular-nums">{{ row.readCount }}</td>
              <td class="px-4 py-4 text-zinc-500">
                <time :datetime="row.updatedAt">{{ new Date(row.updatedAt).toLocaleDateString() }}</time>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <div
        v-if="!profiles.length"
        data-review-state="empty"
        class="border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
        {{ t("admin.review.emptyProfiles") }}
      </div>
      <ul v-else class="space-y-3">
        <li
          v-for="profile in profiles"
          :key="profile.userId"
          data-review-profile-row
          class="border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p class="font-medium">
            {{ profile.name }} <span class="text-zinc-500">@{{ profile.handle }}</span>
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <template v-for="field in profile.fields" :key="field">
              <span class="self-center text-xs uppercase tracking-wide text-zinc-500">{{
                t(`admin.review.profileField.${field}`)
              }}</span>
              <button
                v-if="canDecide"
                type="button"
                class="min-h-11 border border-zinc-950 px-3 dark:border-white"
                @click="decide(profile.userId, field, 'accept')">
                {{ t("admin.review.accept") }}
              </button>
              <button
                v-if="canDecide"
                type="button"
                class="min-h-11 border border-red-700 px-3 text-red-700"
                @click="decide(profile.userId, field, 'reject')">
                {{ t("admin.review.reject") }}
              </button>
            </template>
          </div>
        </li>
      </ul>
    </template>

    <nav v-if="pagination && pagination.totalPages > 1" class="mt-6 flex items-center justify-between">
      <button type="button" :disabled="!pagination.hasPreviousPage" @click="goToPage(pagination.currentPage - 1)">
        {{ t("common.previous") }}
      </button>
      <span class="font-mono text-xs">{{ pagination.currentPage }} / {{ pagination.totalPages }}</span>
      <button type="button" :disabled="!pagination.hasNextPage" @click="goToPage(pagination.currentPage + 1)">
        {{ t("common.next") }}
      </button>
    </nav>
  </section>
</template>
