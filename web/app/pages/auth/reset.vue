<script setup lang="ts">
  import { ResetPasswordDocument } from "~/graphql/generated/graphql"
  import type { ResetPasswordMutation } from "~/graphql/generated/graphql"
  import { passwordErrorKind, passwordResetState, type PasswordErrorKind } from "~/utils/authStates"

  // Языкового префикса у страницы нет: ссылка приходит письмом, как и `/auth/verify`.
  definePageMeta({ i18n: false, layout: "auth" })

  /**
   * Новый пароль по ссылке из письма (T-115, журнал §34 п. 7). Токен одноразовый: неизвестная,
   * использованная и истёкшая ссылка отвечают одинаково. Сессию из ответа переносит в cookie
   * BFF (ADR-0023 п. 2), поэтому после успеха страница делает обычный переход документа.
   */
  type ResetState = "form" | "invalid" | "error"

  interface GraphQLErrorLike {
    extensions?: Record<string, unknown> | null
  }

  interface GraphQLEnvelope<T> {
    data?: T | null
    errors?: readonly GraphQLErrorLike[]
  }

  const { t } = useI18n()
  const route = useRoute()

  const token = computed(() => (typeof route.query.token === "string" ? route.query.token : null))
  const password = ref("")
  const passwordVisible = ref(false)
  const submitting = ref(false)
  const state = ref<ResetState>("form")
  const errorKind = ref<PasswordErrorKind | null>(null)
  const errorRetryAfter = ref<number | null>(null)
  const requestId = ref<string | null>(null)

  const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string) => errors?.[0]?.extensions?.[key]

  const canSubmit = computed(() => Boolean(token.value) && password.value.length > 0 && !submitting.value)

  const errorMessage = computed(() => {
    if (!errorKind.value) return null
    if (errorKind.value === "rateLimited") {
      const minutes = errorRetryAfter.value === null ? null : Math.max(1, Math.ceil(errorRetryAfter.value / 60))
      return t("auth.password.error.rateLimited", { retryAfter: minutes === null ? "—" : `${minutes}` })
    }
    if (errorKind.value === "generic") return t("auth.password.error.generic", { requestId: requestId.value ?? "—" })
    return t(`auth.password.error.${errorKind.value}`)
  })

  const submit = async () => {
    if (!canSubmit.value || !token.value) return
    submitting.value = true
    errorKind.value = null
    requestId.value = null

    try {
      const envelope = (await useGraphQL(ResetPasswordDocument, {
        token: token.value,
        password: password.value
      })) as GraphQLEnvelope<ResetPasswordMutation>
      const result = envelope.data?.resetPassword

      if (!result) {
        const code = readExtension(envelope.errors, "code")
        if (code === "NOT_FOUND") {
          state.value = passwordResetState(code)
          return
        }
        const id = readExtension(envelope.errors, "requestId")
        requestId.value = typeof id === "string" ? id : null
        const retryAfter = readExtension(envelope.errors, "retryAfter")
        errorRetryAfter.value = typeof retryAfter === "number" ? retryAfter : null
        errorKind.value = passwordErrorKind({
          code,
          field: readExtension(envelope.errors, "field"),
          rule: readExtension(envelope.errors, "rule")
        })
        return
      }

      if (result.outcome === "archived_admin") {
        await navigateTo(`/auth/appeal?token=${result.appealToken ?? ""}`, { external: true })
        return
      }
      if (result.outcome === "consent_required") {
        await navigateTo(`/auth/verify?token=${result.consentToken ?? ""}`, { external: true })
        return
      }

      await navigateTo(result.outcome === "archived_self" ? "/me/archived" : (result.next ?? "/me"), { external: true })
    } catch {
      errorKind.value = "generic"
    } finally {
      submitting.value = false
    }
  }

  useSeoMeta({
    title: () => `${t("auth.reset.title")} — Altera`,
    robots: "noindex, nofollow",
    referrer: "no-referrer"
  })
</script>

<template>
  <section class="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16" :data-reset-state="state">
    <template v-if="state === 'form'">
      <form class="flex flex-col gap-6" novalidate @submit.prevent="submit">
        <h1 class="text-2xl font-semibold">{{ t("auth.reset.title") }}</h1>
        <p>{{ t("auth.reset.body") }}</p>

        <label class="flex flex-col gap-2">
          <span>{{ t("auth.password.newPasswordLabel") }}</span>
          <input
            v-model="password"
            :type="passwordVisible ? 'text' : 'password'"
            name="new-password"
            data-testid="reset-password"
            autocomplete="new-password"
            class="w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
          <button
            type="button"
            class="self-start text-sm underline"
            data-testid="reset-password-toggle"
            @click="passwordVisible = !passwordVisible">
            {{ passwordVisible ? t("auth.password.hide") : t("auth.password.show") }}
          </button>
          <span class="text-sm opacity-80">{{ t("auth.password.passwordHint") }}</span>
        </label>

        <button
          type="submit"
          data-testid="reset-submit"
          :disabled="!canSubmit"
          class="rounded bg-zinc-900 px-4 py-2 font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {{ t("auth.reset.submit") }}
        </button>

        <p v-if="errorMessage" role="alert" data-testid="reset-error">{{ errorMessage }}</p>
      </form>
    </template>

    <template v-else-if="state === 'invalid'">
      <h1 class="text-2xl font-semibold">{{ t("auth.reset.expired.title") }}</h1>
      <p>{{ t("auth.reset.expired.body") }}</p>
      <NuxtLink to="/login" class="font-semibold underline">{{ t("auth.reset.expired.action") }}</NuxtLink>
    </template>

    <template v-else>
      <h1 class="text-2xl font-semibold">{{ t("auth.verify.error.title") }}</h1>
      <p>{{ t("auth.verify.error.body", { requestId: requestId ?? "—" }) }}</p>
      <NuxtLink to="/login" class="font-semibold underline">{{ t("auth.verify.error.action") }}</NuxtLink>
    </template>
  </section>
</template>
