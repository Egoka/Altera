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

  /**
   * Результат обмена переносится в payload страницы и переживает гидратацию. Токены сессии
   * в него не попадают: они уходят в httpOnly-cookie на сервере (ADR-0023).
   */
  type VerifyResolution =
    | { kind: "redirect"; to: string }
    | { kind: "state"; state: VerifyState; requestId: string | null }
    | { kind: "consent"; termsVersion: number | null; privacyVersion: number | null }
    | { kind: "blocked"; appealToken: string | null }

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

  const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string) => errors?.[0]?.extensions?.[key]

  const failure = (errors: readonly GraphQLErrorLike[] | undefined): VerifyResolution => {
    const id = readExtension(errors, "requestId")
    return {
      kind: "state",
      state: verifyErrorState(readExtension(errors, "code")),
      requestId: typeof id === "string" ? id : null
    }
  }

  const resolveOutcome = (result: VerifyOutcomeFragment): VerifyResolution => {
    if (result.outcome === "archived_admin") return { kind: "blocked", appealToken: result.appealToken }

    if (result.outcome === "consent_required") {
      return { kind: "consent", termsVersion: result.termsVersion, privacyVersion: result.privacyVersion }
    }

    if (!result.session) return { kind: "state", state: "error", requestId: null }

    session.start(result.session)

    // Самостоятельный архив: ограниченная сессия и экран состояния (журнал §5.2).
    return {
      kind: "redirect",
      to: result.outcome === "archived_self" ? "/me/archived" : (result.next ?? "/me")
    }
  }

  // Обмен токена и принятие новых условий выполняет SSR до рендера (verify.md §8).
  const { data: resolution } = await useAsyncData<VerifyResolution>("auth-verify", async () => {
    if (!token.value) return { kind: "redirect", to: "/login" }

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

      const result = accepting
        ? (envelope.data as AcceptConsentMutation | null | undefined)?.acceptConsent
        : (envelope.data as VerifyMagicLinkMutation | null | undefined)?.verifyMagicLink

      return result ? resolveOutcome(result) : failure(envelope.errors)
    } catch {
      return { kind: "state", state: "error", requestId: null }
    }
  })

  if (resolution.value?.kind === "redirect") {
    await navigateTo(resolution.value.to, { replace: true, redirectCode: 302 })
  }

  const state = computed<VerifyState>(() => {
    const current = resolution.value
    if (!current || current.kind === "redirect") return "loading"
    if (current.kind === "consent") return "consent"
    if (current.kind === "blocked") return "blocked"
    return current.state
  })

  const consentVersions = computed(() =>
    resolution.value?.kind === "consent"
      ? { termsVersion: resolution.value.termsVersion, privacyVersion: resolution.value.privacyVersion }
      : { termsVersion: null, privacyVersion: null }
  )
  const appealToken = computed(() => (resolution.value?.kind === "blocked" ? resolution.value.appealToken : null))
  const requestId = computed(() => (resolution.value?.kind === "state" ? resolution.value.requestId : null))

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
      <h1 class="text-2xl font-semibold">{{ t("auth.verify.error.title") }}</h1>
      <p>{{ t("auth.verify.error.body", { requestId: requestId ?? "—" }) }}</p>
      <NuxtLink to="/login" class="font-semibold underline">{{ t("auth.verify.error.action") }}</NuxtLink>
    </template>
  </section>
</template>
