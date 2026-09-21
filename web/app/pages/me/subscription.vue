<script setup lang="ts">
  import { GetAccountSubscriptionDocument } from "~/graphql/generated/graphql"
  import { resolveSubscriptionOutcome, subscriptionView, type SubscriptionOutcome } from "~/utils/accountSubscription"
  import ErrorState from "~/components/reading/ErrorState.vue"

  definePageMeta({
    i18n: false,
    layout: "auth",
    requiresAuth: true
  })

  // Спецификация: docs/spec/30-account/reader/subscription.md. Таблица состояний — §8.
  // Первый запуск идёт без платности (журнал §24.1): страница показывает план из выдач и не
  // содержит платёжных действий, а `/me/subscription/checkout` и `/result` страниц не имеют (404).
  const { t, locale } = useI18n()
  const session = useAuthSession()

  useHead({
    title: () => `${t("account.subscription.pageTitle")} — Altera`,
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })

  const subscriptionData = useAsyncData(
    "account-subscription",
    async (): Promise<SubscriptionOutcome> => {
      try {
        return resolveSubscriptionOutcome(await useGraphQL(GetAccountSubscriptionDocument))
      } catch {
        return { kind: "error", requestId: null }
      }
    },
    { lazy: true }
  )
  // На сервере план дожидается рендера, чтобы редиректы §3 были ответом 302, а «Ошибка
  // данных» — 500; при клиентском переходе загрузка ленивая — это строка «Загрузка» со скелетом.
  if (import.meta.server) await subscriptionData
  const { data: outcome, status, refresh } = subscriptionData

  const leave = async (value: SubscriptionOutcome | null | undefined) => {
    if (value?.kind === "archived") return navigateTo("/me/archived", { replace: true, redirectCode: 302 })
    if (value?.kind === "signIn") {
      session.clear()
      return navigateTo({ path: "/login", query: { next: "/me/subscription" } }, { replace: true, redirectCode: 302 })
    }
  }

  if (import.meta.server) {
    await leave(outcome.value)
    if (outcome.value?.kind === "error") {
      const event = useRequestEvent()
      if (event) setResponseStatus(event, 500)
    }
  }
  watch(outcome, (value) => leave(value))

  const account = computed(() => (outcome.value?.kind === "ready" ? outcome.value.account : null))
  const view = computed(() => (account.value ? subscriptionView(account.value) : null))
  const subscription = computed(() => account.value?.subscription ?? null)
  const requestId = computed(() =>
    outcome.value?.kind === "error" ? (outcome.value.requestId ?? undefined) : undefined
  )

  type PageState = "loading" | "data_error" | "plan_limit" | "service" | "ready"
  const pageState = computed<PageState>(() => {
    if (outcome.value?.kind === "error") return "data_error"
    if (!view.value || status.value === "pending") return "loading"
    if (view.value === "expired") return "plan_limit"
    if (view.value === "service") return "service"
    return "ready"
  })

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale.value, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(value)
    )

  const tierName = (tier: string) => t(`account.dashboard.plan.tier.${tier}`)

  const headline = computed(() => {
    const plan = subscription.value
    if (!plan) return ""
    if (view.value === "active" && plan.until)
      return t("account.subscription.plan.activeUntil", { tier: tierName(plan.tier), date: formatDate(plan.until) })
    if (view.value === "expired") {
      return plan.endedAt
        ? t("account.subscription.plan.expiredOn", { date: formatDate(plan.endedAt) })
        : t("account.subscription.plan.expired")
    }
    return t("account.subscription.plan.base")
  })

  const queue = computed(() =>
    (subscription.value?.queue ?? []).map((period) =>
      period.endsAt
        ? t("account.subscription.queue.period", {
            tier: tierName(period.tier),
            start: formatDate(period.startsAt),
            end: formatDate(period.endsAt)
          })
        : t("account.subscription.queue.periodOpen", {
            tier: tierName(period.tier),
            start: formatDate(period.startsAt)
          })
    )
  )
</script>

<template>
  <section class="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-16" :data-subscription-state="pageState">
    <h1 class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">{{ t("account.subscription.pageTitle") }}</h1>

    <div
      v-if="pageState === 'loading'"
      data-testid="subscription-skeleton"
      :aria-label="t('account.subscription.loading')"
      aria-busy="true"
      class="flex flex-col gap-3">
      <span class="h-28 w-full animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
      <span class="h-16 w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>

    <div v-else-if="pageState === 'data_error'" data-testid="subscription-error" class="flex flex-col gap-6">
      <ErrorState
        :request-id="requestId"
        :title="t('account.subscription.error.title')"
        :description="t('account.subscription.error.description')" />
      <button
        type="button"
        class="self-center border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 hover:border-orange-600 hover:text-orange-700 dark:text-zinc-400"
        @click="refresh()">
        {{ t("account.subscription.retry") }}
      </button>
    </div>

    <!-- Служебная запись: вместо плана — пояснение §8.17 и ссылка в «Подписки» админки (§2). -->
    <section
      v-else-if="pageState === 'service'"
      data-testid="subscription-service"
      class="flex flex-col gap-3 rounded-2xl bg-zinc-100 p-5 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <p class="font-sans text-base font-medium">{{ t("account.subscription.service.title") }}</p>
      <NuxtLink
        to="/admin/subscriptions"
        data-testid="subscription-service-admin"
        class="self-start border-b border-orange-600 pb-0.5 font-sans text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600">
        {{ t("account.subscription.service.link") }}
      </NuxtLink>
    </section>

    <template v-else-if="subscription">
      <!-- Зона 2: план из выдач. Платёжных действий на первом запуске нет (журнал §24.1). -->
      <section
        data-testid="subscription-plan"
        :data-plan-view="view"
        :class="[
          'flex flex-col gap-2 rounded-2xl p-5',
          view === 'expired'
            ? 'bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-100'
            : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100'
        ]">
        <h2 class="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          {{ t("account.subscription.plan.title") }}
        </h2>
        <p class="font-sans text-base font-medium" data-testid="subscription-plan-headline">{{ headline }}</p>
        <p v-if="view === 'active'" class="font-sans text-sm" data-testid="subscription-plan-source">
          {{ t("account.subscription.plan.source") }}
        </p>
        <template v-if="view === 'expired'">
          <p class="font-sans text-sm" data-testid="subscription-plan-readonly">
            {{ t("account.subscription.plan.readOnly") }}
          </p>
          <!-- Оплаты на запуске нет, поэтому «продлить» ведёт на планы, а не на checkout. -->
          <NuxtLink
            to="/pricing"
            data-testid="subscription-plan-renew"
            class="self-start border-b border-orange-600 pb-0.5 font-sans text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600">
            {{ t("account.subscription.plan.renew") }}
          </NuxtLink>
        </template>
        <p v-else class="font-sans text-sm text-zinc-600 dark:text-zinc-400" data-testid="subscription-plan-later">
          {{ t("account.subscription.plan.later") }}
        </p>
      </section>

      <!-- Зона 3: очередь периодов; пустая очередь скрыта (§5 п. 3). -->
      <section v-if="queue.length" id="queue" data-testid="subscription-queue" class="flex flex-col gap-3">
        <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("account.subscription.queue.title") }}
        </h2>
        <ul class="flex flex-col gap-2 font-sans text-base text-zinc-900 dark:text-zinc-100">
          <li v-for="(period, index) in queue" :key="index">{{ period }}</li>
        </ul>
      </section>

      <!-- Зона 5: до включения платности платежей не бывает (§4 «`me.payments` пуст»). -->
      <section id="payments" data-testid="subscription-payments" class="flex flex-col gap-3">
        <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("account.subscription.payments.title") }}
        </h2>
        <p class="font-sans text-base text-zinc-700 dark:text-zinc-300">
          {{ t("account.subscription.payments.empty") }}
        </p>
      </section>

      <!-- Зона 6: оферты платных услуг и политики возвратов на запуске нет — ссылка только на планы. -->
      <section data-testid="subscription-help" class="flex flex-col gap-3">
        <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("account.subscription.help.title") }}
        </h2>
        <NuxtLink
          to="/pricing"
          data-testid="subscription-help-pricing"
          class="self-start border-b border-orange-600 font-sans text-sm text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
          {{ t("account.subscription.help.pricing") }}
        </NuxtLink>
      </section>
    </template>
  </section>
</template>
