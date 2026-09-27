<script setup lang="ts">
  import {
    GetAccountArchiveStateDocument,
    LogoutSessionDocument,
    RestoreAccountSelfDocument,
    type GetAccountArchiveStateQuery
  } from "~/graphql/generated/graphql"
  import { accountRestoreErrorKind, type AccountRestoreErrorKind } from "~/utils/accountArchive"
  import type { AccountDashboard } from "~/middleware/account-dashboard"
  import StateScreen from "~/components/service/StateScreen.vue"
  import SubscriptionStatus from "~/components/me/SubscriptionStatus.vue"

  /**
   * Экран состояния архивированного аккаунта (`docs/spec/30-account/reader/archived-state.md`).
   * Единственный экран ограниченной сессии (`50-access/session-lifecycle.md` п. 7), поэтому
   * своя разметка без меню кабинета: шапка статическая, вход и «Писать» в ней скрыты.
   * Таблица состояний — §8.
   */
  definePageMeta({
    i18n: false,
    layout: false,
    requiresAuth: true
  })

  type PageState = "loading" | "data_error" | "blocked" | "ready"
  type ArchiveState = NonNullable<GetAccountArchiveStateQuery["me"]>["archiveState"]

  interface GraphQLErrorLike {
    extensions?: Record<string, unknown> | null
  }

  interface GraphQLEnvelope<T> {
    data?: T | null
    errors?: readonly GraphQLErrorLike[]
  }

  const { t, locale } = useI18n()

  useHead({
    title: () => `${t("account.archived.pageTitle")} — Altera`,
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })

  const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string) => errors?.[0]?.extensions?.[key]

  /**
   * Итог чтения состояния (§3, §8): обычная сессия уходит в кабинет, гость — на вход, а
   * административно архивированный аккаунт остаётся здесь отдельной строкой «Заблокирован» —
   * кабинет вернул бы его сюда, и страницы гоняли бы друг друга редиректами.
   */
  type Outcome = { kind: "ready"; state: ArchiveState } | { kind: "blocked" } | { kind: "left" }

  const fetchState = async (): Promise<Outcome> => {
    const envelope = (await useGraphQL(GetAccountArchiveStateDocument)) as GraphQLEnvelope<GetAccountArchiveStateQuery>

    if (envelope.data?.me) return { kind: "ready", state: envelope.data.me.archiveState }

    const code = readExtension(envelope.errors, "code")
    if (code === "FORBIDDEN") {
      if (readExtension(envelope.errors, "action") === "account.restore.self") return { kind: "blocked" }
      await navigateTo("/me", { replace: true, redirectCode: 302 })
      return { kind: "left" }
    }
    if (code === "UNAUTHENTICATED") {
      await navigateTo("/login", { replace: true, redirectCode: 302 })
      return { kind: "left" }
    }

    throw createError({ statusCode: 500, statusMessage: "archiveState" })
  }

  const { data, status, error, refresh } = await useAsyncData("account-archive-state", fetchState, { server: false })

  const outcome = ref<Outcome | null>(null)
  watch(data, (next) => (outcome.value = next ?? outcome.value), { immediate: true })

  const state = computed<ArchiveState | null>(() => (outcome.value?.kind === "ready" ? outcome.value.state : null))

  const pageState = computed<PageState>(() => {
    if (error.value) return "data_error"
    if (!outcome.value || status.value === "pending") return "loading"
    if (outcome.value.kind === "blocked") return "blocked"
    if (outcome.value.kind === "left") return "loading"
    return "ready"
  })

  const busy = ref(false)
  const confirmOpen = ref(false)
  const errorKind = ref<AccountRestoreErrorKind | null>(null)
  const requestId = ref<string | null>(null)

  const archivedOn = computed(() =>
    state.value
      ? new Intl.DateTimeFormat(locale.value, {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC"
        }).format(new Date(state.value.archivedAt))
      : ""
  )

  // Карточка плана — та же, что в сводке `/me`: набор полей у обоих запросов один.
  const plan = computed(() => (state.value?.plan ?? null) as NonNullable<AccountDashboard["subscription"]> | null)

  const errorMessage = computed(() => {
    if (!errorKind.value) return null
    if (errorKind.value === "generic") {
      return t("account.archived.error.generic", { requestId: requestId.value ?? "—" })
    }
    return t(`account.archived.error.${errorKind.value}`)
  })

  const restore = async () => {
    if (busy.value) return
    busy.value = true
    confirmOpen.value = false
    errorKind.value = null
    requestId.value = null

    try {
      const envelope = (await useGraphQL(RestoreAccountSelfDocument)) as GraphQLEnvelope<{
        restoreAccountSelf: { restored: boolean }
      }>

      if (envelope.data?.restoreAccountSelf.restored) {
        // Ограниченная сессия заменена полной, обе cookie обновил маршрут BFF: кабинет
        // открывается полным переходом, чтобы первый же ответ сервера пришёл новой сессией.
        await navigateTo("/me", { replace: true, external: true })
        return
      }

      const id = readExtension(envelope.errors, "requestId")
      requestId.value = typeof id === "string" ? id : null
      errorKind.value = accountRestoreErrorKind(readExtension(envelope.errors, "code"))
    } catch {
      errorKind.value = "generic"
    } finally {
      busy.value = false
    }
  }

  const logout = async () => {
    if (busy.value) return
    busy.value = true

    try {
      await useGraphQL(LogoutSessionDocument)
      // Cookie стирает маршрут BFF, поэтому уход выполняется полным переходом (§7).
      await navigateTo("/", { replace: true, external: true })
    } catch {
      errorKind.value = "generic"
    } finally {
      busy.value = false
    }
  }
</script>

<template>
  <div :data-archived-state="pageState">
    <AppHeader static minimal />
    <AppMain>
      <div v-if="pageState === 'loading'" data-testid="archived-skeleton" class="mx-auto max-w-3xl py-20">
        <span class="block h-8 w-72 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
        <span class="mt-6 block h-24 w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <StateScreen
        v-else-if="pageState === 'data_error'"
        :title="t('account.archived.pageTitle')"
        testid="archived-data-error">
        <p role="alert">{{ t("account.archived.error.dataUnavailable") }}</p>
        <template #actions>
          <button
            type="button"
            data-testid="archived-retry"
            class="border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 hover:border-orange-600 hover:text-orange-700 dark:text-zinc-400"
            @click="refresh()">
            {{ t("account.archived.retry") }}
          </button>
          <button
            type="button"
            data-testid="archived-logout"
            class="border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 hover:border-orange-600 hover:text-orange-700 dark:text-zinc-400"
            @click="logout">
            {{ t("account.archived.logout") }}
          </button>
        </template>
      </StateScreen>

      <StateScreen
        v-else-if="pageState === 'blocked'"
        :title="t('account.archived.pageTitle')"
        testid="archived-blocked">
        <p role="alert">{{ t("account.archived.error.forbidden") }}</p>
        <template #actions>
          <button
            type="button"
            data-testid="archived-logout"
            class="border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 hover:border-orange-600 hover:text-orange-700 dark:text-zinc-400"
            @click="logout">
            {{ t("account.archived.logout") }}
          </button>
          <a
            href="/contact?topic=general"
            data-testid="archived-contact"
            class="border-b border-orange-600 pb-0.5 font-sans text-sm text-zinc-950 dark:text-zinc-100">
            {{ t("account.archived.contact") }}
          </a>
        </template>
      </StateScreen>

      <StateScreen v-else :title="t('account.archived.archivedOn', { date: archivedOn })" testid="archived-state">
        <p data-testid="archived-body">{{ t("account.archived.body") }}</p>
        <p data-testid="archived-articles">
          {{ t("account.archived.articles", { count: state?.articlesArchived ?? 0 }) }}
        </p>

        <SubscriptionStatus v-if="plan" :subscription="plan" />

        <p data-testid="archived-restore-note">{{ t("account.archived.restoreNote") }}</p>
        <p v-if="errorMessage" role="alert" data-testid="archived-error" class="text-orange-700">
          {{ errorMessage }}
        </p>

        <template #actions>
          <button
            type="button"
            data-testid="archived-restore"
            :disabled="busy"
            class="inline-flex min-h-11 w-full items-center justify-center border border-zinc-900 px-4 font-sans text-sm font-semibold text-zinc-950 transition-colors hover:border-orange-700 hover:bg-orange-700 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none sm:w-auto dark:border-zinc-100 dark:text-zinc-100"
            @click="confirmOpen = true">
            {{ busy ? t("account.archived.restoring") : t("account.archived.restore") }}
          </button>
          <button
            type="button"
            data-testid="archived-logout"
            :disabled="busy"
            class="border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 transition-colors hover:border-orange-600 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none dark:text-zinc-400"
            @click="logout">
            {{ t("account.archived.logout") }}
          </button>
          <!-- Страница обращений — реестр маршрутов #14: вход не ваш — напишите в редакцию. -->
          <a
            href="/contact?topic=general"
            data-testid="archived-contact"
            class="border-b border-orange-600 pb-0.5 font-sans text-sm text-zinc-950 dark:text-zinc-100">
            {{ t("account.archived.contact") }}
          </a>
        </template>
      </StateScreen>

      <ConfirmDialog
        :open="confirmOpen"
        :title="t('account.archived.confirmTitle')"
        :body="t('account.archived.confirmBody')"
        :confirm-label="t('account.archived.restore')"
        :cancel-label="t('account.archived.confirmCancel')"
        :busy="busy"
        testid="archived-confirm"
        @confirm="restore"
        @cancel="confirmOpen = false" />
    </AppMain>
    <AppFooter />
  </div>
</template>
