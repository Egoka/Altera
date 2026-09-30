<script setup lang="ts">
  import { watch } from "vue"
  import {
    AccountAppealDocument,
    SubmitAccountAppealDocument,
    type AccountAppealQuery,
    type SubmitAccountAppealMutation
  } from "~/graphql/generated/graphql"

  definePageMeta({ i18n: false, layout: "auth" })

  interface GraphQLErrorLike {
    extensions?: Record<string, unknown> | null
  }

  interface GraphQLEnvelope<T> {
    data?: T | null
    errors?: readonly GraphQLErrorLike[]
  }

  type AppealView = AccountAppealQuery["accountAppeal"]
  type PageResolution =
    | { kind: "view"; view: AppealView }
    | { kind: "not_found" }
    | { kind: "forbidden" }
    | { kind: "rate_limited"; retryAfter: number | null }
    | { kind: "error"; requestId: string | null }

  const { t, setLocale } = useI18n()
  const route = useRoute()
  const event = useRequestEvent()
  const token = computed(() => (typeof route.query.token === "string" ? route.query.token : null))
  const message = ref("")
  const submitting = ref(false)
  const validation = ref(false)
  const actionError = ref<string | null>(null)

  const extension = (errors: readonly GraphQLErrorLike[] | undefined, key: string) => errors?.[0]?.extensions?.[key]

  const failed = (errors: readonly GraphQLErrorLike[] | undefined): PageResolution => {
    const code = extension(errors, "code")
    if (code === "NOT_FOUND") return { kind: "not_found" }
    if (code === "FORBIDDEN") return { kind: "forbidden" }
    if (code === "RATE_LIMITED") {
      const retryAfter = extension(errors, "retryAfter")
      return { kind: "rate_limited", retryAfter: typeof retryAfter === "number" ? retryAfter : null }
    }
    const requestId = extension(errors, "requestId")
    return { kind: "error", requestId: typeof requestId === "string" ? requestId : null }
  }

  const asyncKey = computed(() => `account-appeal:${token.value ?? "missing"}`)
  // Без top-level await клиентский переход не блокируется Suspense: пользователь видит
  // предусмотренный спецификацией loading-state. SSR всё равно ждёт useAsyncData и отдаёт
  // окончательную разметку вместе с корректным HTTP-статусом.
  const { data: resolution, status: loadingStatus } = useAsyncData<PageResolution>(asyncKey, async () => {
    if (!token.value) return { kind: "not_found" }
    try {
      const envelope = (await useGraphQL(AccountAppealDocument, {
        token: token.value
      })) as GraphQLEnvelope<AccountAppealQuery>
      return envelope.data?.accountAppeal
        ? { kind: "view", view: envelope.data.accountAppeal }
        : failed(envelope.errors)
    } catch {
      return { kind: "error", requestId: null }
    }
  })

  const setStatus = (status: number) => {
    if (event) setResponseStatus(event, status)
  }
  watch(
    resolution,
    (current) => {
      if (current?.kind === "view") void setLocale(current.view.locale)
      if (current?.kind === "not_found") setStatus(404)
      if (current?.kind === "forbidden") setStatus(403)
      if (current?.kind === "rate_limited") setStatus(200)
      if (current?.kind === "error") setStatus(500)
    },
    { immediate: true }
  )

  const state = computed(() => {
    if (loadingStatus.value === "pending" || !resolution.value) return "loading"
    if (resolution.value.kind !== "view") return resolution.value.kind
    return resolution.value.view.appeal.status
  })
  const view = computed(() => (resolution.value?.kind === "view" ? resolution.value.view : null))
  const requestId = computed(() => (resolution.value?.kind === "error" ? resolution.value.requestId : null))
  const retryAfterMinutes = computed(() => {
    const seconds = resolution.value?.kind === "rate_limited" ? resolution.value.retryAfter : null
    return seconds === null ? "—" : `${Math.max(1, Math.ceil(seconds / 60))}`
  })
  const messageLength = computed(() => message.value.trim().length)
  const canSubmit = computed(
    () => messageLength.value >= 20 && messageLength.value <= 2000 && !submitting.value && Boolean(token.value)
  )

  const formatDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" }) : "—"

  const submit = async () => {
    validation.value = !canSubmit.value
    actionError.value = null
    if (!canSubmit.value || !token.value || !view.value) return
    submitting.value = true
    try {
      const envelope = (await useGraphQL(SubmitAccountAppealDocument, {
        token: token.value,
        message: message.value.trim()
      })) as GraphQLEnvelope<SubmitAccountAppealMutation>
      const submitted = envelope.data?.submitAccountAppeal
      if (submitted) {
        resolution.value = { kind: "view", view: { ...view.value, appeal: submitted, canSubmit: false } }
        return
      }
      const code = extension(envelope.errors, "code")
      if (code === "CONFLICT") {
        resolution.value = {
          kind: "view",
          view: {
            ...view.value,
            canSubmit: false,
            appeal: {
              id: view.value.appeal.id,
              status: "submitted",
              submittedAt: view.value.appeal.submittedAt,
              decidedAt: null
            }
          }
        }
      } else {
        const id = extension(envelope.errors, "requestId")
        actionError.value = typeof id === "string" ? id : "—"
      }
    } catch {
      actionError.value = "—"
    } finally {
      submitting.value = false
    }
  }

  useSeoMeta({
    title: () => `${t("auth.appeal.title")} — Altera`,
    robots: "noindex, nofollow",
    referrer: "no-referrer"
  })
</script>

<template>
  <section class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12 font-sans" :data-appeal-state="state">
    <template v-if="state === 'loading'">
      <h1 class="font-serif text-3xl">{{ t("auth.appeal.loading.title") }}</h1>
      <div class="h-28 animate-pulse bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800"></div>
    </template>

    <template v-else-if="state === 'not_found'">
      <h1 class="font-serif text-3xl">{{ t("auth.appeal.notFound.title") }}</h1>
      <p>{{ t("auth.appeal.notFound.body") }}</p>
      <NuxtLink to="/login" class="font-semibold underline">{{ t("auth.appeal.newLink") }}</NuxtLink>
    </template>

    <template v-else-if="state === 'forbidden'">
      <h1 class="font-serif text-3xl">{{ t("auth.appeal.forbidden.title") }}</h1>
      <p>{{ t("auth.appeal.forbidden.body") }}</p>
      <NuxtLink to="/contact" class="font-semibold underline">{{ t("auth.appeal.contact") }}</NuxtLink>
    </template>

    <template v-else-if="state === 'rate_limited'">
      <h1 class="font-serif text-3xl">{{ t("auth.appeal.rateLimited.title") }}</h1>
      <p>{{ t("auth.appeal.rateLimited.body", { minutes: retryAfterMinutes }) }}</p>
    </template>

    <template v-else-if="state === 'error'">
      <h1 class="font-serif text-3xl">{{ t("auth.appeal.error.title") }}</h1>
      <p>{{ t("auth.appeal.error.body", { requestId: requestId ?? "—" }) }}</p>
    </template>

    <template v-else-if="view">
      <header>
        <p class="text-sm uppercase tracking-wide text-zinc-500">{{ t("auth.appeal.eyebrow") }}</p>
        <h1 class="mt-2 font-serif text-3xl">{{ t("auth.appeal.title") }}</h1>
      </header>

      <article class="border border-zinc-300 p-5 dark:border-zinc-700" data-appeal-reason>
        <h2 class="font-semibold">
          {{ t("auth.appeal.restrictedAt", { date: formatDate(view.archivedAt) }) }}
        </h2>
        <p class="mt-3 font-semibold">{{ t(`auth.appeal.reasonCategory.${view.reasonCategory}`) }}</p>
        <p class="mt-2">{{ view.explanation }}</p>
        <p v-if="view.staffMessage" class="mt-3 border-l-2 border-zinc-400 pl-3">{{ view.staffMessage }}</p>
        <p class="mt-4 text-sm">{{ t("auth.appeal.hiddenData") }}</p>
        <NuxtLink to="/legal/content-rules" class="mt-3 inline-block underline">
          {{ t("auth.appeal.rules") }}
        </NuxtLink>
      </article>

      <article v-if="view.plan" data-appeal-plan class="border border-zinc-300 p-5 dark:border-zinc-700">
        <h2 class="font-semibold">{{ t("auth.appeal.plan.title") }}</h2>
        <p class="mt-2">
          {{ t("auth.appeal.plan.body", { tier: view.plan.tier, date: formatDate(view.plan.until) }) }}
        </p>
      </article>

      <form v-if="state === 'none'" data-appeal-form class="flex flex-col gap-3" @submit.prevent="submit">
        <label for="appeal-message" class="font-semibold">{{ t("auth.appeal.form.label") }}</label>
        <textarea
          id="appeal-message"
          v-model="message"
          rows="6"
          maxlength="2000"
          :placeholder="t('auth.appeal.form.hint')"
          class="border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"></textarea>
        <p class="text-sm text-zinc-500">{{ messageLength }} / 2000</p>
        <p v-if="validation" data-appeal-validation role="alert">{{ t("auth.appeal.form.validation") }}</p>
        <p v-if="actionError" role="alert">{{ t("auth.appeal.error.body", { requestId: actionError }) }}</p>
        <p class="text-sm">{{ t("auth.appeal.form.once") }}</p>
        <button
          type="submit"
          :disabled="submitting"
          class="min-h-11 bg-zinc-950 px-4 font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950">
          {{ submitting ? t("auth.appeal.form.submitting") : t("auth.appeal.form.submit") }}
        </button>
      </form>

      <article v-else-if="state === 'submitted'" data-appeal-status>
        <h2 class="font-serif text-2xl">{{ t("auth.appeal.submitted.title") }}</h2>
        <p class="mt-2">{{ t("auth.appeal.submitted.body", { date: formatDate(view.appeal.submittedAt) }) }}</p>
      </article>

      <article v-else-if="state === 'restored'" data-appeal-status>
        <h2 class="font-serif text-2xl">{{ t("auth.appeal.restored.title") }}</h2>
        <p class="mt-2">{{ t("auth.appeal.restored.body") }}</p>
        <NuxtLink to="/login" class="mt-3 inline-block font-semibold underline">{{
          t("auth.appeal.restored.login")
        }}</NuxtLink>
      </article>

      <article v-else-if="state === 'confirmed'" data-appeal-status>
        <h2 class="font-serif text-2xl">{{ t("auth.appeal.confirmed.title") }}</h2>
        <p class="mt-2">{{ t("auth.appeal.confirmed.body", { date: formatDate(view.appeal.decidedAt) }) }}</p>
        <NuxtLink to="/contact" class="mt-3 inline-block underline">{{ t("auth.appeal.confirmed.contact") }}</NuxtLink>
      </article>

      <footer class="border-t border-zinc-200 pt-5 dark:border-zinc-800">
        <NuxtLink to="/contact" class="underline">{{ t("auth.appeal.contact") }}</NuxtLink>
      </footer>
    </template>
  </section>
</template>
