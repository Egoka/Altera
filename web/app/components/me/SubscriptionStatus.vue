<script setup lang="ts">
  import type { AccountDashboard } from "~/middleware/account-dashboard"

  type Subscription = NonNullable<AccountDashboard["subscription"]>

  /**
   * Зона 3 сводки (`dashboard.md` §5–6): план, срок и очередь периодов одной строкой (журнал
   * §8.22). На первом запуске платежей нет (журнал §24.1), поэтому вариантов «серия списаний» и
   * «отменить продление» у карточки нет.
   */
  const props = defineProps<{ subscription: Subscription }>()
  const { t, locale } = useI18n()

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale.value, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(value)
    )

  const tierName = (tier: Subscription["tier"]) => t(`account.dashboard.plan.tier.${tier}`)

  const headline = computed(() => {
    const { state, tier, until, endedAt } = props.subscription
    if (state === "active" && until)
      return t("account.dashboard.plan.activeUntil", { tier: tierName(tier), date: formatDate(until) })
    if (state === "expired") {
      return endedAt
        ? t("account.dashboard.plan.expiredOn", { date: formatDate(endedAt) })
        : t("account.dashboard.plan.expired")
    }
    return t("account.dashboard.plan.base")
  })

  const queueLine = computed(() => {
    if (!props.subscription.queue.length) return null
    const periods = props.subscription.queue.map((period) =>
      period.endsAt
        ? t("account.dashboard.plan.periodUntil", { tier: tierName(period.tier), date: formatDate(period.endsAt) })
        : tierName(period.tier)
    )
    return t("account.dashboard.plan.queue", { periods: periods.join(", ") })
  })
</script>

<template>
  <section
    data-testid="dashboard-plan"
    :data-plan-state="subscription.state"
    :class="[
      'flex flex-col gap-2 rounded-2xl p-5',
      subscription.state === 'expired'
        ? 'bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-100'
        : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100'
    ]">
    <h2 class="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
      {{ t("account.dashboard.plan.title") }}
    </h2>
    <p class="font-sans text-base font-medium" data-testid="dashboard-plan-headline">{{ headline }}</p>
    <p v-if="queueLine" class="font-sans text-sm" data-testid="dashboard-plan-queue">{{ queueLine }}</p>
    <template v-if="subscription.state === 'expired'">
      <p class="font-sans text-sm" data-testid="dashboard-plan-readonly">{{ t("account.dashboard.plan.readOnly") }}</p>
      <NuxtLink
        to="/pricing"
        data-testid="dashboard-plan-renew"
        class="self-start border-b border-orange-600 pb-0.5 font-sans text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600">
        {{ t("account.dashboard.plan.renew") }}
      </NuxtLink>
    </template>
  </section>
</template>
