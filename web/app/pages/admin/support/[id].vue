<script setup lang="ts">
  import { computed } from "vue"
  import type { AdminSupportCard } from "~/composables/useAdminSupport"

  const { t } = useI18n()
  const route = useRoute()
  const { loadCard, answer, requestId, errorCode, actionPending } = useAdminSupport()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-support"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const id = computed(() => String(route.params.id))

  const {
    data: request,
    pending: loading,
    error,
    refresh
  } = useAsyncData<AdminSupportCard | null>(`admin-support-${id.value}`, () => loadCard(id.value), {
    default: () => null,
    lazy: true,
    server: false,
    watch: [id]
  })

  const showConflict = computed(() => errorCode.value === "CONFLICT")
  const canAnswer = computed(() => request.value?.status === "received")

  const submitAnswer = async () => {
    const result = await answer(id.value)
    if (result) await refresh()
  }

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
</script>

<template>
  <section
    class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="support-card-title">
    <NuxtLink to="/admin/support" class="font-sans text-sm underline underline-offset-4">
      {{ t("admin.support.backToList") }}
    </NuxtLink>

    <div
      v-if="loading"
      data-support-state="loading"
      aria-busy="true"
      :aria-label="t('admin.support.loading')"
      class="mt-6">
      <span class="sr-only">{{ t("admin.support.loading") }}</span>
      <div
        v-for="row in 4"
        :key="row"
        class="mb-2 h-11 animate-pulse bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800"></div>
    </div>

    <div
      v-else-if="error || !request"
      data-support-state="error"
      role="alert"
      class="mt-6 border border-red-300 bg-white px-4 py-8 text-center font-sans text-sm dark:border-red-900 dark:bg-zinc-900">
      <p class="text-zinc-900 dark:text-zinc-100">{{ t("admin.support.loadError") }}</p>
      <p v-if="requestId" class="mt-2 font-mono text-xs text-zinc-500">requestId: {{ requestId }}</p>
      <button
        type="button"
        class="mt-4 min-h-11 border border-zinc-950 px-4 font-sans text-sm font-semibold dark:border-zinc-100"
        @click="refresh()">
        {{ t("admin.support.retry") }}
      </button>
    </div>

    <article v-else class="mt-6 max-w-3xl" :data-support-card="request.id" :data-support-status="request.status">
      <h1 id="support-card-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">
        {{ t("admin.support.ticket", { ticketNo: request.ticketNo }) }}
      </h1>

      <dl class="mt-5 grid grid-cols-1 gap-3 font-sans text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt class="text-zinc-500">{{ t("admin.support.columnTopic") }}</dt>
        <dd class="text-zinc-900 dark:text-zinc-100">{{ t(`admin.support.topic.${request.topic}`) }}</dd>

        <dt class="text-zinc-500">{{ t("admin.support.columnStatus") }}</dt>
        <dd data-support-card-status class="text-zinc-900 dark:text-zinc-100">
          {{ t(`admin.support.status.${request.status}`) }}
        </dd>

        <dt class="text-zinc-500">{{ t("admin.support.columnTime") }}</dt>
        <dd class="text-zinc-900 dark:text-zinc-100">{{ formatDate(request.createdAt) }}</dd>

        <dt class="text-zinc-500">{{ t("admin.support.columnEmail") }}</dt>
        <dd data-support-card-email class="text-zinc-900 dark:text-zinc-100">
          {{ request.email ?? t("admin.support.emailAbsent") }}
        </dd>

        <dt class="text-zinc-500">{{ t("admin.support.columnPath") }}</dt>
        <dd class="text-zinc-900 dark:text-zinc-100">{{ request.path ?? "—" }}</dd>

        <template v-if="request.requestId">
          <dt class="text-zinc-500">{{ t("admin.support.columnRequestId") }}</dt>
          <dd class="font-mono text-xs text-zinc-700 dark:text-zinc-300">{{ request.requestId }}</dd>
        </template>

        <template v-if="request.answeredAt">
          <dt class="text-zinc-500">{{ t("admin.support.answeredAt") }}</dt>
          <dd class="text-zinc-900 dark:text-zinc-100">
            {{ formatDate(request.answeredAt) }}
            <span v-if="request.answeredBy"> — {{ request.answeredBy.name }}</span>
          </dd>
        </template>
      </dl>

      <h2 class="mt-7 font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {{ t("admin.support.messageTitle") }}
      </h2>
      <p
        data-support-card-message
        class="mt-2 whitespace-pre-line border border-zinc-300 bg-white px-4 py-3 font-sans text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
        {{ request.message ?? t("admin.support.messageAbsent") }}
      </p>

      <p class="mt-5 font-sans text-sm text-zinc-600 dark:text-zinc-300">{{ t("admin.support.answerHint") }}</p>

      <p
        v-if="showConflict"
        data-support-state="conflict"
        role="alert"
        class="mt-4 border border-amber-300 bg-amber-50 px-4 py-3 font-sans text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {{ t("admin.support.conflict") }}
      </p>

      <button
        v-if="canAnswer"
        type="button"
        data-support-card-answer
        class="mt-5 min-h-11 border border-zinc-950 px-4 font-sans text-sm font-semibold text-zinc-950 disabled:opacity-40 dark:border-zinc-100 dark:text-zinc-100"
        :disabled="actionPending"
        @click="submitAnswer">
        {{ t("admin.support.markAnswered") }}
      </button>
    </article>
  </section>
</template>
