<script setup lang="ts">
  import { computed } from "vue"

  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const { items, pagination, pending, failed, requestId, refresh } = useAdminArticlesList()
  const { sections, formats, tags } = useAdminArticleFilterOptions()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-articles"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const activeTab = computed(() => (typeof route.query.status === "string" ? route.query.status : "all"))
  const setQuery = (patch: Record<string, string | undefined>) => {
    const query: Record<string, string> = { ...(route.query as Record<string, string>) }
    for (const [key, value] of Object.entries(patch)) {
      if (value) query[key] = value
      else delete query[key]
    }
    delete query.page
    return router.replace({ query })
  }
  const setTab = (status: string) => setQuery({ status: status === "all" ? undefined : status })
  const onInput = (key: string, event: Event) =>
    setQuery({ [key]: (event.target as HTMLInputElement).value || undefined })
  const goToPage = (page: number) => router.replace({ query: { ...route.query, page: String(page) } })
</script>

<template>
  <section
    class="min-h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="articles-title">
    <header class="mb-6 border-b border-zinc-200 pb-5 dark:border-zinc-800">
      <p class="mb-2 font-mono text-xs uppercase tracking-[0.22em] text-amber-700 dark:text-amber-400">
        Editorial archive
      </p>
      <h1 id="articles-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50 sm:text-4xl">
        {{ t("admin.articles.title") }}
      </h1>
      <p class="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.articles.description") }}
      </p>
    </header>

    <nav class="mb-5 flex gap-1 overflow-x-auto border-b border-zinc-300 dark:border-zinc-700">
      <button
        v-for="tab in ['all', 'draft', 'review', 'published', 'rejected', 'archived']"
        :key="tab"
        type="button"
        class="min-h-11 shrink-0 border-b-2 px-4 text-sm"
        :class="
          activeTab === tab ? 'border-amber-600 text-zinc-950 dark:text-white' : 'border-transparent text-zinc-500'
        "
        :data-article-tab="tab"
        @click="setTab(tab)">
        {{ t(`admin.articles.tab.${tab}`) }}
      </button>
    </nav>

    <div class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label class="flex flex-col gap-1 text-xs text-zinc-500">
        {{ t("admin.articles.search") }}
        <input
          data-article-search
          type="search"
          minlength="3"
          :value="route.query.q ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onInput('q', $event)" />
      </label>
      <label class="flex flex-col gap-1 text-xs text-zinc-500">
        {{ t("admin.articles.locale") }}
        <select
          :value="route.query.locale ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onInput('locale', $event)">
          <option value="">{{ t("admin.articles.anyLocale") }}</option>
          <option value="ru">RU</option>
          <option value="en">EN</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-xs text-zinc-500">
        {{ t("admin.articles.author") }}
        <input
          :value="route.query.author ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onInput('author', $event)" />
      </label>
      <label class="flex flex-col gap-1 text-xs text-zinc-500">
        {{ t("admin.articles.sort") }}
        <select
          :value="route.query.sort ?? 'updated'"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onInput('sort', $event)">
          <option v-for="sort in ['updated', 'published', 'title', 'reads']" :key="sort" :value="sort">
            {{ t(`admin.articles.sortValue.${sort}`) }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-xs text-zinc-500">
        {{ t("admin.articles.section") }}
        <select
          data-article-section
          :value="route.query.section ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onInput('section', $event)">
          <option value="">{{ t("admin.articles.anySection") }}</option>
          <option v-for="section in sections" :key="section.id" :value="section.id">{{ section.name }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-xs text-zinc-500">
        {{ t("admin.articles.format") }}
        <select
          data-article-format
          :value="route.query.format ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onInput('format', $event)">
          <option value="">{{ t("admin.articles.anyFormat") }}</option>
          <option v-for="format in formats" :key="format.id" :value="format.id">{{ format.name }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-xs text-zinc-500">
        {{ t("admin.articles.tag") }}
        <select
          data-article-tag
          :value="route.query.tag ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onInput('tag', $event)">
          <option value="">{{ t("admin.articles.anyTag") }}</option>
          <option v-for="tag in tags" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-xs text-zinc-500">
        {{ t("admin.articles.archiveRole") }}
        <select
          data-article-archive-role
          :value="route.query.archiveRole ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onInput('archiveRole', $event)">
          <option value="">{{ t("admin.articles.anyArchiveRole") }}</option>
          <option
            v-for="role in ['reader', 'author', 'editor', 'moderator', 'admin', 'owner']"
            :key="role"
            :value="role">
            {{ t(`admin.articles.archiveRoleValue.${role}`) }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-xs text-zinc-500">
        {{ t("admin.articles.publishedFrom") }}
        <input
          data-article-published-from
          type="date"
          :value="route.query.publishedFrom ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onInput('publishedFrom', $event)" />
      </label>
      <label class="flex flex-col gap-1 text-xs text-zinc-500">
        {{ t("admin.articles.publishedTo") }}
        <input
          data-article-published-to
          type="date"
          :value="route.query.publishedTo ?? ''"
          class="min-h-11 border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="onInput('publishedTo', $event)" />
      </label>
    </div>

    <div v-if="pending" data-articles-state="loading" aria-busy="true" class="space-y-3">
      <div v-for="index in 5" :key="index" class="h-16 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>
    <div
      v-else-if="failed"
      data-articles-state="error"
      class="border border-red-300 bg-red-50 p-5 dark:border-red-800 dark:bg-red-950">
      <p>{{ t("admin.articles.error") }}</p>
      <p v-if="requestId" class="mt-1 font-mono text-xs">{{ requestId }}</p>
      <button type="button" class="mt-4 min-h-11 border border-zinc-950 px-4 dark:border-white" @click="refresh()">
        {{ t("common.retry") }}
      </button>
    </div>
    <div
      v-else-if="!items.length"
      data-articles-state="empty"
      class="border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
      {{ t("admin.articles.empty") }}
    </div>
    <div v-else class="overflow-x-auto border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table class="w-full border-collapse text-left text-sm">
        <thead class="bg-zinc-100 text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-950">
          <tr>
            <th class="px-4 py-3">{{ t("admin.articles.material") }}</th>
            <th class="px-4 py-3">{{ t("admin.articles.status") }}</th>
            <th class="px-4 py-3">{{ t("admin.articles.reads") }}</th>
            <th class="px-4 py-3">{{ t("admin.articles.updated") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="article in items"
            :key="article.id"
            data-article-row
            class="border-t border-zinc-200 dark:border-zinc-800">
            <td class="px-4 py-4">
              <NuxtLink
                :to="`/admin/articles/${article.id}`"
                class="font-medium underline decoration-zinc-300 underline-offset-4">
                {{ article.title }}
              </NuxtLink>
              <p class="mt-1 text-xs text-zinc-500">
                {{ article.locale.toUpperCase() }} · {{ article.author.name }} · @{{ article.author.handle }}
              </p>
              <p v-if="article.section || article.format" class="mt-1 text-xs text-zinc-500">
                {{ article.section?.name ?? "—" }} · {{ article.format?.name ?? "—" }}
              </p>
            </td>
            <td class="px-4 py-4">
              <span class="border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">
                {{ t(`admin.articles.state.${article.status}`) }}
              </span>
              <p v-if="article.archive" class="mt-2 text-xs text-zinc-500">
                {{ article.archive.role }} · {{ article.archive.reason ?? "—" }}
              </p>
            </td>
            <td data-article-reads class="px-4 py-4 font-mono tabular-nums">{{ article.readCount }}</td>
            <td class="px-4 py-4 text-zinc-500">
              <time :datetime="article.updatedAt">{{ new Date(article.updatedAt).toLocaleDateString() }}</time>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav v-if="pagination && pagination.totalPages > 1" class="mt-5 flex items-center justify-between text-sm">
      <button
        type="button"
        class="min-h-11 border border-zinc-300 px-4 disabled:opacity-40"
        :disabled="!pagination.hasPreviousPage"
        @click="goToPage(pagination.currentPage - 1)">
        {{ t("admin.articles.previous") }}
      </button>
      <span class="font-mono">{{ pagination.currentPage }} / {{ pagination.totalPages }}</span>
      <button
        type="button"
        class="min-h-11 border border-zinc-300 px-4 disabled:opacity-40"
        :disabled="!pagination.hasNextPage"
        @click="goToPage(pagination.currentPage + 1)">
        {{ t("admin.articles.next") }}
      </button>
    </nav>
  </section>
</template>
