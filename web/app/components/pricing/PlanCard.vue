<script setup lang="ts">
  import type { PricingLaunchAvailability, PricingPlanTier } from "~/utils/pricingLaunch"

  // Карточка плана на первом запуске: название, чем план полезен, перечень возможностей.
  // Ни цены, ни кнопки оплаты здесь нет и быть не может — платность включается отдельным
  // этапом (журнал §24.1). Вместо цены карточка несёт пометку о доступности.
  defineProps<{
    tier: PricingPlanTier
    availability: PricingLaunchAvailability
    features: readonly string[]
    highlighted?: boolean
  }>()

  const { t } = useI18n()
</script>

<template>
  <article
    class="flex h-full flex-col"
    :data-plan="tier"
    :data-availability="availability"
    :aria-labelledby="`plan-${tier}-title`">
    <h3 :id="`plan-${tier}-title`" class="font-waterway text-3xl tracking-wide text-zinc-950 dark:text-zinc-100">
      <!-- `?plan=` подсвечивает карточку той же оранжевой чертой, что и ссылки-действия сайта. -->
      <span class="inline-block pb-1" :class="highlighted ? 'border-b-2 border-orange-600' : ''">
        {{ t(`pricing.plans.${tier}.name`) }}
      </span>
    </h3>

    <p
      class="mt-4 font-sans text-xs font-semibold tracking-widest text-zinc-500 uppercase dark:text-zinc-400"
      data-testid="plan-availability">
      {{ t(availability === "now" ? "pricing.availability.now" : "pricing.availability.later") }}
    </p>

    <p class="mt-5 font-garamond-libre text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
      {{ t(`pricing.plans.${tier}.summary`) }}
    </p>

    <ul class="mt-7 grow space-y-3">
      <li
        v-for="feature in features"
        :key="feature"
        class="font-sans text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        {{ t(`pricing.plans.${tier}.features.${feature}`) }}
      </li>
    </ul>
  </article>
</template>
