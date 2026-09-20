<script setup lang="ts">
  import { AcceptConsentDocument, VerifyMagicLinkDocument } from "~/graphql/generated/graphql"
  import type {
    AcceptConsentMutation,
    VerifyMagicLinkMutation,
    VerifyOutcomeFragment
  } from "~/graphql/generated/graphql"
  import { verifyErrorState, type VerifyState } from "~/utils/authStates"

  // Языкового префикса у страницы нет: язык берётся из токена (docs/spec/20-public/verify.md §3).
  definePageMeta({ i18n: false, layout: "auth" })

  interface GraphQLErrorLike {
    extensions?: Record<string, unknown> | null
  }

  interface GraphQLEnvelope<T> {
    data?: T | null
    errors?: readonly GraphQLErrorLike[]
  }

  const { t } = useI18n()
  const route = useRoute()
  const session = useAuthSession()

  const queryValue = (key: string) => (typeof route.query[key] === "string" ? (route.query[key] as string) : null)
  const queryVersion = (key: string) => {
    const raw = queryValue(key)
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10)
    return Number.isInteger(parsed) ? parsed : null
  }

  const token = computed(() => queryValue("token"))

  const state = ref<VerifyState>("loading")
  const requestId = ref<string | null>(null)
  const consentVersions = ref<{ termsVersion: number | null; privacyVersion: number | null }>({
    termsVersion: null,
    privacyVersion: null
  })
  const appealToken = ref<string | null>(null)

  const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string) => errors?.[0]?.extensions?.[key]

  const applyFailure = (errors: readonly GraphQLErrorLike[] | undefined) => {
    const id = readExtension(errors, "requestId")
    requestId.value = typeof id === "string" ? id : null
    state.value = verifyErrorState(readExtension(errors, "code"))
  }

  const applyOutcome = async (result: VerifyOutcomeFragment) => {
    if (result.outcome === "archived_admin") {
      appealToken.value = result.appealToken
      state.value = "blocked"
      return
    }

    if (result.outcome === "consent_required") {
      consentVersions.value = { termsVersion: result.termsVersion, privacyVersion: result.privacyVersion }
      state.value = "consent"
      return
    }

    if (!result.session) {
      state.value = "error"
      return
    }

    session.start(result.session)

    // Самостоятельный архив: ограниченная сессия и экран состояния (журнал §5.2).
    const destination = result.outcome === "archived_self" ? "/me/archived" : (result.next ?? "/me")
    await navigateTo(destination, { replace: true, redirectCode: 302 })
  }

  // Обмен токена и принятие новых условий выполняет SSR до рендера (verify.md §8):
  // токены сессии не попадают в браузерный JS (ADR-0023).
  await useAsyncData("auth-verify", async () => {
    if (!token.value) {
      await navigateTo("/login", { replace: true, redirectCode: 302 })
      return null
    }

    const accepting = queryValue("consent") === "accept"

    try {
      const envelope = accepting
        ? ((await useGraphQL(AcceptConsentDocument, {
            token: token.value,
            termsVersion: queryVersion("terms"),
            privacyVersion: queryVersion("privacy")
          })) as GraphQLEnvelope<AcceptConsentMutation>)
        : ((await useGraphQL(VerifyMagicLinkDocument, {
            token: token.value
          })) as GraphQLEnvelope<VerifyMagicLinkMutation>)

      const result =
        "acceptConsent" in (envelope.data ?? {})
          ? (envelope.data as AcceptConsentMutation).acceptConsent
          : (envelope.data as VerifyMagicLinkMutation | null | undefined)?.verifyMagicLink

      if (!result) {
        applyFailure(envelope.errors)
        return null
      }

      await applyOutcome(result)
    } catch {
      state.value = "error"
    }

    return null
  })

  useSeoMeta({
    title: () => `${t("auth.login.title")} — Altera`,
    robots: "noindex, nofollow",
    referrer: "no-referrer"
  })
</script>

<template>
  <section class="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16" :data-verify-state="state">
    <template v-if="state === 'loading'">
      <h1 class="text-2xl font-semibold">{{ t("auth.verify.loading.title") }}</h1>
      <p>{{ t("auth.verify.loading.body") }}</p>
    </template>

    <template v-else-if="state === 'invalid'">
      <h1 class="text-2xl font-semibold">{{ t("auth.verify.expired.title") }}</h1>
      <p>{{ t("auth.verify.expired.body") }}</p>
      <NuxtLink to="/login" class="font-semibold underline">{{ t("auth.verify.expired.action") }}</NuxtLink>
    </template>

    <template v-else-if="state === 'rate_limited'">
      <h1 class="text-2xl font-semibold">{{ t("auth.verify.rateLimited.title") }}</h1>
      <p>{{ t("auth.verify.rateLimited.body") }}</p>
      <NuxtLink to="/login" class="font-semibold underline">{{ t("auth.verify.expired.action") }}</NuxtLink>
    </template>

    <template v-else-if="state === 'consent'">
      <h1 class="text-2xl font-semibold">{{ t("auth.verify.consent.title") }}</h1>
      <p>{{ t("auth.verify.consent.body") }}</p>
      <ul class="flex flex-col gap-1">
        <li>
          <a href="/legal/terms" target="_blank" rel="noopener" class="underline">
            {{ t("auth.verify.consent.offertaLink") }} v{{ consentVersions.termsVersion }}
          </a>
        </li>
        <li>
          <a href="/legal/privacy" target="_blank" rel="noopener" class="underline">
            {{ t("auth.verify.consent.privacyLink") }} v{{ consentVersions.privacyVersion }}
          </a>
        </li>
      </ul>
      <!-- Обычная отправка формы: принятие обрабатывает тот же SSR-обмен, поэтому токены
           сессии не проходят через браузерный JS. -->
      <form method="get" action="/auth/verify">
        <input type="hidden" name="token" :value="token" />
        <input type="hidden" name="consent" value="accept" />
        <input type="hidden" name="terms" :value="consentVersions.termsVersion ?? ''" />
        <input type="hidden" name="privacy" :value="consentVersions.privacyVersion ?? ''" />
        <button
          type="submit"
          class="rounded bg-zinc-900 px-4 py-2 font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
          {{ t("auth.verify.consent.accept") }}
        </button>
      </form>
    </template>

    <template v-else-if="state === 'blocked'">
      <h1 class="text-2xl font-semibold">{{ t("auth.verify.blocked.title") }}</h1>
      <p>{{ t("auth.verify.blocked.body") }}</p>
      <NuxtLink :to="`/auth/appeal?token=${appealToken}`" class="font-semibold underline">
        {{ t("auth.verify.blocked.action") }}
      </NuxtLink>
    </template>

    <template v-else>
      <h1 class="text-2xl font-semibold" role="alert">{{ t("auth.verify.error.title") }}</h1>
      <p>{{ t("auth.verify.error.body", { requestId: requestId ?? "—" }) }}</p>
      <NuxtLink to="/login" class="font-semibold underline">{{ t("auth.verify.error.action") }}</NuxtLink>
    </template>
  </section>
</template>
