<script setup lang="ts">
  import {
    LegalVersionsDocument,
    LoginWithPasswordDocument,
    RegisterWithPasswordDocument,
    RequestMagicLinkDocument,
    RequestPasswordResetDocument
  } from "~/graphql/generated/graphql"
  import type {
    LegalVersionsQuery,
    LoginWithPasswordMutation,
    RegisterWithPasswordMutation,
    RequestMagicLinkMutation,
    RequestPasswordResetMutation
  } from "~/graphql/generated/graphql"
  import { sanitizeNextPath } from "~/utils/nextPath"
  import { loginErrorKind, passwordErrorKind, type LoginErrorKind, type PasswordErrorKind } from "~/utils/authStates"

  definePageMeta({ layout: "auth" })

  // Спецификация: docs/spec/20-public/login.md. Таблица состояний — §8; ветка пароля — §3а
  // (журнал §34 п. 6–8: ссылка и пароль равноправны).
  type LoginState = "loading" | "data_error" | "form" | "sent" | "register_sent" | "reset_sent" | "unconfirmed"
  /** Способ, выбранный на форме: вход по ссылке, вход с паролем, регистрация с паролем, сброс. */
  type LoginMode = "link" | "password" | "register" | "reset"

  interface GraphQLErrorLike {
    extensions?: Record<string, unknown> | null
  }

  interface GraphQLEnvelope<T> {
    data?: T | null
    errors?: readonly GraphQLErrorLike[]
  }

  const { t, te, locale } = useI18n()
  const route = useRoute()
  const { hasSession } = useAuthSession()

  const nextPath = computed(() => sanitizeNextPath(route.query.next))

  // С сессией страница входа не показывается (login.md §2). Cookie сессии httpOnly,
  // поэтому её видит только серверный рендер — на клиенте проверять нечего.
  if (hasSession.value) {
    // У кабинета нет языковых вариантов (`i18n: false`), поэтому адрес один для обеих локалей.
    await navigateTo(nextPath.value ?? "/me", { replace: true, redirectCode: 302 })
  }

  const { data: legal, error: legalError } = await useAsyncData(
    "login-legal-versions",
    async () => {
      const envelope = (await useGraphQL(LegalVersionsDocument, {
        locale: locale.value as "ru" | "en"
      })) as GraphQLEnvelope<LegalVersionsQuery>
      if (!envelope.data?.legalVersions) throw createError({ statusCode: 500, statusMessage: "legalVersions" })
      return envelope.data.legalVersions
    },
    { watch: [locale], server: false, lazy: true }
  )

  // Без действующих версий согласие невалидно (login.md §8, ADR-0028).
  const legalUnavailable = computed(
    () => Boolean(legalError.value) || legal.value?.termsVersion === null || legal.value?.privacyVersion === null
  )
  const legalLoading = computed(() => !legalError.value && !legal.value)

  const mode = ref<LoginMode>("link")
  const email = ref("")
  const password = ref("")
  const passwordVisible = ref(false)
  const consentAccepted = ref(false)
  const submitting = ref(false)
  const sentTo = ref<string | null>(null)
  const settled = ref<Exclude<LoginState, "loading" | "data_error" | "form"> | null>(null)
  const retryAfterSec = ref<number | null>(null)
  const errorKind = ref<LoginErrorKind | PasswordErrorKind | null>(null)
  const errorRetryAfter = ref<number | null>(null)
  const requestId = ref<string | null>(null)

  const state = computed<LoginState>(() => {
    if (settled.value) return settled.value
    if (legalLoading.value) return "loading"
    if (legalUnavailable.value) return "data_error"
    return "form"
  })

  /** Согласие спрашивается там, где шаг может завести аккаунт: ссылка и регистрация с паролем. */
  const consentRequired = computed(() => mode.value === "link" || mode.value === "register")
  const passwordRequired = computed(() => mode.value === "password" || mode.value === "register")

  const canSubmit = computed(() => {
    if (state.value !== "form" || submitting.value || email.value.trim().length === 0) return false
    if (consentRequired.value && !consentAccepted.value) return false
    if (passwordRequired.value && password.value.length === 0) return false
    return true
  })

  const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string) => errors?.[0]?.extensions?.[key]

  const applyFailure = (errors: readonly GraphQLErrorLike[] | undefined) => {
    const id = readExtension(errors, "requestId")
    requestId.value = typeof id === "string" ? id : null

    const retryAfter = readExtension(errors, "retryAfter")
    errorRetryAfter.value = typeof retryAfter === "number" ? retryAfter : null
    const code = readExtension(errors, "code")
    errorKind.value =
      mode.value === "link"
        ? loginErrorKind(code, readExtension(errors, "field"))
        : passwordErrorKind({
            code,
            field: readExtension(errors, "field"),
            rule: readExtension(errors, "rule")
          })
  }

  const consentVersion = () => ({
    termsVersion: legal.value?.termsVersion ?? null,
    privacyVersion: legal.value?.privacyVersion ?? null
  })

  /**
   * Сессию ставит BFF: cookie уже в ответе мутации, поэтому дальше нужен обычный переход
   * документа — после него серверный рендер видит вошедшего (ADR-0023 п. 2).
   */
  const goAuthenticated = async (target: string) => {
    await navigateTo(target, { external: true })
  }

  const submitLink = async () => {
    const envelope = (await useGraphQL(RequestMagicLinkDocument, {
      email: email.value.trim(),
      consentVersion: consentVersion(),
      locale: locale.value as "ru" | "en",
      next: nextPath.value
    })) as GraphQLEnvelope<RequestMagicLinkMutation>

    if (!envelope.data?.requestMagicLink?.ok) {
      applyFailure(envelope.errors)
      return
    }

    retryAfterSec.value = envelope.data.requestMagicLink.retryAfterSec
    sentTo.value = email.value.trim()
    settled.value = "sent"
  }

  const submitRegister = async () => {
    const envelope = (await useGraphQL(RegisterWithPasswordDocument, {
      email: email.value.trim(),
      password: password.value,
      consentVersion: consentVersion(),
      locale: locale.value as "ru" | "en",
      next: nextPath.value
    })) as GraphQLEnvelope<RegisterWithPasswordMutation>

    if (!envelope.data?.registerWithPassword?.ok) {
      applyFailure(envelope.errors)
      return
    }

    // Ответ одинаков для свободного и занятого адреса (login.md §4): экран тоже один.
    retryAfterSec.value = envelope.data.registerWithPassword.retryAfterSec
    sentTo.value = email.value.trim()
    settled.value = "register_sent"
  }

  const submitPassword = async () => {
    const envelope = (await useGraphQL(LoginWithPasswordDocument, {
      email: email.value.trim(),
      password: password.value,
      next: nextPath.value
    })) as GraphQLEnvelope<LoginWithPasswordMutation>

    const result = envelope.data?.loginWithPassword
    if (!result) {
      applyFailure(envelope.errors)
      return
    }

    if (result.outcome === "email_unconfirmed") {
      sentTo.value = email.value.trim()
      settled.value = "unconfirmed"
      return
    }
    if (result.outcome === "consent_required") {
      await goAuthenticated(`/auth/verify?token=${result.consentToken ?? ""}`)
      return
    }
    if (result.outcome === "archived_admin") {
      await goAuthenticated(`/auth/appeal?token=${result.appealToken ?? ""}`)
      return
    }

    await goAuthenticated(result.outcome === "archived_self" ? "/me/archived" : (result.next ?? "/me"))
  }

  const submitReset = async () => {
    const envelope = (await useGraphQL(RequestPasswordResetDocument, {
      email: email.value.trim(),
      locale: locale.value as "ru" | "en"
    })) as GraphQLEnvelope<RequestPasswordResetMutation>

    if (!envelope.data?.requestPasswordReset?.ok) {
      applyFailure(envelope.errors)
      return
    }

    // Ответ не раскрывает, существует ли аккаунт: экран одинаков для любого адреса.
    sentTo.value = email.value.trim()
    settled.value = "reset_sent"
  }

  const submit = async () => {
    if (!canSubmit.value && !settled.value) return
    submitting.value = true
    errorKind.value = null
    errorRetryAfter.value = null
    requestId.value = null

    try {
      if (mode.value === "password") await submitPassword()
      else if (mode.value === "register") await submitRegister()
      else if (mode.value === "reset") await submitReset()
      else await submitLink()
    } catch {
      errorKind.value = "generic"
    } finally {
      submitting.value = false
    }
  }

  const switchMode = (next: LoginMode) => {
    mode.value = next
    settled.value = null
    errorKind.value = null
    password.value = ""
    passwordVisible.value = false
  }

  const changeAddress = () => {
    settled.value = null
    sentTo.value = null
    retryAfterSec.value = null
    email.value = ""
    password.value = ""
    consentAccepted.value = false
  }

  const errorMessage = computed(() => {
    if (!errorKind.value) return null
    const scope = mode.value === "link" ? "auth.login.error" : "auth.password.error"
    if (errorKind.value === "rateLimited") {
      const minutes = errorRetryAfter.value === null ? null : Math.max(1, Math.ceil(errorRetryAfter.value / 60))
      return t(`${scope}.rateLimited`, { retryAfter: minutes === null ? "—" : `${minutes}` })
    }
    if (errorKind.value === "generic") {
      return t(`${scope}.generic`, { requestId: requestId.value ?? "—" })
    }
    // Часть кодов есть только у ветки ссылки (согласие, почта), часть — только у пароля.
    const key = `${scope}.${errorKind.value}`
    return te(key) ? t(key) : t("auth.login.error.generic", { requestId: requestId.value ?? "—" })
  })

  const submitLabel = computed(() => {
    if (mode.value === "password") return t("auth.password.loginButton")
    if (mode.value === "register") return t("auth.password.registerButton")
    if (mode.value === "reset") return t("auth.password.resetButton")
    return t("auth.login.submitButton")
  })

  useSeoMeta({
    title: () => `${t("auth.login.title")} — Altera`,
    robots: "noindex, follow"
  })
</script>

<template>
  <section
    class="mx-auto flex w-full max-w-md flex-col gap-8 px-4 py-16"
    :data-login-state="state"
    :data-login-mode="mode">
    <template v-if="state === 'sent'">
      <div class="flex flex-col gap-4">
        <h1 class="text-2xl font-semibold">{{ t("auth.login.sent.title") }}</h1>
        <p>{{ t("auth.login.sent.body", { email: sentTo }) }}</p>
        <p>{{ t("auth.login.sent.spam") }}</p>
        <p class="text-sm opacity-80">{{ t("auth.login.sent.notReceived") }}</p>
        <div class="flex flex-wrap gap-4">
          <button type="button" class="font-semibold underline" :disabled="submitting" @click="submit">
            {{ t("auth.login.sent.retry") }}
            <span v-if="retryAfterSec !== null">({{ retryAfterSec }})</span>
          </button>
          <button type="button" class="underline" @click="changeAddress">
            {{ t("auth.login.sent.changeAddress") }}
          </button>
        </div>
        <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
      </div>
    </template>

    <template v-else-if="state === 'register_sent' || state === 'unconfirmed'">
      <div class="flex flex-col gap-4" data-testid="login-confirm-sent">
        <h1 class="text-2xl font-semibold">
          {{ state === "unconfirmed" ? t("auth.password.unconfirmed.title") : t("auth.password.registerSent.title") }}
        </h1>
        <p>
          {{
            state === "unconfirmed"
              ? t("auth.password.unconfirmed.body")
              : t("auth.password.registerSent.body", { email: sentTo })
          }}
        </p>
        <p>{{ t("auth.login.sent.spam") }}</p>
        <button type="button" class="self-start underline" @click="switchMode('password')">
          {{ t("auth.password.backToLogin") }}
        </button>
      </div>
    </template>

    <template v-else-if="state === 'reset_sent'">
      <div class="flex flex-col gap-4" data-testid="login-reset-sent">
        <h1 class="text-2xl font-semibold">{{ t("auth.password.resetSent.title") }}</h1>
        <p>{{ t("auth.password.resetSent.body", { email: sentTo }) }}</p>
        <p>{{ t("auth.login.sent.spam") }}</p>
        <button type="button" class="self-start underline" @click="switchMode('password')">
          {{ t("auth.password.backToLogin") }}
        </button>
      </div>
    </template>

    <template v-else-if="state === 'data_error'">
      <div class="flex flex-col gap-4" role="alert">
        <h1 class="text-2xl font-semibold">{{ t("auth.login.title") }}</h1>
        <p>{{ t("auth.login.error.legalUnavailable") }}</p>
      </div>
    </template>

    <template v-else>
      <form class="flex flex-col gap-6" novalidate @submit.prevent="submit">
        <h1 class="text-2xl font-semibold">
          {{ mode === "reset" ? t("auth.password.resetTitle") : t("auth.login.title") }}
        </h1>

        <!-- Способы входа равноправны (журнал §34 п. 6): переключатель, а не «запасной» вариант. -->
        <div v-if="mode !== 'reset'" class="flex gap-4 text-sm" role="group">
          <button
            type="button"
            data-testid="login-mode-link"
            class="border-b-2 pb-1"
            :class="mode === 'link' ? 'border-zinc-900 font-semibold dark:border-zinc-100' : 'border-transparent'"
            @click="switchMode('link')">
            {{ t("auth.password.modeLink") }}
          </button>
          <button
            type="button"
            data-testid="login-mode-password"
            class="border-b-2 pb-1"
            :class="mode !== 'link' ? 'border-zinc-900 font-semibold dark:border-zinc-100' : 'border-transparent'"
            @click="switchMode('password')">
            {{ t("auth.password.modePassword") }}
          </button>
        </div>

        <label class="flex flex-col gap-2">
          <span>{{ t("auth.login.emailLabel") }}</span>
          <input
            v-model="email"
            type="email"
            name="email"
            autocomplete="email"
            inputmode="email"
            autofocus
            :placeholder="t('auth.login.emailPlaceholder')"
            class="w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>

        <label v-if="passwordRequired" class="flex flex-col gap-2">
          <span>{{ t("auth.password.passwordLabel") }}</span>
          <!-- Вставка, autofill и менеджеры паролей разрешены (утверждённые требования п. 5). -->
          <input
            v-model="password"
            :type="passwordVisible ? 'text' : 'password'"
            name="password"
            data-testid="login-password"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            class="w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
          <button
            type="button"
            class="self-start text-sm underline"
            data-testid="login-password-toggle"
            @click="passwordVisible = !passwordVisible">
            {{ passwordVisible ? t("auth.password.hide") : t("auth.password.show") }}
          </button>
          <span v-if="mode === 'register'" class="text-sm opacity-80">{{ t("auth.password.passwordHint") }}</span>
        </label>

        <label v-if="consentRequired" class="flex items-start gap-3">
          <input v-model="consentAccepted" type="checkbox" name="consent" class="mt-1" />
          <span>
            {{ t("auth.login.consentLabel", { offertaLink: "", privacyLink: "" }) }}
            <a :href="legal?.termsPath" target="_blank" rel="noopener" class="underline">
              {{ t("auth.login.consentOfferta") }} v{{ legal?.termsVersion }}
            </a>
            <span> · </span>
            <a :href="legal?.privacyPath" target="_blank" rel="noopener" class="underline">
              {{ t("auth.login.consentPrivacy") }} v{{ legal?.privacyVersion }}
            </a>
          </span>
        </label>

        <p v-if="mode === 'link'" class="text-sm opacity-80">{{ t("auth.login.hint") }}</p>
        <p v-else-if="mode === 'reset'" class="text-sm opacity-80">{{ t("auth.password.resetHint") }}</p>

        <button
          type="submit"
          data-testid="login-submit"
          :disabled="!canSubmit"
          class="rounded bg-zinc-900 px-4 py-2 font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {{ submitLabel }}
        </button>

        <p v-if="errorMessage" role="alert" data-testid="login-error">{{ errorMessage }}</p>

        <div v-if="mode !== 'link'" class="flex flex-wrap gap-4 text-sm">
          <button
            v-if="mode === 'password'"
            type="button"
            data-testid="login-to-register"
            class="underline"
            @click="switchMode('register')">
            {{ t("auth.password.toRegister") }}
          </button>
          <button
            v-else
            type="button"
            data-testid="login-to-password"
            class="underline"
            @click="switchMode('password')">
            {{ t("auth.password.toLogin") }}
          </button>
          <button
            v-if="mode !== 'reset'"
            type="button"
            data-testid="login-to-reset"
            class="underline"
            @click="switchMode('reset')">
            {{ t("auth.password.forgot") }}
          </button>
        </div>
      </form>

      <aside class="flex flex-col gap-2 text-sm opacity-80">
        <p>{{ t("auth.login.why") }}</p>
        <!-- Страница тарифов появится отдельной задачей; адрес зафиксирован реестром маршрутов. -->
        <a href="/pricing" class="underline">{{ t("auth.login.pricingLink") }}</a>
      </aside>
    </template>
  </section>
</template>
