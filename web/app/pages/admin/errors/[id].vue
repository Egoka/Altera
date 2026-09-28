<script setup lang="ts">
  import { computed, ref } from "vue"
  import type { ErrorWorkStatus } from "~/graphql/generated/graphql"

  const { t } = useI18n()
  const route = useRoute()
  const { openEntry, changeStatus, errorCode, requestId } = useAdminErrors()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-errors"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const id = computed(() => String(route.params.id))
  const comment = ref("")
  const actionPending = ref(false)
  const {
    data: entry,
    pending,
    error,
    refresh
  } = await useAsyncData(
    () => `admin-error-${id.value}`,
    () => openEntry(id.value),
    { watch: [id] }
  )
  const setStatus = async (status: ErrorWorkStatus) => {
    if (!entry.value) return
    actionPending.value = true
    try {
      const changed = await changeStatus(entry.value.id, status, entry.value.updatedAt, comment.value)
      if (changed) {
        comment.value = ""
        await refresh()
      }
    } finally {
      actionPending.value = false
    }
  }
  const formatDate = (value: string) =>
    new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" })
</script>

<template>
  <section class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8">
    <NuxtLink to="/admin/errors" class="font-sans text-sm underline underline-offset-4">{{
      t("admin.errors.back")
    }}</NuxtLink>
    <div v-if="pending" data-error-detail-loading aria-busy="true" class="mt-6 grid gap-2">
      <div
        v-for="index in 5"
        :key="index"
        class="h-12 animate-pulse bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800" />
    </div>
    <p
      v-else-if="error || !entry"
      role="alert"
      class="mt-6 border border-red-400 bg-red-50 p-4 font-sans text-sm text-red-900">
      {{ t("admin.errors.loadError") }} <span v-if="requestId" class="font-mono">requestId: {{ requestId }}</span>
    </p>
    <article v-else class="mt-6 max-w-5xl" :data-error-detail="entry.id">
      <header class="border-b border-zinc-300 pb-5 dark:border-zinc-700">
        <p class="font-mono text-xs uppercase tracking-[0.2em] text-red-700 dark:text-red-400">{{ entry.service }}</p>
        <h1 class="mt-2 font-serif text-3xl text-zinc-950 dark:text-zinc-50">{{ entry.code }}</h1>
        <p class="mt-2 break-all font-mono text-xs text-zinc-500">{{ entry.route ?? entry.signature }}</p>
      </header>

      <p
        v-if="errorCode === 'CONFLICT'"
        data-error-detail-conflict
        role="alert"
        class="mt-5 border border-amber-400 bg-amber-50 p-3 font-sans text-sm text-amber-900">
        {{ t("admin.errors.conflict") }} · <span class="font-mono">CONFLICT</span>
        <button class="ml-3 underline" @click="() => refresh()">{{ t("admin.errors.refresh") }}</button>
      </p>

      <dl class="mt-6 grid gap-3 font-sans text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
        <dt class="text-zinc-500">{{ t("admin.errors.statusLabel") }}</dt>
        <dd>{{ t(`admin.errors.status.${entry.workStatus}`) }}</dd>
        <dt class="text-zinc-500">{{ t("admin.errors.occurrences") }}</dt>
        <dd>{{ entry.occurrencesCount }}</dd>
        <dt class="text-zinc-500">requestId</dt>
        <dd class="font-mono text-xs">{{ entry.requestId ?? "—" }}</dd>
        <dt class="text-zinc-500">{{ t("admin.errors.firstSeen") }}</dt>
        <dd>{{ formatDate(entry.firstSeenAt) }}</dd>
        <dt class="text-zinc-500">{{ t("admin.errors.lastSeen") }}</dt>
        <dd>{{ formatDate(entry.lastSeenAt) }}</dd>
      </dl>

      <section class="mt-7 border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 class="font-sans text-sm font-semibold">{{ t("admin.errors.workflow") }}</h2>
        <textarea
          v-model="comment"
          rows="2"
          :placeholder="t('admin.errors.comment')"
          class="mt-3 w-full border border-zinc-300 bg-transparent p-3 font-sans text-sm dark:border-zinc-700" />
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            v-for="status in ['new', 'in_progress', 'resolved'] as ErrorWorkStatus[]"
            :key="status"
            :data-error-status="status"
            :disabled="actionPending || status === entry.workStatus"
            class="min-h-11 border border-zinc-950 px-4 font-sans text-sm disabled:opacity-40 dark:border-zinc-100"
            @click="setStatus(status)">
            {{ t(`admin.errors.status.${status}`) }}
          </button>
        </div>
      </section>

      <section v-if="entry.message || entry.stack" class="mt-7">
        <h2 class="font-serif text-2xl">{{ t("admin.errors.diagnostics") }}</h2>
        <p v-if="entry.message" class="mt-3 whitespace-pre-wrap font-sans text-sm">{{ entry.message }}</p>
        <pre
          v-if="entry.stack"
          class="mt-3 hidden overflow-x-auto border border-zinc-300 bg-zinc-950 p-4 font-mono text-xs text-zinc-100 md:block"
          >{{ entry.stack }}</pre
        >
      </section>

      <section class="mt-7 grid gap-3 md:grid-cols-2">
        <div>
          <h2 class="font-serif text-2xl">{{ t("admin.errors.recentOccurrences") }}</h2>
          <p
            v-for="occurrence in entry.occurrences"
            :key="occurrence.id"
            class="mt-2 border-l-2 border-zinc-300 pl-3 font-mono text-xs">
            {{ formatDate(occurrence.occurredAt) }} · {{ occurrence.requestId ?? occurrence.jobId ?? "—" }}
          </p>
        </div>
        <div>
          <h2 class="font-serif text-2xl">{{ t("admin.errors.history") }}</h2>
          <p
            v-for="item in entry.statusHistory"
            :key="`${item.createdAt}-${item.toStatus}`"
            class="mt-2 border-l-2 border-zinc-300 pl-3 font-sans text-sm">
            {{ item.fromStatus ?? "—" }} → {{ item.toStatus }} · {{ item.changedByActorRole }}<br />
            <span class="font-mono text-xs text-zinc-500">{{ formatDate(item.createdAt) }}</span>
            <span v-if="item.comment" class="block text-zinc-600 dark:text-zinc-300">{{ item.comment }}</span>
          </p>
        </div>
      </section>
    </article>
  </section>
</template>
