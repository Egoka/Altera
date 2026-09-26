<script setup lang="ts">
  import { computed, ref } from "vue"
  import type { AdminMailCard } from "~/composables/useAdminMail"

  const { t } = useI18n()
  const route = useRoute()
  const { loadCard, resend, requestId, errorCode, actionPending } = useAdminMail()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const id = computed(() => String(route.params.id))
  const resent = ref(false)

  const {
    data: mail,
    pending: loading,
    error,
    refresh
  } = useAsyncData<AdminMailCard | null>(`admin-mail-${id.value}`, () => loadCard(id.value), {
    default: () => null,
    lazy: true,
    server: false,
    watch: [id]
  })

  const showConflict = computed(() => errorCode.value === "CONFLICT")
  // `canResend` с сервера уже учитывает право `job.retry`, статус письма и прошлый повтор (§5).
  const canResend = computed(() => mail.value?.canResend === true && !resent.value)

  const submitResend = async () => {
    const result = await resend(id.value)
    if (result) {
      resent.value = true
      await refresh()
    }
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
    aria-labelledby="mail-card-title">
    <NuxtLink to="/admin/mail" class="font-sans text-sm underline underline-offset-4">
      {{ t("admin.mail.backToList") }}
    </NuxtLink>

    <div v-if="loading" data-mail-state="loading" aria-busy="true" :aria-label="t('admin.mail.loading')" class="mt-6">
      <span class="sr-only">{{ t("admin.mail.loading") }}</span>
      <div
        v-for="row in 4"
        :key="row"
        class="mb-2 h-11 animate-pulse bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800"></div>
    </div>

    <div
      v-else-if="error || !mail"
      data-mail-state="error"
      role="alert"
      class="mt-6 border border-red-300 bg-white px-4 py-8 text-center font-sans text-sm dark:border-red-900 dark:bg-zinc-900">
      <p class="text-zinc-900 dark:text-zinc-100">{{ t("admin.mail.loadError") }}</p>
      <p v-if="requestId" class="mt-2 font-mono text-xs text-zinc-500">requestId: {{ requestId }}</p>
    </div>

    <article v-else data-mail-card class="mt-6">
      <h1 id="mail-card-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">{{ mail.subject }}</h1>

      <dl class="mt-5 grid grid-cols-1 gap-4 font-sans text-sm sm:grid-cols-2">
        <div>
          <dt class="text-zinc-500">{{ t("admin.mail.columnRecipient") }}</dt>
          <dd data-mail-recipient class="text-zinc-900 dark:text-zinc-100">
            {{ mail.recipientEmail ?? mail.recipientHandle ?? t("admin.mail.recipientHidden") }}
          </dd>
        </div>
        <div>
          <dt class="text-zinc-500">{{ t("admin.mail.columnTemplate") }}</dt>
          <dd class="text-zinc-900 dark:text-zinc-100">{{ mail.template }}</dd>
        </div>
        <div>
          <dt class="text-zinc-500">{{ t("admin.mail.columnStatus") }}</dt>
          <dd data-mail-status class="text-zinc-900 dark:text-zinc-100">
            {{ t(`admin.mail.status.${mail.status}`) }}
          </dd>
        </div>
        <div>
          <dt class="text-zinc-500">{{ t("admin.mail.columnProvider") }}</dt>
          <dd class="text-zinc-900 dark:text-zinc-100">{{ mail.provider ?? "—" }}</dd>
        </div>
        <div>
          <dt class="text-zinc-500">{{ t("admin.mail.queuedAt") }}</dt>
          <dd class="text-zinc-900 dark:text-zinc-100">{{ formatDate(mail.queuedAt) }}</dd>
        </div>
        <div>
          <dt class="text-zinc-500">{{ t("admin.mail.sentAt") }}</dt>
          <dd class="text-zinc-900 dark:text-zinc-100">{{ formatDate(mail.sentAt) }}</dd>
        </div>
        <div v-if="mail.deliveryErrorClass">
          <dt class="text-zinc-500">{{ t("admin.mail.errorClass") }}</dt>
          <dd class="font-mono text-zinc-900 dark:text-zinc-100">{{ mail.deliveryErrorClass }}</dd>
        </div>
        <div v-if="mail.messageId">
          <dt class="text-zinc-500">messageId</dt>
          <dd class="font-mono text-zinc-900 dark:text-zinc-100">{{ mail.messageId }}</dd>
        </div>
      </dl>

      <h2 class="mt-8 font-serif text-xl text-zinc-950 dark:text-zinc-50">{{ t("admin.mail.bodyTitle") }}</h2>
      <pre
        v-if="mail.body"
        data-mail-body
        class="mt-3 whitespace-pre-wrap border border-zinc-300 bg-white p-4 font-sans text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >{{ mail.body }}</pre
      >
      <p v-else data-mail-body-hidden class="mt-3 font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.mail.bodyHidden") }}
      </p>

      <h2 class="mt-8 font-serif text-xl text-zinc-950 dark:text-zinc-50">{{ t("admin.mail.eventsTitle") }}</h2>
      <ul data-mail-events class="mt-3 font-sans text-sm">
        <li
          v-for="event in mail.deliveryEvents"
          :key="event.id"
          class="border-b border-zinc-200 py-2 dark:border-zinc-800">
          {{ formatDate(event.occurredAt) }} — {{ t(`admin.mail.status.${event.status}`) }}
          <span v-if="event.errorClass" class="font-mono text-xs text-zinc-500">{{ event.errorClass }}</span>
        </li>
      </ul>

      <p
        v-if="showConflict"
        data-mail-state="conflict"
        role="alert"
        class="mt-6 border border-amber-300 bg-amber-50 px-4 py-3 font-sans text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {{ t("admin.mail.conflict") }}
      </p>

      <button
        v-if="canResend"
        type="button"
        data-mail-resend
        class="mt-6 min-h-11 border border-zinc-950 px-4 font-sans text-sm font-semibold dark:border-zinc-100"
        :disabled="actionPending"
        @click="submitResend">
        {{ t("admin.mail.resend") }}
      </button>
    </article>
  </section>
</template>
