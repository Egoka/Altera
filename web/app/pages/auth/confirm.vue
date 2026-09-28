<script setup lang="ts">
  import { ConfirmEmailDocument } from "~/graphql/generated/graphql"
  import type { ConfirmEmailMutation } from "~/graphql/generated/graphql"

  // Языкового префикса у страницы нет: язык берётся из токена, как у `/auth/verify`.
  definePageMeta({ i18n: false, layout: "auth" })

  /**
   * Подтверждение адреса после регистрации с паролем (T-115, журнал §34 п. 7). Обмен идёт на
   * SSR и заканчивается редиректом, поэтому токены сессии не проходят через браузерный JS
   * (ADR-0023 п. 2) — как и в ветке ссылки.
   */
  type ConfirmResolution =
    | { kind: "redirect"; to: string }
    | { kind: "invalid" }
    | { kind: "error"; requestId: string | null }

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

  const token = computed(() => (typeof route.query.token === "string" ? route.query.token : null))

  const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string) => errors?.[0]?.extensions?.[key]

  const { data: resolution } = await useAsyncData<ConfirmResolution>("auth-confirm", async () => {
    if (!token.value) return { kind: "redirect", to: "/login" }

    try {
      const envelope = (await useGraphQL(ConfirmEmailDocument, {
        token: token.value
      })) as GraphQLEnvelope<ConfirmEmailMutation>
      const result = envelope.data?.confirmEmail

      if (!result) {
        const id = readExtension(envelope.errors, "requestId")
        // Неизвестная, использованная и истёкшая ссылка отвечают одинаково (`verify.md` §4).
        if (readExtension(envelope.errors, "code") === "NOT_FOUND") return { kind: "invalid" }
        return { kind: "error", requestId: typeof id === "string" ? id : null }
      }

      if (result.outcome === "archived_admin") {
        return { kind: "redirect", to: `/auth/appeal?token=${result.appealToken ?? ""}` }
      }
      if (result.outcome === "consent_required") {
        return { kind: "redirect", to: `/auth/verify?token=${result.consentToken ?? ""}` }
      }
      if (!result.session) return { kind: "error", requestId: null }

      session.start(result.session)

      return {
        kind: "redirect",
        to: result.outcome === "archived_self" ? "/me/archived" : (result.next ?? "/me")
      }
    } catch {
      return { kind: "error", requestId: null }
    }
  })

  if (resolution.value?.kind === "redirect") {
    await navigateTo(resolution.value.to, { replace: true, redirectCode: 302 })
  }

  const state = computed(() => resolution.value?.kind ?? "redirect")
  const requestId = computed(() => (resolution.value?.kind === "error" ? resolution.value.requestId : null))

  useSeoMeta({
    title: () => `${t("auth.login.title")} — Altera`,
    robots: "noindex, nofollow",
    referrer: "no-referrer"
  })
</script>

<template>
  <section class="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16" :data-confirm-state="state">
    <template v-if="state === 'redirect'">
      <h1 class="text-2xl font-semibold">{{ t("auth.confirm.loading.title") }}</h1>
      <p>{{ t("auth.confirm.loading.body") }}</p>
    </template>

    <template v-else-if="state === 'invalid'">
      <h1 class="text-2xl font-semibold">{{ t("auth.confirm.expired.title") }}</h1>
      <p>{{ t("auth.confirm.expired.body") }}</p>
      <NuxtLink to="/login" class="font-semibold underline">{{ t("auth.confirm.expired.action") }}</NuxtLink>
    </template>

    <template v-else>
      <h1 class="text-2xl font-semibold">{{ t("auth.verify.error.title") }}</h1>
      <p>{{ t("auth.verify.error.body", { requestId: requestId ?? "—" }) }}</p>
      <NuxtLink to="/login" class="font-semibold underline">{{ t("auth.verify.error.action") }}</NuxtLink>
    </template>
  </section>
</template>
