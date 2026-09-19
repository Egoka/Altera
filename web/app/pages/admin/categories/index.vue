<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from "vue"

  const { t } = useI18n()
  const route = useRoute()
  const {
    sections,
    formats,
    loading,
    failed,
    requestId,
    refresh,
    saveSection,
    archiveSection,
    restoreSection,
    moveSection,
    saveFormat,
    archiveFormat,
    restoreFormat,
    loadAudit
  } = useAdminCategories()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "taxonomy"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  type Tab = "sections" | "formats"
  type Status = "active" | "archived" | "all"

  const tab = ref<Tab>(route.query.tab === "formats" ? "formats" : "sections")
  const status = ref<Status>(
    route.query.status === "archived" || route.query.status === "all" ? route.query.status : "active"
  )
  const search = ref("")
  const editorOpen = ref(false)
  const archiveId = ref<string | null>(null)
  const successorId = ref("")
  const archiveReason = ref("")
  const detail = ref<{ type: "Section" | "Format"; id: string; name: string; articles: number } | null>(null)
  const audit = ref<Awaited<ReturnType<typeof loadAudit>>>([])

  const form = reactive({
    id: "",
    name: "",
    nameEn: "",
    slug: "",
    description: "",
    descriptionEn: "",
    seoTitle: "",
    seoTitleEn: "",
    seoDescription: "",
    seoDescriptionEn: "",
    order: 0
  })

  const normalizedSearch = computed(() => search.value.trim().toLocaleLowerCase())
  const visibleSections = computed(() =>
    sections.value.filter((item) =>
      normalizedSearch.value
        ? `${item.name} ${item.nameEn ?? ""} ${item.slug}`.toLocaleLowerCase().includes(normalizedSearch.value)
        : true
    )
  )
  const visibleFormats = computed(() =>
    formats.value.filter((item) =>
      normalizedSearch.value
        ? `${item.name} ${item.nameEn ?? ""} ${item.slug}`.toLocaleLowerCase().includes(normalizedSearch.value)
        : true
    )
  )
  const activeSuccessors = computed(() =>
    sections.value.filter((item) => item.status === "active" && item.id !== archiveId.value)
  )

  const syncUrl = () => navigateTo({ path: "/admin/categories", query: { tab: tab.value, status: status.value } })
  const setTab = (value: Tab) => {
    tab.value = value
    editorOpen.value = false
    void syncUrl()
  }
  const setStatus = async (event: Event) => {
    status.value = (event.target as HTMLSelectElement).value as Status
    await syncUrl()
    await refresh(status.value)
  }

  const resetForm = () => {
    Object.assign(form, {
      id: "",
      name: "",
      nameEn: "",
      slug: "",
      description: "",
      descriptionEn: "",
      seoTitle: "",
      seoTitleEn: "",
      seoDescription: "",
      seoDescriptionEn: "",
      order: 0
    })
  }
  const openCreate = () => {
    resetForm()
    editorOpen.value = true
  }
  const openEdit = (item: Record<string, unknown>) => {
    resetForm()
    for (const key of Object.keys(form)) if (key in item) Reflect.set(form, key, Reflect.get(item, key) ?? "")
    editorOpen.value = true
  }
  const submit = async () => {
    if (tab.value === "sections") await saveSection({ ...form })
    else await saveFormat({ ...form })
    editorOpen.value = false
  }

  const openArchive = (id: string) => {
    archiveId.value = id
    successorId.value = ""
    archiveReason.value = ""
  }
  const confirmSectionArchive = async () => {
    if (!archiveId.value || !successorId.value || !archiveReason.value.trim()) return
    await archiveSection(archiveId.value, successorId.value, archiveReason.value.trim())
    archiveId.value = null
  }
  const showDetail = async (
    entity: { id: string; name: string; _count?: { articles: number } | null },
    type: "Section" | "Format"
  ) => {
    detail.value = { type, id: entity.id, name: entity.name, articles: entity._count?.articles ?? 0 }
    audit.value = await loadAudit(type, entity.id)
  }

  onMounted(() => refresh(status.value))
</script>

<template>
  <section
    class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="taxonomy-title">
    <header class="mb-7 border-b border-zinc-300 pb-5 dark:border-zinc-700">
      <div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p
            class="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-orange-700 dark:text-orange-400">
            {{ t("admin.categories.eyebrow") }}
          </p>
          <h1 id="taxonomy-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50 sm:text-4xl">
            {{ t("admin.categories.title") }}
          </h1>
          <p class="mt-2 max-w-2xl font-sans text-sm text-zinc-600 dark:text-zinc-300">
            {{ t("admin.categories.description") }}
          </p>
        </div>
        <button
          type="button"
          class="min-h-11 bg-zinc-950 px-5 font-sans text-sm font-semibold text-white hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:bg-zinc-100 dark:text-zinc-950"
          @click="openCreate">
          {{ tab === "sections" ? t("admin.categories.createSection") : t("admin.categories.createFormat") }}
        </button>
      </div>
    </header>

    <div class="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex border-b border-zinc-300 dark:border-zinc-700" role="tablist">
        <button
          v-for="value in ['sections', 'formats'] as const"
          :key="value"
          type="button"
          role="tab"
          :aria-selected="tab === value"
          :data-taxonomy-tab="value"
          class="border-b-2 px-4 py-3 font-sans text-sm font-semibold"
          :class="
            tab === value ? 'border-orange-600 text-zinc-950 dark:text-white' : 'border-transparent text-zinc-500'
          "
          @click="setTab(value)">
          {{ t(`admin.categories.tabs.${value}`) }}
        </button>
      </div>
      <div class="flex flex-col gap-3 sm:flex-row">
        <label class="sr-only" for="taxonomy-search">{{ t("admin.categories.search") }}</label>
        <input
          id="taxonomy-search"
          v-model="search"
          type="search"
          :placeholder="t('admin.categories.search')"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <label class="sr-only" for="taxonomy-status">{{ t("admin.categories.status") }}</label>
        <select
          id="taxonomy-status"
          :value="status"
          class="min-h-11 border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900"
          @change="setStatus">
          <option value="active">{{ t("admin.categories.active") }}</option>
          <option value="archived">{{ t("admin.categories.archived") }}</option>
          <option value="all">{{ t("admin.categories.all") }}</option>
        </select>
      </div>
    </div>

    <div
      v-if="failed"
      role="alert"
      class="mb-5 border border-red-300 bg-red-50 p-4 font-sans text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {{ t("admin.categories.error") }} <span v-if="requestId" class="font-mono">requestId: {{ requestId }}</span>
    </div>
    <div v-if="loading" aria-busy="true" class="grid gap-2">
      <div v-for="index in 4" :key="index" class="h-20 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>

    <div v-else-if="tab === 'sections'" class="grid gap-2">
      <article
        v-for="item in visibleSections"
        :key="item.id"
        :data-taxonomy-row="item.id"
        class="group grid grid-cols-[3rem_1fr] border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-[4rem_1fr_auto]">
        <div
          class="flex items-center justify-center border-r border-zinc-200 font-mono text-lg text-orange-700 dark:border-zinc-800 dark:text-orange-400">
          {{ String(item.order).padStart(2, "0") }}
        </div>
        <button
          type="button"
          class="min-w-0 p-4 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-orange-600"
          @click="showDetail(item, 'Section')">
          <span class="font-serif text-xl text-zinc-950 dark:text-zinc-50">{{ item.name }}</span>
          <span class="ml-2 font-mono text-xs text-zinc-400">/{{ item.slug }}</span>
          <span class="mt-1 block font-sans text-xs text-zinc-500"
            >{{ item._count?.articles ?? 0 }} · {{ t("admin.categories.materials") }}</span
          >
        </button>
        <div
          class="col-span-2 flex flex-wrap items-center gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800 sm:col-span-1 sm:border-l sm:border-t-0">
          <button type="button" class="taxonomy-action" @click="moveSection(item.id, -1)">↑</button
          ><button type="button" class="taxonomy-action" @click="moveSection(item.id, 1)">↓</button>
          <button type="button" class="taxonomy-action" @click="openEdit(item)">
            {{ t("admin.categories.edit") }}
          </button>
          <button
            v-if="item.status === 'active'"
            type="button"
            class="taxonomy-action text-red-700"
            :data-archive-section="item.id"
            @click="openArchive(item.id)">
            {{ t("admin.categories.archive") }}
          </button>
          <button v-else type="button" class="taxonomy-action" @click="restoreSection(item.id)">
            {{ t("admin.categories.restore") }}
          </button>
        </div>
      </article>
      <p
        v-if="!visibleSections.length"
        class="border border-dashed border-zinc-300 p-12 text-center font-serif text-2xl dark:border-zinc-700">
        {{ t("admin.categories.emptySections") }}
      </p>
    </div>

    <div v-else class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="item in visibleFormats"
        :key="item.id"
        :data-taxonomy-row="item.id"
        class="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <button type="button" class="w-full text-left" @click="showDetail(item, 'Format')">
          <span class="font-serif text-xl">{{ item.name }}</span
          ><span class="ml-2 font-mono text-xs text-zinc-400">/{{ item.slug }}</span
          ><span class="mt-5 block font-mono text-3xl">{{ item._count.articles }}</span
          ><span class="font-sans text-xs text-zinc-500">{{ t("admin.categories.materials") }}</span>
        </button>
        <div class="mt-5 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <button class="taxonomy-action" type="button" @click="openEdit(item)">{{ t("admin.categories.edit") }}</button
          ><button
            v-if="item.status === 'active'"
            class="taxonomy-action text-red-700"
            type="button"
            @click="archiveFormat(item.id)">
            {{ t("admin.categories.archive") }}</button
          ><button v-else class="taxonomy-action" type="button" @click="restoreFormat(item.id)">
            {{ t("admin.categories.restore") }}
          </button>
        </div>
      </article>
      <p
        v-if="!visibleFormats.length"
        class="col-span-full border border-dashed border-zinc-300 p-12 text-center font-serif text-2xl dark:border-zinc-700">
        {{ t("admin.categories.emptyFormats") }}
      </p>
    </div>

    <dialog
      :open="editorOpen"
      class="fixed inset-0 z-40 m-auto max-h-[90vh] w-[min(48rem,calc(100%-2rem))] overflow-y-auto border border-zinc-300 bg-white p-0 text-zinc-950 shadow-2xl backdrop:bg-black/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50">
      <form class="grid gap-4 p-6" @submit.prevent="submit">
        <div class="flex items-start justify-between">
          <h2 class="font-serif text-2xl">{{ form.id ? t("admin.categories.edit") : t("admin.categories.create") }}</h2>
          <button type="button" class="taxonomy-action" @click="editorOpen = false">×</button>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="taxonomy-field">{{ t("admin.categories.nameRu") }}<input v-model="form.name" required /></label
          ><label class="taxonomy-field"
            >{{ t("admin.categories.nameEn") }}<input v-model="form.nameEn" :required="tab === 'sections'" /></label
          ><label class="taxonomy-field sm:col-span-2"
            >Slug<input v-model="form.slug" required pattern="[a-z0-9-]+" /></label
          ><label class="taxonomy-field"
            >{{ t("admin.categories.descriptionRu") }}<textarea v-model="form.description" rows="3" /></label
          ><label class="taxonomy-field"
            >{{ t("admin.categories.descriptionEn") }}<textarea v-model="form.descriptionEn" rows="3" /></label
          ><template v-if="tab === 'sections'"
            ><label class="taxonomy-field">SEO title RU<input v-model="form.seoTitle" /></label
            ><label class="taxonomy-field">SEO title EN<input v-model="form.seoTitleEn" /></label
          ></template>
        </div>
        <button type="submit" class="min-h-11 bg-orange-700 px-5 font-sans font-semibold text-white">
          {{ t("admin.categories.save") }}
        </button>
      </form>
    </dialog>

    <dialog
      :open="Boolean(archiveId)"
      class="fixed inset-0 z-50 m-auto w-[min(32rem,calc(100%-2rem))] border border-red-300 bg-white p-6 shadow-2xl backdrop:bg-black/40 dark:bg-zinc-900">
      <h2 class="font-serif text-2xl">{{ t("admin.categories.archiveTitle") }}</h2>
      <p class="mt-2 font-sans text-sm text-zinc-600 dark:text-zinc-300">{{ t("admin.categories.archiveHint") }}</p>
      <select
        v-model="successorId"
        data-successor-select
        class="mt-5 min-h-11 w-full border border-zinc-300 bg-white px-3 dark:bg-zinc-950">
        <option value="">{{ t("admin.categories.chooseSuccessor") }}</option>
        <option v-for="item in activeSuccessors" :key="item.id" :value="item.id">{{ item.name }}</option></select
      ><label class="taxonomy-field mt-4"
        >{{ t("admin.categories.reason") }}<textarea v-model="archiveReason" data-archive-reason required rows="3" />
      </label>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="taxonomy-action" @click="archiveId = null">
          {{ t("admin.categories.cancel") }}</button
        ><button
          type="button"
          data-confirm-archive-section
          :disabled="!successorId || !archiveReason.trim()"
          class="min-h-10 bg-red-700 px-4 font-sans text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          @click="confirmSectionArchive">
          {{ t("admin.categories.archive") }}
        </button>
      </div>
    </dialog>

    <aside
      v-if="detail"
      class="fixed inset-y-0 right-0 z-30 w-[min(30rem,100%)] overflow-y-auto border-l border-zinc-300 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
      <button type="button" class="taxonomy-action float-right" @click="detail = null">×</button>
      <p class="font-mono text-xs uppercase tracking-widest text-orange-700">{{ detail.type }}</p>
      <h2 class="mt-2 font-serif text-3xl">{{ detail.name }}</h2>
      <p class="mt-6 font-mono text-4xl">{{ detail.articles }}</p>
      <p class="font-sans text-sm text-zinc-500">{{ t("admin.categories.materials") }}</p>
      <NuxtLink
        :to="`/admin/articles?${detail.type === 'Section' ? 'section' : 'format'}=${detail.id}`"
        class="mt-3 inline-block font-sans text-sm font-semibold text-orange-700 underline"
        >{{ t("admin.categories.openMaterials") }}</NuxtLink
      >
      <h3 class="mt-10 border-b border-zinc-300 pb-2 font-serif text-xl">{{ t("admin.categories.events") }}</h3>
      <ol class="mt-3 grid gap-3">
        <li v-for="entry in audit" :key="entry.id" class="border-l-2 border-orange-600 pl-3">
          <p class="font-mono text-xs">{{ entry.action }}</p>
          <p class="font-sans text-xs text-zinc-500">{{ entry.createdAt }} · {{ entry.actorRole }}</p>
        </li>
        <li v-if="!audit.length" class="font-sans text-sm text-zinc-500">{{ t("admin.categories.emptyEvents") }}</li>
      </ol>
    </aside>
  </section>
</template>

<style scoped>
  .taxonomy-action {
    min-height: 2.5rem;
    padding: 0.45rem 0.75rem;
    border: 1px solid rgb(212 212 216);
    font: 600 0.75rem/1.2 sans-serif;
  }
  .taxonomy-action:focus-visible {
    outline: 2px solid rgb(234 88 12);
    outline-offset: 2px;
  }
  .taxonomy-field {
    display: grid;
    gap: 0.4rem;
    font: 600 0.75rem/1.2 sans-serif;
    color: rgb(82 82 91);
  }
  .taxonomy-field :is(input, textarea) {
    width: 100%;
    border: 1px solid rgb(212 212 216);
    background: transparent;
    padding: 0.7rem;
    font: 400 0.875rem/1.4 sans-serif;
    color: inherit;
  }
</style>
