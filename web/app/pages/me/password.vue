<script setup lang="ts">
  import { GetMyPasswordStateDocument, SetPasswordDocument } from "~/graphql/generated/graphql"
  import { passwordErrorKind, type PasswordErrorKind } from "~/utils/authStates"

  definePageMeta({
    i18n: false,
    layout: "auth",
    requiresAuth: true
  })

  /**
   * Установка и смена пароля в кабинете (T-115, журнал §34 п. 7–8). Аккаунт без пароля —
   * обычное состояние: он входит по одноразовой ссылке, и пароль для него необязателен.
   */
  type PageState = "loading" | "data_error" | "ready"

  interface GraphQLErrorLike {
    extensions?: Record<string, unknown> | null
  }

  interface GraphQLEnvelope<T> {
    data?: T | null
    errors?: readonly GraphQLErrorLike[]
  }

  const { t } = useI18n()

  useHead({
    title: () => `${t("account.password.pageTitle")} — Altera`,
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })

  const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string) => errors?.[0]?.extensions?.[key]

  /** Ограниченная сессия видит только экран состояния, гость — форму входа. */
  const leaveOnAccessFailure = async (errors: readonly GraphQLErrorLike[] | undefined): Promise<boolean> => {
    const code = readExtension(errors, "code")
    if (code === "FORBIDDEN") {
      await navigateTo("/me/archived", { replace: true, redirectCode: 302 })
      return true
    }
    if (code === "UNAUTHENTICATED") {
      await navigateTo({ path: "/login", query: { next: "/me/password" } }, { replace: true, redirectCode: 302 })
      return true
    }

    return false
  }

  const fetchState = async (): Promise<{ passwordSet: boolean }> => {
    const envelope = (await useGraphQL(GetMyPasswordStateDocument)) as GraphQLEnvelope<{
      me: { id: string; email: string; passwordSet: boolean } | null
    }>

    if (!envelope.data?.me) {
      if (await leaveOnAccessFailure(envelope.errors)) return { passwordSet: false }
      throw createError({ statusCode: 500, statusMessage: "passwordState" })
    }

    return { passwordSet: envelope.data.me.passwordSet }
  }

  const { data, status, error, refresh } = await useAsyncData("my-password-state", fetchState, { server: false })

  const pageState = computed<PageState>(() => {
    if (error.value) return "data_error"
    if (!data.value || status.value === "pending") return "loading"
    return "ready"
  })

  const passwordSet = computed(() => data.value?.passwordSet ?? false)
  const currentPassword = ref("")
  const newPassword = ref("")
  const visible = ref(false)
  const busy = ref(false)
  const saved = ref(false)
  const errorKind = ref<PasswordErrorKind | null>(null)
  const errorRetryAfter = ref<number | null>(null)
  const requestId = ref<string | null>(null)

  const canSubmit = computed(
    () => !busy.value && newPassword.value.length > 0 && (!passwordSet.value || currentPassword.value.length > 0)
  )

  const errorMessage = computed(() => {
    if (!errorKind.value) return null
    if (errorKind.value === "rateLimited") {
      const minutes = errorRetryAfter.value === null ? null : Math.max(1, Math.ceil(errorRetryAfter.value / 60))
      return t("account.password.error.rateLimited", { retryAfter: minutes === null ? "—" : `${minutes}` })
    }
    if (errorKind.value === "wrongCurrentPassword") return t("account.password.error.wrongCurrentPassword")
    if (errorKind.value === "weakPassword") return t("account.password.error.weakPassword")
    if (errorKind.value === "knownPassword") return t("account.password.error.knownPassword")
    return t("account.password.error.generic", { requestId: requestId.value ?? "—" })
  })

  const submit = async () => {
    if (!canSubmit.value) return
    busy.value = true
    saved.value = false
    errorKind.value = null
    errorRetryAfter.value = null
    requestId.value = null

    try {
      const envelope = (await useGraphQL(SetPasswordDocument, {
        currentPassword: passwordSet.value ? currentPassword.value : null,
        newPassword: newPassword.value
      })) as GraphQLEnvelope<{ setPassword: boolean }>

      if (!envelope.data?.setPassword) {
        if (await leaveOnAccessFailure(envelope.errors)) return
        const id = readExtension(envelope.errors, "requestId")
        requestId.value = typeof id === "string" ? id : null
        const retryAfter = readExtension(envelope.errors, "retryAfter")
        errorRetryAfter.value = typeof retryAfter === "number" ? retryAfter : null
        errorKind.value = passwordErrorKind({
          code: readExtension(envelope.errors, "code"),
          field: readExtension(envelope.errors, "field"),
          rule: readExtension(envelope.errors, "rule")
        })
        return
      }

      saved.value = true
      currentPassword.value = ""
      newPassword.value = ""
      await refresh()
    } catch {
      errorKind.value = "generic"
    } finally {
      busy.value = false
    }
  }
</script>

<template>
  <section class="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-16" :data-password-state="pageState">
    <h1 class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">{{ t("account.password.pageTitle") }}</h1>

    <div v-if="pageState === 'loading'" data-testid="password-skeleton" class="flex flex-col gap-4">
      <span class="h-4 w-48 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      <span class="h-11 w-full max-w-xl animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>

    <div
      v-else-if="pageState === 'data_error'"
      role="alert"
      data-testid="password-data-error"
      class="flex flex-col gap-3">
      <p class="font-sans text-base text-zinc-900 dark:text-zinc-100">
        {{ t("account.password.error.dataUnavailable") }}
      </p>
      <button
        type="button"
        data-testid="password-retry"
        class="self-start border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 hover:border-orange-600 hover:text-orange-700 dark:text-zinc-400"
        @click="refresh()">
        {{ t("account.password.retry") }}
      </button>
    </div>

    <template v-else>
      <div class="flex flex-col gap-2">
        <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ passwordSet ? t("account.password.changeTitle") : t("account.password.setTitle") }}
        </h2>
        <p class="font-sans text-sm text-zinc-600 dark:text-zinc-400">
          {{ passwordSet ? t("account.password.changeBody") : t("account.password.setBody") }}
        </p>
      </div>

      <p v-if="saved" role="status" data-testid="password-saved" class="font-sans text-base">
        {{ t("account.password.saved") }}
      </p>

      <form class="flex max-w-xl flex-col gap-6" novalidate @submit.prevent="submit">
        <label v-if="passwordSet" class="flex flex-col gap-2">
          <span>{{ t("account.password.currentLabel") }}</span>
          <input
            v-model="currentPassword"
            :type="visible ? 'text' : 'password'"
            name="current-password"
            data-testid="password-current"
            autocomplete="current-password"
            class="w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>

        <label class="flex flex-col gap-2">
          <span>{{ t("account.password.newLabel") }}</span>
          <input
            v-model="newPassword"
            :type="visible ? 'text' : 'password'"
            name="new-password"
            data-testid="password-new"
            autocomplete="new-password"
            class="w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
          <span class="text-sm opacity-80">{{ t("account.password.hint") }}</span>
        </label>

        <button
          type="button"
          class="self-start text-sm underline"
          data-testid="password-toggle"
          @click="visible = !visible">
          {{ visible ? t("auth.password.hide") : t("auth.password.show") }}
        </button>

        <button
          type="submit"
          data-testid="password-submit"
          :disabled="!canSubmit"
          class="self-start rounded bg-zinc-900 px-4 py-2 font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {{ passwordSet ? t("account.password.submitChange") : t("account.password.submitSet") }}
        </button>

        <p v-if="errorMessage" role="alert" data-testid="password-error">{{ errorMessage }}</p>
      </form>
    </template>
  </section>
</template>
