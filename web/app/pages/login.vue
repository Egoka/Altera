<script setup lang="ts">
  import { LegalVersionsDocument, RequestMagicLinkDocument } from "~/graphql/generated/graphql"
  import type { LegalVersionsQuery, RequestMagicLinkMutation } from "~/graphql/generated/graphql"
  import { sanitizeNextPath } from "~/utils/nextPath"
  import { loginErrorKind, type LoginErrorKind } from "~/utils/authStates"

  definePageMeta({ layout: "auth" })

  // Спецификация: docs/spec/20-public/login.md. Таблица состояний — §8.
  type LoginState = "loading" | "data_error" | "form" | "sent"

  interface GraphQLErrorLike {
    extensions?: Record<string, unknown> | null
  }

  interface GraphQLEnvelope<T> {
    data?: T | null
    errors?: readonly GraphQLErrorLike[]
  }

  const { t, locale } = useI18n()
  const route = useRoute()
  const { hasSession } = useAuthSession()

  const nextPath = computed(() => sanitizeNextPath(route.query.next))

  // С сессией страница входа не показывается (login.md §2).
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

  const email = ref("")
  const consentAccepted = ref(false)
  const submitting = ref(false)
  const sentTo = ref<string | null>(null)
  const retryAfterSec = ref<number | null>(null)
  const errorKind = ref<LoginErrorKind | null>(null)
  const errorRetryAfter = ref<number | null>(null)
  const requestId = ref<string | null>(null)

  const state = computed<LoginState>(() => {
    if (sentTo.value) return "sent"
    if (legalLoading.value) return "loading"
    if (legalUnavailable.value) return "data_error"
    return "form"
  })

  const canSubmit = computed(
    () => state.value === "form" && !submitting.value && email.value.trim().length > 0 && consentAccepted.value
  )

  const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string) => errors?.[0]?.extensions?.[key]

  const applyFailure = (errors: readonly GraphQLErrorLike[] | undefined) => {
    const code = readExtension(errors, "code")
    const id = readExtension(errors, "requestId")
    requestId.value = typeof id === "string" ? id : null

    const retryAfter = readExtension(errors, "retryAfter")
    errorRetryAfter.value = typeof retryAfter === "number" ? retryAfter : null
    errorKind.value = loginErrorKind(code, readExtension(errors, "field"))
  }

  const submit = async () => {
    if (!canSubmit.value && !sentTo.value) return
    submitting.value = true
    errorKind.value = null
    errorRetryAfter.value = null
    requestId.value = null

    try {
      const envelope = (await useGraphQL(RequestMagicLinkDocument, {
        email: email.value.trim(),
        consentVersion: {
          termsVersion: legal.value?.termsVersion ?? null,
          privacyVersion: legal.value?.privacyVersion ?? null
        },
        locale: locale.value as "ru" | "en",
        next: nextPath.value
      })) as GraphQLEnvelope<RequestMagicLinkMutation>

      if (!envelope.data?.requestMagicLink?.ok) {
        applyFailure(envelope.errors)
        return
      }

      retryAfterSec.value = envelope.data.requestMagicLink.retryAfterSec
      sentTo.value = email.value.trim()
    } catch {
      errorKind.value = "generic"
    } finally {
      submitting.value = false
    }
  }

  const changeAddress = () => {
    sentTo.value = null
    retryAfterSec.value = null
    email.value = ""
    consentAccepted.value = false
  }

  const errorMessage = computed(() => {
    if (!errorKind.value) return null
    if (errorKind.value === "rateLimited") {
      const minutes = errorRetryAfter.value === null ? null : Math.max(1, Math.ceil(errorRetryAfter.value / 60))
      return t("auth.login.error.rateLimited", { retryAfter: minutes === null ? "—" : `${minutes}` })
    }
    if (errorKind.value === "generic") {
      return t("auth.login.error.generic", { requestId: requestId.value ?? "—" })
    }
    return t(`auth.login.error.${errorKind.value}`)
  })

  useSeoMeta({
    title: () => `${t("auth.login.title")} — Altera`,
    robots: "noindex, follow"
  })
</script>

<template>
  <section class="mx-auto flex w-full max-w-md flex-col gap-8 px-4 py-16" :data-login-state="state">
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

    <template v-else-if="state === 'data_error'">
      <div class="flex flex-col gap-4" role="alert">
        <h1 class="text-2xl font-semibold">{{ t("auth.login.title") }}</h1>
        <p>{{ t("auth.login.error.legalUnavailable") }}</p>
      </div>
    </template>

    <template v-else>
      <form class="flex flex-col gap-6" novalidate @submit.prevent="submit">
        <h1 class="text-2xl font-semibold">{{ t("auth.login.title") }}</h1>

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

        <label class="flex items-start gap-3">
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

        <p class="text-sm opacity-80">{{ t("auth.login.hint") }}</p>

        <button
          type="submit"
          :disabled="!canSubmit"
          class="rounded bg-zinc-900 px-4 py-2 font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {{ t("auth.login.submitButton") }}
        </button>

        <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
      </form>

      <aside class="flex flex-col gap-2 text-sm opacity-80">
        <p>{{ t("auth.login.why") }}</p>
        <!-- Страница тарифов появится отдельной задачей; адрес зафиксирован реестром маршрутов. -->
        <a href="/pricing" class="underline">{{ t("auth.login.pricingLink") }}</a>
      </aside>
    </template>
  </section>
</template>
