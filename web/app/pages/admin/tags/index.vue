<script setup lang="ts">
  import { computed, onMounted, ref } from "vue"
  import type { AdminTag, AdminTagStatus } from "~/composables/useAdminTags"
  import { TAG_BULK_LIMIT } from "~/composables/useAdminTags"

  const { t } = useI18n()
  const route = useRoute()
  const { summary } = useAdminDashboard()
  const { tags, loading, failed, conflict, forbidden, requestId, refresh, merge, archive, restore, loadAudit } =
    useAdminTags()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "taxonomy"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const status = ref<AdminTagStatus>(
    route.query.status === "archived" || route.query.status === "all" ? route.query.status : "active"
  )
  const search = ref(typeof route.query.q === "string" ? route.query.q : "")
  const selected = ref<string[]>([])
  const mergeOpen = ref(false)
  const targetId = ref("")
  const archiveId = ref<string | null>(null)
  const detail = ref<AdminTag | null>(null)
  const audit = ref<Awaited<ReturnType<typeof loadAudit>>>([])

  const isOwner = computed(() => summary.value?.role === "owner")

  const normalizedSearch = computed(() => search.value.trim().toLocaleLowerCase())
  const visibleTags = computed(() =>
    tags.value.filter((tag) =>
      normalizedSearch.value.length >= 2
        ? `${tag.name} ${tag.nameEn ?? ""} ${tag.slug}`.toLocaleLowerCase().includes(normalizedSearch.value)
        : true
    )
  )
  const mergeTargets = computed(() =>
    tags.value.filter((tag) => tag.status === "active" && !selected.value.includes(tag.id))
  )
  const selectedTags = computed(() => tags.value.filter((tag) => selected.value.includes(tag.id)))
  const selectedArticles = computed(() => selectedTags.value.reduce((sum, tag) => sum + (tag._count?.articles ?? 0), 0))
  const overLimit = computed(() => selected.value.length > TAG_BULK_LIMIT)
  const archiveTarget = computed(() => tags.value.find((tag) => tag.id === archiveId.value) ?? null)

  /**
   * Восстановление доступно `admin` только для своего архива; архив, сделанный владельцем,
   * и слитый тег — без кнопки с пояснением (`40-admin/tags.md` §5, §9).
   */
  const canRestore = (tag: AdminTag) =>
    tag.status === "archived" && !tag.mergedInto && (isOwner.value || tag.archivedByRole !== "owner")

  const syncUrl = () =>
    navigateTo({ path: "/admin/tags", query: { status: status.value, ...(search.value ? { q: search.value } : {}) } })

  const setStatus = async (event: Event) => {
    status.value = (event.target as HTMLSelectElement).value as AdminTagStatus
    await syncUrl()
    await refresh(status.value)
  }

  const toggle = (id: string) => {
    selected.value = selected.value.includes(id)
      ? selected.value.filter((item) => item !== id)
      : [...selected.value, id]
  }

  const openMerge = () => {
    targetId.value = ""
    mergeOpen.value = true
  }
  const confirmMerge = async () => {
    if (!targetId.value || overLimit.value) return
    try {
      await merge(selected.value, targetId.value, status.value)
      selected.value = []
      mergeOpen.value = false
    } catch {
      // Конфликт цели показывает список: выбор сохраняется для повторной попытки (§9).
      mergeOpen.value = false
    }
  }

  const confirmArchive = async () => {
    if (!archiveId.value) return
    try {
      await archive(archiveId.value, status.value)
    } finally {
      archiveId.value = null
    }
  }

  const runRestore = async (id: string) => {
    try {
      await restore(id, status.value)
    } catch {
      // Причина уже в состоянии раздела; список и выбор остаются на месте.
    }
  }

  const showDetail = async (tag: AdminTag) => {
    detail.value = tag
    audit.value = await loadAudit(tag.id).catch(() => [])
  }

  onMounted(() => refresh(status.value))
</script>

<template>
  <section
    class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="tags-title">
    <header class="mb-7 border-b border-zinc-300 pb-5 dark:border-zinc-700">
      <p class="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-orange-700 dark:text-orange-400">
        {{ t("admin.tags.eyebrow") }}
      </p>
      <h1 id="tags-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50 sm:text-4xl">
        {{ t("admin.tags.title") }}
      </h1>
      <p class="mt-2 max-w-2xl font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.tags.description") }}
      </p>
    </header>

    <div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex flex-col gap-3 sm:flex-row">
        <label class="sr-only" for="tags-search">{{ t("admin.tags.search") }}</label>
        <input
          id="tags-search"
          v-model="search"
          data-tag-search
          type="search"
          :placeholder="t('admin.tags.search')"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <label class="sr-only" for="tags-status">{{ t("admin.tags.status") }}</label>
        <select
          id="tags-status"
          data-tag-status
          :value="status"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="setStatus">
          <option value="active">{{ t("admin.tags.active") }}</option>
          <option value="archived">{{ t("admin.tags.archived") }}</option>
          <option value="all">{{ t("admin.tags.all") }}</option>
        </select>
      </div>

      <!-- Слияние и массовые операции — только десктоп (`40-admin/tags.md` §10). -->
      <div class="hidden items-center gap-3 lg:flex">
        <span class="font-sans text-sm text-zinc-500">{{ t("admin.tags.selected", { count: selected.length }) }}</span>
        <button
          type="button"
          data-merge-open
          :disabled="!selected.length || overLimit"
          class="min-h-11 bg-zinc-950 px-5 font-sans text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-950"
          @click="openMerge">
          {{ t("admin.tags.merge") }}
        </button>
      </div>
    </div>

    <p v-if="overLimit" role="alert" data-tag-limit class="mb-4 font-sans text-sm font-semibold text-red-700">
      {{ t("admin.tags.limit", { count: TAG_BULK_LIMIT }) }}
    </p>
    <p
      v-if="conflict"
      role="alert"
      data-tag-conflict
      class="mb-4 border border-amber-400 bg-amber-50 p-4 font-sans text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      {{ t("admin.tags.conflict") }} <span v-if="requestId" class="font-mono">requestId: {{ requestId }}</span>
    </p>
    <p
      v-if="forbidden"
      role="alert"
      data-tag-forbidden
      class="mb-4 border border-amber-400 bg-amber-50 p-4 font-sans text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      {{ t("admin.tags.forbidden") }} <span v-if="requestId" class="font-mono">requestId: {{ requestId }}</span>
    </p>
    <p
      v-if="failed"
      role="alert"
      data-tag-error
      class="mb-4 border border-red-300 bg-red-50 p-4 font-sans text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {{ t("admin.tags.error") }} <span v-if="requestId" class="font-mono">requestId: {{ requestId }}</span>
    </p>

    <div v-if="loading" aria-busy="true" data-tag-skeleton class="grid gap-2">
      <div v-for="index in 5" :key="index" class="h-16 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>

    <div v-else class="grid gap-2">
      <article
        v-for="tag in visibleTags"
        :key="tag.id"
        :data-tag-row="tag.slug"
        class="grid grid-cols-[auto_1fr] items-center border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:grid-cols-[auto_1fr_auto]">
        <div class="hidden items-center justify-center px-4 lg:flex">
          <input
            :aria-label="t('admin.tags.select')"
            :data-tag-select="tag.slug"
            type="checkbox"
            class="size-4"
            :checked="selected.includes(tag.id)"
            :disabled="tag.status !== 'active'"
            @change="toggle(tag.id)" />
        </div>
        <button
          type="button"
          class="col-span-2 min-w-0 p-4 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-orange-600 lg:col-span-1"
          @click="showDetail(tag)">
          <span class="font-serif text-xl text-zinc-950 dark:text-zinc-50">{{ tag.name }}</span>
          <span v-if="tag.nameEn" class="ml-2 font-sans text-sm text-zinc-500">{{ tag.nameEn }}</span>
          <span class="ml-2 font-mono text-xs text-zinc-400">/{{ tag.slug }}</span>
          <span class="mt-1 block font-sans text-xs text-zinc-500">
            {{ tag._count?.articles ?? 0 }} · {{ t("admin.tags.materials") }}
          </span>
          <span v-if="tag.mergedInto" :data-tag-merged="tag.slug" class="mt-1 block font-sans text-xs text-orange-700">
            {{ t("admin.tags.mergedInto", { name: tag.mergedInto.name }) }}
          </span>
        </button>
        <div
          class="col-span-2 flex flex-wrap items-center gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800 lg:col-span-1 lg:border-l lg:border-t-0">
          <button
            v-if="tag.status === 'active'"
            type="button"
            class="tag-action text-red-700"
            :data-archive-tag="tag.slug"
            @click="archiveId = tag.id">
            {{ t("admin.tags.archive") }}
          </button>
          <button
            v-else-if="canRestore(tag)"
            type="button"
            class="tag-action"
            :data-restore-tag="tag.slug"
            @click="runRestore(tag.id)">
            {{ t("admin.tags.restore") }}
          </button>
          <span v-else :data-no-restore="tag.slug" class="font-sans text-xs text-zinc-500">
            {{ tag.mergedInto ? t("admin.tags.mergedNoRestore") : t("admin.tags.ownerArchiveNote") }}
          </span>
        </div>
      </article>

      <p
        v-if="!visibleTags.length"
        data-tag-empty
        class="border border-dashed border-zinc-300 p-12 text-center font-serif text-2xl dark:border-zinc-700">
        {{ normalizedSearch || status !== "all" ? t("admin.tags.emptyFilter") : t("admin.tags.empty") }}
      </p>
    </div>

    <dialog
      :open="mergeOpen"
      class="fixed inset-0 z-50 m-auto w-[min(34rem,calc(100%-2rem))] border border-zinc-300 bg-white p-6 shadow-2xl backdrop:bg-black/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50">
      <h2 class="font-serif text-2xl">{{ t("admin.tags.mergeTitle") }}</h2>
      <p class="mt-2 font-sans text-sm text-zinc-600 dark:text-zinc-300">{{ t("admin.tags.mergeHint") }}</p>
      <p class="mt-4 font-sans text-xs font-semibold uppercase tracking-widest text-zinc-500">
        {{ t("admin.tags.mergeSources") }}
      </p>
      <ul class="mt-2 grid gap-1">
        <li v-for="tag in selectedTags" :key="tag.id" class="font-sans text-sm">
          {{ tag.name }} · {{ tag._count?.articles ?? 0 }}
        </li>
      </ul>
      <p data-merge-total class="mt-3 font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.tags.mergeTotal", { count: selectedArticles }) }}
      </p>
      <label class="tag-field mt-4">
        {{ t("admin.tags.mergeTarget") }}
        <select v-model="targetId" data-merge-target>
          <option value="">{{ t("admin.tags.chooseTarget") }}</option>
          <option v-for="tag in mergeTargets" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
        </select>
      </label>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="tag-action" @click="mergeOpen = false">{{ t("admin.tags.cancel") }}</button>
        <button
          type="button"
          data-confirm-merge
          :disabled="!targetId || overLimit"
          class="min-h-10 bg-red-700 px-4 font-sans text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          @click="confirmMerge">
          {{ t("admin.tags.confirmMerge") }}
        </button>
      </div>
    </dialog>

    <dialog
      :open="Boolean(archiveId)"
      class="fixed inset-0 z-50 m-auto w-[min(32rem,calc(100%-2rem))] border border-red-300 bg-white p-6 shadow-2xl backdrop:bg-black/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50">
      <h2 class="font-serif text-2xl">{{ t("admin.tags.archiveTitle") }}</h2>
      <p class="mt-2 font-sans text-sm text-zinc-600 dark:text-zinc-300">{{ t("admin.tags.archiveHint") }}</p>
      <p data-archive-count class="mt-3 font-sans text-sm font-semibold">
        {{ t("admin.tags.archiveCount", { count: archiveTarget?._count?.articles ?? 0 }) }}
      </p>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="tag-action" @click="archiveId = null">{{ t("admin.tags.cancel") }}</button>
        <button
          type="button"
          data-confirm-archive
          class="min-h-10 bg-red-700 px-4 font-sans text-sm font-semibold text-white"
          @click="confirmArchive">
          {{ t("admin.tags.archive") }}
        </button>
      </div>
    </dialog>

    <aside
      v-if="detail"
      data-tag-detail
      class="fixed inset-y-0 right-0 z-30 w-[min(30rem,100%)] overflow-y-auto border-l border-zinc-300 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
      <button type="button" class="tag-action float-right" :aria-label="t('admin.tags.close')" @click="detail = null">
        ×
      </button>
      <p class="font-mono text-xs uppercase tracking-widest text-orange-700">/{{ detail.slug }}</p>
      <h2 class="mt-2 font-serif text-3xl">{{ detail.name }}</h2>
      <p class="mt-6 font-mono text-4xl">{{ detail._count?.articles ?? 0 }}</p>
      <p class="font-sans text-sm text-zinc-500">{{ t("admin.tags.materials") }}</p>
      <NuxtLink
        :to="`/admin/articles?tag=${detail.id}`"
        class="mt-3 inline-block font-sans text-sm font-semibold text-orange-700 underline">
        {{ t("admin.tags.openMaterials") }}
      </NuxtLink>
      <h3 class="mt-10 border-b border-zinc-300 pb-2 font-serif text-xl">{{ t("admin.tags.events") }}</h3>
      <ol class="mt-3 grid gap-3">
        <li v-for="entry in audit" :key="entry.id" class="border-l-2 border-orange-600 pl-3">
          <p class="font-mono text-xs">{{ entry.action }}</p>
          <p class="font-sans text-xs text-zinc-500">{{ entry.createdAt }} · {{ entry.actorRole }}</p>
        </li>
        <li v-if="!audit.length" class="font-sans text-sm text-zinc-500">{{ t("admin.tags.emptyEvents") }}</li>
      </ol>
    </aside>
  </section>
</template>

<style scoped>
  .tag-action {
    min-height: 2.5rem;
    padding: 0.45rem 0.75rem;
    border: 1px solid rgb(212 212 216);
    font: 600 0.75rem/1.2 sans-serif;
  }
  .tag-action:focus-visible {
    outline: 2px solid rgb(234 88 12);
    outline-offset: 2px;
  }
  .tag-field {
    display: grid;
    gap: 0.4rem;
    font: 600 0.75rem/1.2 sans-serif;
    color: rgb(82 82 91);
  }
  .tag-field select {
    width: 100%;
    min-height: 2.75rem;
    border: 1px solid rgb(212 212 216);
    background: transparent;
    padding: 0.7rem;
    font: 400 0.875rem/1.4 sans-serif;
    color: inherit;
  }
</style>
