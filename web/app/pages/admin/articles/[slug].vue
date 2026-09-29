<script setup lang="ts">
  import { computed, ref } from "vue"
  import { articleDocumentText, type AdminArticleAction } from "~/composables/useAdminArticles"
  import PermanentDeleteDialog from "~/components/admin/PermanentDeleteDialog.vue"

  const { t } = useI18n()
  const route = useRoute()
  const { summary } = useAdminDashboard()
  const isOwner = computed(() => summary.value?.role === "owner")
  const id = String(route.params.slug)
  const {
    item,
    pending,
    failed,
    canArchive,
    canRestore,
    canReject,
    requestId,
    actionPending,
    actionErrorCode,
    refresh,
    runAction
  } = useAdminArticleCard(id)

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-articles"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const activeAction = ref<AdminArticleAction | null>(null)
  const reason = ref("")
  const validation = ref(false)
  const actionError = ref(false)

  const openAction = (action: AdminArticleAction) => {
    activeAction.value = action
    reason.value = ""
    validation.value = false
    actionError.value = false
  }

  const submitAction = async () => {
    if (!activeAction.value) return
    if (activeAction.value === "archive" && !reason.value.trim()) {
      validation.value = true
      return
    }
    validation.value = false
    actionError.value = false
    if (!(await runAction(activeAction.value, reason.value))) {
      actionError.value = true
      return
    }
    activeAction.value = null
    reason.value = ""
  }

  // Пункт T-076: только материал в архиве и только у владельца (`10-flows/permanent-delete.md` §1).
  const permanentDeleteOpen = ref(false)
  const onPermanentlyDeleted = () => {
    permanentDeleteOpen.value = false
    void navigateTo("/admin/articles")
  }
</script>

<template>
  <section
    class="min-h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="article-card-title">
    <NuxtLink to="/admin/articles" class="text-sm text-zinc-500 underline underline-offset-4">
      ← {{ t("admin.articles.back") }}
    </NuxtLink>

    <div v-if="pending" data-articles-state="loading" aria-busy="true" class="mt-6 space-y-4">
      <div class="h-10 w-2/3 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      <div class="h-48 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>
    <div
      v-else-if="failed"
      data-articles-state="error"
      class="mt-6 border border-red-300 bg-red-50 p-5 dark:border-red-800 dark:bg-red-950">
      <p>{{ t("admin.articles.cardError") }}</p>
      <p v-if="requestId" class="mt-1 font-mono text-xs">{{ requestId }}</p>
      <button type="button" class="mt-4 min-h-11 border border-zinc-950 px-4 dark:border-white" @click="refresh()">
        {{ t("common.retry") }}
      </button>
    </div>

    <template v-else-if="item">
      <header class="mt-6 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <p class="mb-3 font-mono text-xs uppercase tracking-wider text-zinc-500">
          {{ item.locale }} · {{ t(`admin.articles.state.${item.status}`) }} · {{ item.readCount }}
          {{ t("admin.articles.readsShort") }}
        </p>
        <h1 id="article-card-title" class="max-w-4xl font-serif text-3xl leading-tight sm:text-5xl">
          {{ item.title }}
        </h1>
        <p data-article-lead class="mt-4 max-w-3xl text-lg text-zinc-700 dark:text-zinc-200">
          {{ item.dek ?? item.excerpt ?? "—" }}
        </p>
        <p class="mt-3 text-sm text-zinc-500">{{ item.author.name }} · @{{ item.author.handle }}</p>
      </header>

      <div class="mt-5 flex flex-wrap gap-2">
        <NuxtLink
          v-if="item.section && item.slug"
          :to="`/${item.section.slug}/${item.slug}?preview=${item.id}`"
          class="min-h-11 border border-zinc-400 px-4 py-2.5">
          {{ t("admin.articles.preview") }}
        </NuxtLink>
        <NuxtLink
          v-if="['review', 'in_review', 'rework'].includes(item.status)"
          :to="`/admin/review/${item.id}`"
          class="min-h-11 border border-zinc-400 px-4 py-2.5">
          {{ t("admin.articles.openReview") }}
        </NuxtLink>
        <button
          v-if="canArchive && item.status !== 'archived'"
          data-article-open-action="archive"
          type="button"
          class="min-h-11 border border-red-700 px-4 text-red-700"
          @click="openAction('archive')">
          {{ t("admin.articles.archive") }}
        </button>
        <button
          v-if="canRestore && item.status === 'archived'"
          data-article-action="restore"
          type="button"
          class="min-h-11 bg-emerald-700 px-4 text-white"
          :disabled="actionPending"
          @click="runAction('restore')">
          {{ t("admin.articles.restore") }}
        </button>
        <button
          v-if="canReject && item.status === 'in_review'"
          data-article-action="reject"
          type="button"
          class="min-h-11 border border-red-700 px-4 text-red-700"
          @click="openAction('reject')">
          {{ t("admin.articles.finalReject") }}
        </button>
        <button
          v-if="isOwner && item.status === 'archived'"
          data-article-open-permanent-delete
          type="button"
          class="min-h-11 border border-red-700 px-4 text-red-700"
          @click="permanentDeleteOpen = true">
          {{ t("admin.permanentDelete.action") }}
        </button>
      </div>

      <p v-if="actionErrorCode === 'CONFLICT'" class="mt-4 border border-amber-500 bg-amber-50 p-4 dark:bg-amber-950">
        {{ t("admin.articles.conflict") }}
      </p>

      <section
        v-if="item.archive"
        data-article-archive
        class="mt-6 border-l-2 border-red-700 bg-red-50 px-4 py-3 text-sm dark:bg-red-950">
        {{ t("admin.articles.archivedBy") }}: {{ item.archive.role ?? "—" }} · {{ item.archive.reason ?? "—" }}
      </section>

      <div class="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)]">
        <article class="space-y-6">
          <section class="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 class="font-serif text-2xl">{{ t("admin.articles.content") }}</h2>
            <div data-article-body class="mt-4 whitespace-pre-line leading-7 text-zinc-800 dark:text-zinc-200">
              {{ articleDocumentText(item.body) }}
            </div>
          </section>
          <section class="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 class="font-serif text-2xl">{{ t("admin.articles.decisions") }}</h2>
            <p v-if="!item.decisions.length" class="mt-3 text-sm text-zinc-500">—</p>
            <ol v-else class="mt-4 space-y-4">
              <li
                v-for="decision in item.decisions"
                :key="decision.id"
                data-article-decision
                class="border-l-2 border-zinc-300 pl-4 dark:border-zinc-700">
                <p class="text-xs uppercase tracking-wide text-zinc-500">{{ decision.kind }} · {{ decision.byRole }}</p>
                <p v-if="decision.text" class="mt-1">{{ decision.text }}</p>
                <p v-if="decision.recommendations" class="mt-1">{{ decision.recommendations }}</p>
              </li>
            </ol>
          </section>
        </article>

        <aside class="space-y-6">
          <section data-article-cover class="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 class="font-serif text-xl">{{ t("admin.articles.cover") }}</h2>
            <p class="mt-2 text-sm">{{ item.cover?.alt ?? item.cover?.id ?? "—" }}</p>
          </section>
          <section class="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 class="font-serif text-xl">{{ t("admin.articles.revisions") }}</h2>
            <ol class="mt-3 space-y-3">
              <li v-for="revision in item.revisions" :key="revision.id" data-article-revision class="text-sm">
                <p class="font-medium">{{ revision.title }}</p>
                <p class="text-xs text-zinc-500">
                  {{ revision.kind }} · {{ revision.size }} B · {{ revision.author.name }} ·
                  {{ new Date(revision.createdAt).toLocaleString() }}
                </p>
              </li>
            </ol>
          </section>
          <section
            v-if="item.siblings.length"
            class="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 class="font-serif text-xl">{{ t("admin.articles.languages") }}</h2>
            <NuxtLink
              v-for="sibling in item.siblings"
              :key="sibling.id"
              :to="`/admin/articles/${sibling.id}`"
              class="mt-2 block underline underline-offset-4">
              {{ sibling.locale.toUpperCase() }} · {{ sibling.title }}
            </NuxtLink>
          </section>
        </aside>
      </div>

      <div
        v-if="activeAction"
        class="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"
        role="presentation"
        @click.self="activeAction = null">
        <section role="dialog" aria-modal="true" class="w-full max-w-lg bg-white p-6 shadow-2xl dark:bg-zinc-900">
          <h2 class="font-serif text-2xl">{{ t(`admin.articles.action.${activeAction}`) }}</h2>
          <p class="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            {{ t(`admin.articles.warning.${activeAction}`) }}
          </p>
          <textarea
            v-model="reason"
            data-article-action-reason
            class="mt-4 min-h-32 w-full border border-zinc-300 bg-transparent p-3"
            :placeholder="t('admin.articles.reason')" />
          <p v-if="validation" class="mt-2 text-sm text-red-700">{{ t("admin.articles.reasonRequired") }}</p>
          <p v-if="actionError" data-article-action-error class="mt-2 text-sm text-red-700">
            {{ t("admin.articles.actionError") }}<span v-if="requestId"> · {{ requestId }}</span>
          </p>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="min-h-11 border border-zinc-400 px-4" @click="activeAction = null">
              {{ t("common.cancel") }}
            </button>
            <button
              data-article-submit
              type="button"
              :disabled="actionPending"
              class="min-h-11 bg-zinc-950 px-4 text-white disabled:opacity-50 dark:bg-white dark:text-zinc-950"
              @click="submitAction">
              {{ t("admin.articles.confirm") }}
            </button>
          </div>
        </section>
      </div>

      <PermanentDeleteDialog
        v-if="permanentDeleteOpen"
        entity="article"
        :id="item.id"
        :open="permanentDeleteOpen"
        @update:open="permanentDeleteOpen = false"
        @deleted="onPermanentlyDeleted" />
    </template>
  </section>
</template>
