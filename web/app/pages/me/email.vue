<script setup lang="ts">
  import {
    CancelEmailChangeDocument,
    ConfirmEmailChangeDocument,
    GetMyEmailChangeDocument,
    RequestEmailChangeDocument,
    type EmailChangeStateFieldsFragment
  } from "~/graphql/generated/graphql"
  import { emailChangeErrorKind, isCodeExpired, type EmailChangeErrorKind } from "~/utils/emailChangeStates"
  import EmailChangeForm from "~/components/me/EmailChangeForm.vue"
  import MaskedValue from "~/components/me/MaskedValue.vue"

  definePageMeta({
    i18n: false,
    layout: "auth",
    requiresAuth: true
  })

  // Спецификация: docs/spec/30-account/reader/email-change.md. Таблица состояний — §8.
  type PageState = "loading" | "data_error" | "ready"

  interface GraphQLErrorLike {
    extensions?: Record<string, unknown> | null
  }

  interface GraphQLEnvelope<T> {
    data?: T | null
    errors?: readonly GraphQLErrorLike[]
  }

  interface EmailChangeView {
    email: string
    state: EmailChangeStateFieldsFragment
  }

  const { t } = useI18n()

  useHead({
    title: () => `${t("account.email.pageTitle")} — Altera`,
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })

  const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string) => errors?.[0]?.extensions?.[key]

  /**
   * Ограниченная сессия видит только экран состояния, гость — форму входа (§3, §8).
   * Возвращает `true`, когда уход со страницы уже начат и обрабатывать отказ больше не нужно.
   */
  const leaveOnAccessFailure = async (errors: readonly GraphQLErrorLike[] | undefined): Promise<boolean> => {
    const code = readExtension(errors, "code")
    if (code === "FORBIDDEN") {
      await navigateTo("/me/archived", { replace: true, redirectCode: 302 })
      return true
    }
    if (code === "UNAUTHENTICATED") {
      await navigateTo({ path: "/login", query: { next: "/me/email" } }, { replace: true, redirectCode: 302 })
      return true
    }

    return false
  }

  const fetchState = async (): Promise<EmailChangeView> => {
    const envelope = (await useGraphQL(GetMyEmailChangeDocument)) as GraphQLEnvelope<{
      me: { id: string; email: string; emailChange: EmailChangeStateFieldsFragment } | null
    }>

    if (!envelope.data?.me) {
      if (await leaveOnAccessFailure(envelope.errors)) {
        return { email: "", state: { currentEmailMasked: "", pending: null } }
      }
      throw createError({ statusCode: 500, statusMessage: "emailChange" })
    }

    return { email: envelope.data.me.email, state: envelope.data.me.emailChange }
  }

  const { data, status, error, refresh } = await useAsyncData("my-email-change", fetchState, { server: false })

  const view = ref<EmailChangeView | null>(null)
  watch(data, (next) => (view.value = next ?? view.value), { immediate: true })

  const pageState = computed<PageState>(() => {
    if (error.value) return "data_error"
    if (!view.value || status.value === "pending") return "loading"
    return "ready"
  })

  const busy = ref(false)
  const errorKind = ref<EmailChangeErrorKind | null>(null)
  const errorRetryAfter = ref<number | null>(null)
  const requestId = ref<string | null>(null)
  const changedTo = ref<string | null>(null)

  const pending = computed(() => view.value?.state.pending ?? null)
  // Истёкший код остаётся на экране отдельной строкой «код истёк» (§8), а не сбрасывает форму.
  const expired = computed(() => isCodeExpired(pending.value?.expiresAt))

  const errorMessage = computed(() => {
    if (!errorKind.value) return null
    if (errorKind.value === "rateLimited") {
      const minutes = errorRetryAfter.value === null ? null : Math.max(1, Math.ceil(errorRetryAfter.value / 60))
      return t("account.email.error.rateLimited", { retryAfter: minutes === null ? "—" : `${minutes}` })
    }
    if (errorKind.value === "generic") {
      return t("account.email.error.generic", { requestId: requestId.value ?? "—" })
    }
    return t(`account.email.error.${errorKind.value}`)
  })

  const applyFailure = async (errors: readonly GraphQLErrorLike[] | undefined): Promise<void> => {
    if (await leaveOnAccessFailure(errors)) return

    const id = readExtension(errors, "requestId")
    requestId.value = typeof id === "string" ? id : null
    const retryAfter = readExtension(errors, "retryAfter")
    errorRetryAfter.value = typeof retryAfter === "number" ? retryAfter : null
    errorKind.value = emailChangeErrorKind({
      code: readExtension(errors, "code"),
      field: readExtension(errors, "field"),
      entity: readExtension(errors, "entity"),
      rule: readExtension(errors, "rule")
    })

    // Истёкший и исчерпанный запрос сервер уже закрыл: экран должен увидеть это на следующем чтении.
    if (errorKind.value === "expiredCode" || errorKind.value === "addressTaken") await refresh()
  }

  async function run<T>(
    call: () => Promise<GraphQLEnvelope<T>>,
    apply: (payload: T) => void | Promise<void>
  ): Promise<void> {
    if (busy.value) return
    busy.value = true
    errorKind.value = null
    errorRetryAfter.value = null
    requestId.value = null

    try {
      const envelope = await call()
      if (!envelope.data) {
        await applyFailure(envelope.errors)
        return
      }
      await apply(envelope.data)
    } catch {
      errorKind.value = "generic"
    } finally {
      busy.value = false
    }
  }

  const setState = (state: EmailChangeStateFieldsFragment) => {
    view.value = { email: view.value?.email ?? "", state }
  }

  const requestCode = (newEmail: string) =>
    run(
      () => useGraphQL(RequestEmailChangeDocument, { newEmail }),
      (payload) => {
        changedTo.value = null
        setState(payload.requestEmailChange)
      }
    )

  const confirmCode = (code: string) =>
    run(
      () => useGraphQL(ConfirmEmailChangeDocument, { code }),
      async (payload) => {
        // Зона 2 обновляется, форма закрывается (§5): свежее чтение приносит новый адрес целиком.
        changedTo.value = payload.confirmEmailChange.email
        setState({ currentEmailMasked: payload.confirmEmailChange.email, pending: null })
        await refresh()
      }
    )

  const cancel = () =>
    run(
      () => useGraphQL(CancelEmailChangeDocument),
      (payload) => setState(payload.cancelEmailChange)
    )
</script>

<template>
  <section class="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-16" :data-email-change-state="pageState">
    <h1 class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">{{ t("account.email.pageTitle") }}</h1>

    <div v-if="pageState === 'loading'" data-testid="email-change-skeleton" class="flex flex-col gap-4">
      <span class="h-4 w-48 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      <span class="h-11 w-full max-w-xl animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>

    <div
      v-else-if="pageState === 'data_error'"
      role="alert"
      data-testid="email-change-data-error"
      class="flex flex-col gap-3">
      <p class="font-sans text-base text-zinc-900 dark:text-zinc-100">{{ t("account.email.error.dataUnavailable") }}</p>
      <button
        type="button"
        data-testid="email-change-retry"
        class="self-start border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 hover:border-orange-600 hover:text-orange-700 dark:text-zinc-400"
        @click="refresh()">
        {{ t("account.email.retry") }}
      </button>
    </div>

    <template v-else>
      <div class="flex flex-col gap-2">
        <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("account.email.currentLabel") }}
        </h2>
        <MaskedValue
          :masked="view?.state.currentEmailMasked ?? ''"
          :value="view?.email"
          testid="email-change-current" />
      </div>

      <p
        v-if="changedTo"
        role="status"
        data-testid="email-change-changed"
        class="font-sans text-base text-zinc-900 dark:text-zinc-100">
        {{ t("account.email.changed") }}
      </p>

      <EmailChangeForm
        :pending="pending"
        :busy="busy"
        :expired="expired"
        :error-message="errorMessage"
        @request="requestCode"
        @confirm="confirmCode"
        @cancel="cancel" />

      <aside class="flex flex-col gap-2 border-none font-sans text-sm text-zinc-600 dark:text-zinc-400">
        <p>{{ t("account.email.lostAccess") }}</p>
        <!-- Страница обращений — отдельная задача; адрес зафиксирован реестром маршрутов #14. -->
        <a
          href="/contact?topic=access_recovery"
          data-testid="email-change-contact"
          class="self-start border-b border-orange-600 text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
          {{ t("account.email.lostAccessLink") }}
        </a>
      </aside>
    </template>
  </section>
</template>
