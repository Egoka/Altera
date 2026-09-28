<script setup lang="ts">
  import { computed, ref } from "vue"
  import type { AdminUserAuditEntry, AdminUserCard } from "~/composables/useAdminUsers"
  import { ARCHIVE_REASON_CATEGORIES, type ArchiveReasonCategory } from "~/utils/admin"

  /**
   * Карточка пользователя (`docs/spec/40-admin/users.md` §3, §5, §7, §9) и шаги 1–2 flow #11.
   * Открытие карточки — чтение персональных данных: запись `admin.read.personal` делает сервер.
   * Опасные действия закрыты модальным окном с причиной, числом статей и предупреждением о плане.
   */
  const { t } = useI18n()
  const route = useRoute()
  const { loadCard, loadAudit, archive, restore, revokeSessions, changeEmail, requestId, errorCode, actionPending } =
    useAdminUser()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-users"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const id = computed(() => String(route.params.id))

  const {
    data: card,
    pending: loading,
    error,
    refresh
  } = useAsyncData<AdminUserCard | null>(`admin-user-${id.value}`, () => loadCard(id.value), {
    default: () => null,
    lazy: true,
    server: false,
    watch: [id]
  })

  const { data: audit, refresh: refreshAudit } = useAsyncData<AdminUserAuditEntry[]>(
    `admin-user-audit-${id.value}`,
    () => loadAudit(id.value),
    { default: () => [], lazy: true, server: false, watch: [id] }
  )

  type Dialog = "archive" | "emergency" | "restore" | "sessions" | "email"
  const dialog = ref<Dialog | null>(null)
  const reasonCategory = ref<ArchiveReasonCategory>("rules_violation")
  const publicMessage = ref("")
  const internalReason = ref("")
  const restoreReason = ref("")
  const newEmail = ref("")
  const emailReason = ref("")
  const notice = ref<string | null>(null)

  const open = (next: Dialog) => {
    notice.value = null
    errorCode.value = null
    dialog.value = next
  }
  const close = () => {
    dialog.value = null
  }

  const showConflict = computed(() => errorCode.value === "CONFLICT")
  const showValidation = computed(() => errorCode.value === "VALIDATION_ERROR")
  const activeArticles = computed(() =>
    card.value ? card.value.articleStats.total - card.value.articleStats.archived : 0
  )
  const planWarning = computed(() => {
    if (!card.value) return null
    const until = card.value.plan.until
    return until ? t("admin.users.planWarning", { date: formatDate(until) }) : t("admin.users.planWarningNone")
  })

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

  const afterChange = async (message: string) => {
    close()
    notice.value = message
    await Promise.all([refresh(), refreshAudit()])
  }

  const submitArchive = async (mode: "admin" | "emergency") => {
    const result = await archive({
      id: id.value,
      reasonCategory: reasonCategory.value,
      internalReason: internalReason.value,
      publicMessage: publicMessage.value,
      mode
    })
    if (result) {
      internalReason.value = ""
      publicMessage.value = ""
      await afterChange(t(mode === "emergency" ? "admin.users.emergencyDone" : "admin.users.archiveDone"))
    }
  }

  const submitRestore = async () => {
    const result = await restore({ id: id.value, reason: restoreReason.value })
    if (result) {
      restoreReason.value = ""
      await afterChange(t("admin.users.restoreDone"))
    }
  }

  const submitRevoke = async () => {
    const result = await revokeSessions(id.value)
    if (result) {
      await afterChange(t("admin.users.sessionsDone", { count: result.revokeUserSessions.revokedCount }))
    }
  }

  const submitEmail = async () => {
    const result = await changeEmail({ id: id.value, newEmail: newEmail.value, reason: emailReason.value })
    if (result) {
      newEmail.value = ""
      emailReason.value = ""
      await afterChange(t("admin.users.emailDone", { email: result.adminChangeEmail.emailMasked }))
    }
  }
</script>

<template>
  <section
    class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="user-card-title">
    <NuxtLink to="/admin/users" class="font-sans text-sm underline underline-offset-4">
      {{ t("admin.users.backToList") }}
    </NuxtLink>

    <div v-if="loading" data-users-state="loading" aria-busy="true" :aria-label="t('admin.users.loading')" class="mt-6">
      <span class="sr-only">{{ t("admin.users.loading") }}</span>
      <div
        v-for="row in 4"
        :key="row"
        class="mb-2 h-11 animate-pulse bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800"></div>
    </div>

    <div
      v-else-if="error || !card"
      data-users-state="error"
      role="alert"
      class="mt-6 border border-red-300 bg-white px-4 py-8 text-center font-sans text-sm dark:border-red-900 dark:bg-zinc-900">
      <p class="text-zinc-900 dark:text-zinc-100">{{ t("admin.users.cardError") }}</p>
      <p v-if="requestId" class="mt-2 font-mono text-xs text-zinc-500">requestId: {{ requestId }}</p>
      <button
        type="button"
        class="mt-4 min-h-11 border border-zinc-950 px-4 font-sans text-sm font-semibold dark:border-zinc-100"
        @click="refresh()">
        {{ t("admin.users.retry") }}
      </button>
    </div>

    <article v-else class="mt-6 max-w-4xl" :data-users-card="card.id" :data-users-status="card.status">
      <h1 id="user-card-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">{{ card.name }}</h1>
      <p class="mt-1 font-sans text-sm text-zinc-500">@{{ card.handle }}</p>

      <p
        v-if="!card.canArchive && !card.canRestore && !card.canRevokeSessions"
        data-users-readonly-note
        class="mt-4 font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.users.readOnlyCardNote") }}
      </p>

      <p
        v-if="notice"
        data-users-notice
        role="status"
        class="mt-5 bg-white px-4 py-3 font-sans text-sm text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
        {{ notice }}
      </p>

      <p
        v-if="showConflict"
        data-users-state="conflict"
        role="alert"
        class="mt-5 bg-amber-50 px-4 py-3 font-sans text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        {{ t("admin.users.conflict") }}
      </p>

      <p
        v-if="showValidation"
        data-users-state="validation"
        role="alert"
        class="mt-5 bg-amber-50 px-4 py-3 font-sans text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        {{ t("admin.users.validation") }}
      </p>

      <dl class="mt-7 grid grid-cols-1 gap-3 font-sans text-sm sm:grid-cols-[14rem_minmax(0,1fr)]">
        <dt class="text-zinc-500">{{ t("admin.users.columnEmail") }}</dt>
        <dd data-users-card-email class="text-zinc-900 dark:text-zinc-100">{{ card.email }}</dd>

        <dt class="text-zinc-500">{{ t("admin.users.columnRole") }}</dt>
        <dd class="text-zinc-900 dark:text-zinc-100">{{ t(`admin.users.role.${card.role}`) }}</dd>

        <dt class="text-zinc-500">{{ t("admin.users.columnPlan") }}</dt>
        <dd data-users-card-plan class="text-zinc-900 dark:text-zinc-100">
          {{ t(`admin.users.planState.${card.plan.state}`, { tier: t(`admin.users.tier.${card.plan.tier}`) }) }}
          <span v-if="card.plan.until"> · {{ formatDate(card.plan.until) }}</span>
        </dd>

        <dt class="text-zinc-500">{{ t("admin.users.baseAuthorship") }}</dt>
        <dd data-users-card-authorship class="text-zinc-900 dark:text-zinc-100">
          <template v-if="card.baseAuthorship.enabled">
            {{ t("admin.users.baseAuthorshipOn", { date: formatDate(card.baseAuthorship.enabledAt) }) }}
          </template>
          <template v-else>{{ t("admin.users.baseAuthorshipOff") }}</template>
        </dd>

        <dt class="text-zinc-500">{{ t("admin.users.columnStatus") }}</dt>
        <dd data-users-card-status class="text-zinc-900 dark:text-zinc-100">
          <template v-if="card.status === 'active'">{{ t("admin.users.status.active") }}</template>
          <template v-else>{{ t(`admin.users.archiveMode.${card.archiveMode ?? "admin"}`) }}</template>
        </dd>

        <dt class="text-zinc-500">{{ t("admin.users.columnRegistered") }}</dt>
        <dd class="text-zinc-900 dark:text-zinc-100">{{ formatDate(card.createdAt) }}</dd>

        <dt class="text-zinc-500">{{ t("admin.users.columnLastActive") }}</dt>
        <dd class="text-zinc-900 dark:text-zinc-100">{{ formatDate(card.lastActiveAt) }}</dd>

        <dt class="text-zinc-500">{{ t("admin.users.locale") }}</dt>
        <dd class="text-zinc-900 dark:text-zinc-100">{{ card.locale }}</dd>

        <dt class="text-zinc-500">{{ t("admin.users.profileChecks") }}</dt>
        <dd class="text-zinc-900 dark:text-zinc-100">
          {{ t(`admin.users.check.${card.nameCheckStatus}`) }} · {{ t(`admin.users.check.${card.avatarCheckStatus}`) }}
        </dd>

        <template v-if="card.archivedAt">
          <dt class="text-zinc-500">{{ t("admin.users.archivedAt") }}</dt>
          <dd data-users-card-archived class="text-zinc-900 dark:text-zinc-100">
            {{ formatDate(card.archivedAt) }}
            <span v-if="card.archivedByName"> — {{ card.archivedByName }}</span>
            <span v-if="card.archivedByRole"> ({{ t(`admin.users.role.${card.archivedByRole}`) }})</span>
          </dd>

          <template v-if="card.archiveReasonCategory">
            <dt class="text-zinc-500">{{ t("admin.users.reasonCategoryLabel") }}</dt>
            <dd data-users-card-category class="text-zinc-900 dark:text-zinc-100">
              {{ t(`admin.users.reasonCategory.${card.archiveReasonCategory}`) }}
            </dd>
          </template>

          <template v-if="card.archivePublicMessage">
            <dt class="text-zinc-500">{{ t("admin.users.publicMessageLabel") }}</dt>
            <dd data-users-card-public-message class="text-zinc-900 dark:text-zinc-100">
              {{ card.archivePublicMessage }}
            </dd>
          </template>

          <template v-if="card.archiveInternalReason">
            <dt class="text-zinc-500">{{ t("admin.users.internalReasonLabel") }}</dt>
            <dd data-users-card-internal-reason class="text-zinc-900 dark:text-zinc-100">
              {{ card.archiveInternalReason }}
            </dd>
          </template>
        </template>
      </dl>

      <h2 class="mt-8 font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {{ t("admin.users.articlesTitle") }}
      </h2>
      <p data-users-card-stats class="mt-2 font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{
          t("admin.users.articleStats", {
            total: card.articleStats.total,
            published: card.articleStats.published,
            draft: card.articleStats.draft,
            review: card.articleStats.review,
            archived: card.articleStats.archived
          })
        }}
      </p>
      <ul v-if="card.articles.length" class="mt-3 font-sans text-sm">
        <li
          v-for="article in card.articles"
          :key="article.id"
          :data-users-article="article.id"
          :data-users-article-status="article.status"
          class="py-1">
          <NuxtLink :to="`/admin/articles/${article.slug}`" class="underline underline-offset-4">
            {{ article.title }}
          </NuxtLink>
          <span class="text-zinc-500">
            · {{ t(`admin.users.articleStatus.${article.status}`) }} · {{ article.locale }} ·
            {{ formatDate(article.createdAt) }}
          </span>
          <span v-if="article.archivedByStaff" data-users-article-staff-archived class="text-zinc-500">
            · {{ t("admin.users.archivedByStaff") }}
          </span>
        </li>
      </ul>

      <template v-if="card.sessions">
        <h2 class="mt-8 font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("admin.users.sessionsTitle") }}
        </h2>
        <p v-if="!card.sessions.length" data-users-sessions-empty class="mt-2 font-sans text-sm text-zinc-600">
          {{ t("admin.users.sessionsEmpty") }}
        </p>
        <ul v-else class="mt-2 font-sans text-sm">
          <li v-for="session in card.sessions" :key="session.id" :data-users-session="session.id" class="py-1">
            {{ t(`admin.users.device.${session.deviceClass}`) }} · {{ session.browserClass }} ·
            {{ formatDate(session.lastActiveAt) }}
          </li>
        </ul>
      </template>

      <template v-if="card.consents.length">
        <h2 class="mt-8 font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("admin.users.consentsTitle") }}
        </h2>
        <ul class="mt-2 font-sans text-sm">
          <li v-for="consent in card.consents" :key="`${consent.kind}-${consent.version}`" class="py-1">
            {{ consent.kind }} v{{ consent.version }} · {{ consent.locale }} · {{ formatDate(consent.acceptedAt) }}
          </li>
        </ul>
      </template>

      <template v-if="audit.length">
        <h2 class="mt-8 font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("admin.users.auditTitle") }}
        </h2>
        <ul data-users-audit class="mt-2 font-sans text-sm">
          <li v-for="entry in audit" :key="entry.id" :data-users-audit-action="entry.action" class="py-1">
            {{ entry.action }} · {{ formatDate(entry.createdAt) }}
            <span v-if="entry.actor.name" class="text-zinc-500"> · {{ entry.actor.name }}</span>
          </li>
        </ul>
      </template>

      <div v-if="card.canArchive || card.canRestore || card.canRevokeSessions" class="mt-9 flex flex-wrap gap-3">
        <button
          v-if="card.canArchive"
          type="button"
          data-users-open-archive
          class="min-h-11 border border-zinc-950 px-4 font-sans text-sm font-semibold text-zinc-950 dark:border-zinc-100 dark:text-zinc-100"
          @click="open('archive')">
          {{ t("admin.users.archiveAction") }}
        </button>
        <button
          v-if="card.canArchive"
          type="button"
          data-users-open-emergency
          class="min-h-11 border border-red-700 px-4 font-sans text-sm font-semibold text-red-700 dark:border-red-400 dark:text-red-300"
          @click="open('emergency')">
          {{ t("admin.users.emergencyAction") }}
        </button>
        <button
          v-if="card.canRestore"
          type="button"
          data-users-open-restore
          class="min-h-11 border border-zinc-950 px-4 font-sans text-sm font-semibold text-zinc-950 dark:border-zinc-100 dark:text-zinc-100"
          @click="open('restore')">
          {{ t("admin.users.restoreAction") }}
        </button>
        <button
          v-if="card.canRevokeSessions"
          type="button"
          data-users-open-sessions
          class="min-h-11 border border-zinc-300 px-4 font-sans text-sm dark:border-zinc-700"
          @click="open('sessions')">
          {{ t("admin.users.revokeSessionsAction") }}
        </button>
        <button
          v-if="card.canChangeEmail"
          type="button"
          data-users-open-email
          class="min-h-11 border border-zinc-300 px-4 font-sans text-sm dark:border-zinc-700"
          @click="open('email')">
          {{ t("admin.users.changeEmailAction") }}
        </button>
      </div>

      <div
        v-if="dialog === 'archive' || dialog === 'emergency'"
        :data-users-dialog="dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t(dialog === 'emergency' ? 'admin.users.emergencyAction' : 'admin.users.archiveAction')"
        class="mt-7 bg-white px-4 py-5 font-sans text-sm dark:bg-zinc-900">
        <h2 class="font-sans text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {{ t(dialog === "emergency" ? "admin.users.emergencyAction" : "admin.users.archiveAction") }}
        </h2>
        <p data-users-dialog-articles class="mt-3 text-zinc-700 dark:text-zinc-300">
          {{ t("admin.users.archiveArticlesWarning", { count: activeArticles }) }}
        </p>
        <p data-users-dialog-plan class="mt-2 text-zinc-700 dark:text-zinc-300">{{ planWarning }}</p>
        <p v-if="dialog === 'emergency'" data-users-dialog-emergency class="mt-2 text-red-700 dark:text-red-300">
          {{ t("admin.users.emergencyWarning") }}
        </p>

        <label class="mt-4 block text-xs text-zinc-500" for="archive-category">
          {{ t("admin.users.reasonCategoryLabel") }}
        </label>
        <select
          id="archive-category"
          v-model="reasonCategory"
          data-users-reason-category
          class="mt-1 min-h-11 w-full border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950">
          <option v-for="value in ARCHIVE_REASON_CATEGORIES" :key="value" :value="value">
            {{ t(`admin.users.reasonCategory.${value}`) }}
          </option>
        </select>

        <label class="mt-4 block text-xs text-zinc-500" for="archive-public-message">
          {{ t("admin.users.publicMessageLabel") }}
        </label>
        <textarea
          id="archive-public-message"
          v-model="publicMessage"
          data-users-public-message
          rows="2"
          :placeholder="t('admin.users.publicMessageHint')"
          class="mt-1 w-full border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"></textarea>

        <label class="mt-4 block text-xs text-zinc-500" for="archive-internal-reason">
          {{ t("admin.users.internalReasonLabel") }}
        </label>
        <textarea
          id="archive-internal-reason"
          v-model="internalReason"
          data-users-internal-reason
          rows="2"
          :placeholder="t('admin.users.internalReasonHint')"
          class="mt-1 w-full border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"></textarea>

        <div class="mt-5 flex gap-3">
          <button
            type="button"
            data-users-confirm-archive
            class="min-h-11 border border-zinc-950 px-4 font-semibold text-zinc-950 disabled:opacity-40 dark:border-zinc-100 dark:text-zinc-100"
            :disabled="actionPending"
            @click="submitArchive(dialog === 'emergency' ? 'emergency' : 'admin')">
            {{ t("admin.users.confirm") }}
          </button>
          <button
            type="button"
            data-users-cancel
            class="min-h-11 border border-zinc-300 px-4 dark:border-zinc-700"
            @click="close">
            {{ t("admin.users.cancel") }}
          </button>
        </div>
      </div>

      <div
        v-if="dialog === 'restore'"
        data-users-dialog="restore"
        role="dialog"
        aria-modal="true"
        :aria-label="t('admin.users.restoreAction')"
        class="mt-7 bg-white px-4 py-5 font-sans text-sm dark:bg-zinc-900">
        <h2 class="font-sans text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {{ t("admin.users.restoreAction") }}
        </h2>
        <p data-users-dialog-articles-stay class="mt-3 text-zinc-700 dark:text-zinc-300">
          {{ t("admin.users.restoreArticlesNote") }}
        </p>
        <label class="mt-4 block text-xs text-zinc-500" for="restore-reason">{{ t("admin.users.reasonLabel") }}</label>
        <textarea
          id="restore-reason"
          v-model="restoreReason"
          data-users-restore-reason
          rows="2"
          class="mt-1 w-full border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"></textarea>
        <div class="mt-5 flex gap-3">
          <button
            type="button"
            data-users-confirm-restore
            class="min-h-11 border border-zinc-950 px-4 font-semibold text-zinc-950 disabled:opacity-40 dark:border-zinc-100 dark:text-zinc-100"
            :disabled="actionPending"
            @click="submitRestore">
            {{ t("admin.users.confirm") }}
          </button>
          <button
            type="button"
            data-users-cancel
            class="min-h-11 border border-zinc-300 px-4 dark:border-zinc-700"
            @click="close">
            {{ t("admin.users.cancel") }}
          </button>
        </div>
      </div>

      <div
        v-if="dialog === 'sessions'"
        data-users-dialog="sessions"
        role="dialog"
        aria-modal="true"
        :aria-label="t('admin.users.revokeSessionsAction')"
        class="mt-7 bg-white px-4 py-5 font-sans text-sm dark:bg-zinc-900">
        <h2 class="font-sans text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {{ t("admin.users.revokeSessionsAction") }}
        </h2>
        <p class="mt-3 text-zinc-700 dark:text-zinc-300">{{ t("admin.users.revokeSessionsNote") }}</p>
        <div class="mt-5 flex gap-3">
          <button
            type="button"
            data-users-confirm-sessions
            class="min-h-11 border border-zinc-950 px-4 font-semibold text-zinc-950 disabled:opacity-40 dark:border-zinc-100 dark:text-zinc-100"
            :disabled="actionPending"
            @click="submitRevoke">
            {{ t("admin.users.confirm") }}
          </button>
          <button
            type="button"
            data-users-cancel
            class="min-h-11 border border-zinc-300 px-4 dark:border-zinc-700"
            @click="close">
            {{ t("admin.users.cancel") }}
          </button>
        </div>
      </div>

      <div
        v-if="dialog === 'email'"
        data-users-dialog="email"
        role="dialog"
        aria-modal="true"
        :aria-label="t('admin.users.changeEmailAction')"
        class="mt-7 bg-white px-4 py-5 font-sans text-sm dark:bg-zinc-900">
        <h2 class="font-sans text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {{ t("admin.users.changeEmailAction") }}
        </h2>
        <p class="mt-3 text-zinc-700 dark:text-zinc-300">{{ t("admin.users.changeEmailNote") }}</p>
        <label class="mt-4 block text-xs text-zinc-500" for="new-email">{{ t("admin.users.newEmailLabel") }}</label>
        <input
          id="new-email"
          v-model="newEmail"
          data-users-new-email
          type="email"
          class="mt-1 min-h-11 w-full border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
        <label class="mt-4 block text-xs text-zinc-500" for="email-reason">{{ t("admin.users.reasonLabel") }}</label>
        <textarea
          id="email-reason"
          v-model="emailReason"
          data-users-email-reason
          rows="2"
          class="mt-1 w-full border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"></textarea>
        <div class="mt-5 flex gap-3">
          <button
            type="button"
            data-users-confirm-email
            class="min-h-11 border border-zinc-950 px-4 font-semibold text-zinc-950 disabled:opacity-40 dark:border-zinc-100 dark:text-zinc-100"
            :disabled="actionPending"
            @click="submitEmail">
            {{ t("admin.users.confirm") }}
          </button>
          <button
            type="button"
            data-users-cancel
            class="min-h-11 border border-zinc-300 px-4 dark:border-zinc-700"
            @click="close">
            {{ t("admin.users.cancel") }}
          </button>
        </div>
      </div>
    </article>
  </section>
</template>
