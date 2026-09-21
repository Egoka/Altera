<script setup lang="ts">
  import {
    GetMySessionsDocument,
    LogoutSessionDocument,
    RevokeAllSessionsDocument,
    RevokeSessionDocument,
    type AccountSessionFieldsFragment
  } from "~/graphql/generated/graphql"
  import SessionRow from "~/components/me/SessionRow.vue"

  definePageMeta({
    i18n: false,
    layout: "auth",
    requiresAuth: true
  })

  // Спецификация: docs/spec/30-account/reader/sessions.md. Таблица состояний — §8.
  type PageState = "loading" | "data_error" | "ready"
  type Notice = "revoked" | "alreadyRevoked" | "revokedAll" | null

  interface GraphQLErrorLike {
    extensions?: Record<string, unknown> | null
  }

  interface GraphQLEnvelope<T> {
    data?: T | null
    errors?: readonly GraphQLErrorLike[]
  }

  const { t } = useI18n()

  useHead({
    title: () => `${t("account.sessions.pageTitle")} — Altera`,
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })

  const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string) => errors?.[0]?.extensions?.[key]

  /**
   * Гость уходит на вход, ограниченная сессия — на экран состояния (§3, §8).
   * Возвращает `true`, когда уход уже начат и обрабатывать отказ больше не нужно.
   */
  const leaveOnAccessFailure = async (errors: readonly GraphQLErrorLike[] | undefined): Promise<boolean> => {
    const code = readExtension(errors, "code")
    if (code === "FORBIDDEN") {
      await navigateTo("/me/archived", { replace: true, redirectCode: 302 })
      return true
    }
    if (code === "UNAUTHENTICATED") {
      await navigateTo({ path: "/login", query: { next: "/me/sessions" } }, { replace: true, redirectCode: 302 })
      return true
    }

    return false
  }

  const fetchSessions = async (): Promise<AccountSessionFieldsFragment[]> => {
    const envelope = (await useGraphQL(GetMySessionsDocument)) as GraphQLEnvelope<{
      me: { id: string; sessions: AccountSessionFieldsFragment[] } | null
    }>

    if (!envelope.data?.me) {
      if (await leaveOnAccessFailure(envelope.errors)) return []
      throw createError({ statusCode: 500, statusMessage: "sessions" })
    }

    return envelope.data.me.sessions
  }

  const { data, status, error, refresh } = await useAsyncData("my-sessions", fetchSessions, { server: false })

  const sessions = ref<AccountSessionFieldsFragment[] | null>(null)
  watch(data, (next) => (sessions.value = next ?? sessions.value), { immediate: true })

  const pageState = computed<PageState>(() => {
    if (error.value) return "data_error"
    if (!sessions.value || status.value === "pending") return "loading"
    return "ready"
  })

  const current = computed(() => sessions.value?.find((session) => session.isCurrent) ?? null)
  const others = computed(() => sessions.value?.filter((session) => !session.isCurrent) ?? [])

  const busyId = ref<string | null>(null)
  const leavingEverywhere = ref(false)
  const confirmOpen = ref(false)
  const notice = ref<Notice>(null)
  const revokedCount = ref(0)
  const requestId = ref<string | null>(null)
  const failed = ref(false)

  const busy = computed(() => busyId.value !== null || leavingEverywhere.value)
  const noticeMessage = computed(() => {
    if (notice.value === "revokedAll") return t("account.sessions.revokedAll", { count: revokedCount.value })
    return notice.value ? t(`account.sessions.${notice.value}`) : null
  })
  const errorMessage = computed(() =>
    failed.value ? t("account.sessions.error.generic", { requestId: requestId.value ?? "—" }) : null
  )

  const drop = (id: string) => {
    sessions.value = (sessions.value ?? []).filter((session) => session.id !== id)
  }

  async function run<T>(
    call: () => Promise<GraphQLEnvelope<T>>,
    apply: (payload: T) => void | Promise<void>
  ): Promise<void> {
    failed.value = false
    requestId.value = null

    try {
      const envelope = await call()
      if (envelope.data) {
        await apply(envelope.data)
        return
      }

      if (await leaveOnAccessFailure(envelope.errors)) return
      const id = readExtension(envelope.errors, "requestId")
      requestId.value = typeof id === "string" ? id : null
      throw new Error(String(readExtension(envelope.errors, "code") ?? "INTERNAL_ERROR"))
    } catch (cause) {
      // Отзыв уже отозванной строки — не отказ экрана: строка убирается с уведомлением (§8).
      if (cause instanceof Error && cause.message === "NOT_FOUND") throw cause
      failed.value = true
      throw cause
    }
  }

  const revoke = async (id: string) => {
    if (busy.value) return
    busyId.value = id
    notice.value = null

    try {
      await run(
        () => useGraphQL(RevokeSessionDocument, { id }),
        () => {
          drop(id)
          notice.value = "revoked"
        }
      )
    } catch (cause) {
      if (cause instanceof Error && cause.message === "NOT_FOUND") {
        drop(id)
        notice.value = "alreadyRevoked"
      }
    } finally {
      busyId.value = null
    }
  }

  const revokeAll = async () => {
    if (busy.value) return
    leavingEverywhere.value = true
    confirmOpen.value = false
    notice.value = null

    try {
      await run(
        () => useGraphQL(RevokeAllSessionsDocument),
        (payload) => {
          revokedCount.value = payload.revokeAllSessions.revokedCount
          sessions.value = (sessions.value ?? []).filter((session) => session.isCurrent)
          notice.value = "revokedAll"
        }
      )
    } catch {
      // Сообщение об отказе уже выставлено в `run`.
    } finally {
      leavingEverywhere.value = false
    }
  }

  const logout = async () => {
    if (busy.value) return
    leavingEverywhere.value = true

    try {
      await run(
        () => useGraphQL(LogoutSessionDocument),
        // Cookie стирает маршрут BFF, поэтому уход выполняется полным переходом (§7).
        async () => {
          await navigateTo("/", { replace: true, external: true })
        }
      )
    } catch {
      // Сообщение об отказе уже выставлено в `run`.
    } finally {
      leavingEverywhere.value = false
    }
  }
</script>

<template>
  <section class="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-16" :data-sessions-state="pageState">
    <h1 class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">{{ t("account.sessions.pageTitle") }}</h1>

    <div v-if="pageState === 'loading'" data-testid="sessions-skeleton" class="flex flex-col gap-4">
      <span class="h-4 w-64 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      <span class="h-11 w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      <span class="h-11 w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>

    <div
      v-else-if="pageState === 'data_error'"
      role="alert"
      data-testid="sessions-data-error"
      class="flex flex-col gap-3">
      <p class="font-sans text-base text-zinc-900 dark:text-zinc-100">
        {{ t("account.sessions.error.dataUnavailable") }}
      </p>
      <button
        type="button"
        data-testid="sessions-retry"
        class="self-start border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 hover:border-orange-600 hover:text-orange-700 dark:text-zinc-400"
        @click="refresh()">
        {{ t("account.sessions.retry") }}
      </button>
    </div>

    <template v-else>
      <p class="font-sans text-base text-zinc-700 dark:text-zinc-300" data-testid="sessions-intro">
        {{ t("account.sessions.intro") }}
      </p>

      <p
        v-if="noticeMessage"
        role="status"
        data-testid="sessions-notice"
        class="font-sans text-base text-zinc-900 dark:text-zinc-100">
        {{ noticeMessage }}
      </p>
      <p v-if="errorMessage" role="alert" data-testid="sessions-error" class="font-sans text-base text-orange-700">
        {{ errorMessage }}
      </p>

      <div v-if="current" class="flex flex-col gap-2">
        <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("account.sessions.currentTitle") }}
        </h2>
        <ul class="flex flex-col">
          <SessionRow :session="current" :busy="busy" @logout="logout" />
        </ul>
      </div>

      <div class="flex flex-col gap-2">
        <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("account.sessions.othersTitle") }}
        </h2>
        <ul v-if="others.length" class="flex flex-col" data-testid="sessions-others">
          <SessionRow
            v-for="session in others"
            :key="session.id"
            :session="session"
            :busy="busyId === session.id || leavingEverywhere"
            @revoke="revoke" />
        </ul>
        <p v-else data-testid="sessions-empty" class="font-sans text-base text-zinc-600 dark:text-zinc-400">
          {{ t("account.sessions.empty") }}
        </p>
      </div>

      <button
        v-if="others.length"
        type="button"
        data-testid="sessions-logout-all"
        :disabled="busy"
        class="self-start border-b border-orange-600 pb-0.5 font-sans text-sm text-zinc-950 transition-colors hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none dark:text-zinc-50"
        @click="confirmOpen = true">
        {{ t("account.sessions.logoutAll") }}
      </button>

      <ConfirmDialog
        :open="confirmOpen"
        :title="t('account.sessions.logoutAllConfirmTitle')"
        :body="t('account.sessions.logoutAllConfirmBody')"
        :confirm-label="t('account.sessions.logoutAll')"
        :cancel-label="t('account.sessions.cancel')"
        :busy="leavingEverywhere"
        testid="sessions-confirm"
        @confirm="revokeAll"
        @cancel="confirmOpen = false" />

      <aside class="flex flex-col gap-2 font-sans text-sm text-zinc-600 dark:text-zinc-400">
        <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("account.sessions.securityTitle") }}
        </h2>
        <NuxtLink
          to="/me/email"
          data-testid="sessions-change-email"
          class="self-start border-b border-orange-600 text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
          {{ t("account.sessions.changeEmail") }}
        </NuxtLink>
        <!-- Страница обращений — отдельная задача; адрес зафиксирован реестром маршрутов #14. -->
        <a
          href="/contact?topic=account_security"
          data-testid="sessions-contact"
          class="self-start border-b border-orange-600 text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
          {{ t("account.sessions.contact") }}
        </a>
      </aside>
    </template>
  </section>
</template>
