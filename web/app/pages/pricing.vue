<script setup lang="ts">
  import {
    PRICING_COMPARE_ROWS,
    PRICING_FAQ_KEYS,
    PRICING_LAUNCH_PLANS,
    hasPromoQuery,
    pricingCanonicalPath,
    resolveHighlightedPlan,
    resolvePricingLaunchState
  } from "~/utils/pricingLaunch"

  // Страница «Цены и планы» в режиме первого запуска (`docs/spec/20-public/pricing.md`,
  // журнал §24.1). Платности нет: карточки показывают планы и их будущие возможности без цен
  // и кнопок оплаты, промокод не проверяется, а главное действие ведёт в создание материала.

  definePageMeta({ layout: "default" })

  const route = useRoute()
  const localePath = useLocalePath()
  const { locale, t } = useI18n()

  const plans = PRICING_LAUNCH_PLANS
  const tiers = plans.map((plan) => plan.tier)
  const state = computed(() => resolvePricingLaunchState(plans))
  const highlightedPlan = computed(() => resolveHighlightedPlan(route.query.plan))
  const isPromoVisit = computed(() => hasPromoQuery(route.query))

  // Origin читается сразу в setup: внутри ленивого резолвера `useHead` контекста Nuxt уже нет.
  const origin = useRequestURL().origin
  const canonicalUrl = computed(() => `${origin}${pricingCanonicalPath(locale.value)}`)

  useSeoMeta({
    title: () => t("pricing.meta.title"),
    description: () => t("pricing.meta.description"),
    ogTitle: () => t("pricing.meta.title"),
    ogDescription: () => t("pricing.meta.description"),
    // Ссылка с промокодом не должна попадать в индекс (`pricing.md` §3, §10).
    robots: () => (isPromoVisit.value ? "noindex, nofollow" : "index, follow")
  })

  useHead({
    link: () => [
      { rel: "canonical", href: canonicalUrl.value },
      { rel: "alternate", hreflang: "ru-RU", href: `${origin}/pricing` },
      { rel: "alternate", hreflang: "en-US", href: `${origin}/en/pricing` }
    ]
  })

  const legalLinks = [
    { labelKey: "pricing.legal.offer", to: "/legal/paid-services" },
    { labelKey: "pricing.legal.refunds", to: "/legal/refunds" },
    { labelKey: "pricing.legal.requisites", to: "/legal/paid-services#requisites" }
  ] as const

  const legalNoteKeys = [
    "pricing.legal.notes.noPayment",
    "pricing.legal.notes.readingFree",
    "pricing.legal.notes.articlesStay",
    "pricing.legal.notes.laterRules"
  ] as const
</script>

<template>
  <div class="py-16">
    <ReadingErrorState
      v-if="state === 'empty'"
      :title="t('pricing.states.empty.title')"
      :description="t('pricing.states.empty.description')" />

    <template v-else>
      <section class="max-w-3xl" aria-labelledby="pricing-title">
        <p class="font-sans text-xs font-semibold tracking-widest text-zinc-500 uppercase">
          {{ t("pricing.hero.kicker") }}
        </p>
        <h1
          id="pricing-title"
          class="mt-5 font-waterway text-5xl leading-tight tracking-wide text-zinc-950 dark:text-zinc-100">
          {{ t("pricing.hero.title") }}
        </h1>
        <p class="mt-6 font-garamond-libre text-xl leading-relaxed text-zinc-600 dark:text-zinc-400">
          {{ t("pricing.hero.lede") }}
        </p>
        <p class="mt-4 font-garamond-libre text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
          {{ t("pricing.hero.launchNote") }}
        </p>
        <NuxtLink
          :to="localePath('/me/articles/new')"
          class="mt-8 inline-flex border-b-2 border-orange-600 pb-1 font-serif text-lg font-semibold text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
          {{ t("pricing.hero.cta") }}
        </NuxtLink>
      </section>

      <section
        class="mt-16 grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8 lg:gap-12"
        :aria-label="t('pricing.plansLabel')">
        <PricingPlanCard
          v-for="plan in plans"
          :key="plan.tier"
          :tier="plan.tier"
          :availability="plan.availability"
          :features="plan.features"
          :highlighted="highlightedPlan === plan.tier" />
      </section>

      <section class="mt-20" aria-labelledby="pricing-compare-title">
        <h2 id="pricing-compare-title" class="font-waterway text-3xl tracking-wide text-zinc-950 dark:text-zinc-100">
          {{ t("pricing.compare.title") }}
        </h2>
        <p class="mt-4 max-w-3xl font-garamond-libre text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
          {{ t("pricing.compare.note") }}
        </p>
        <PricingPlanCompare class="mt-8" :rows="PRICING_COMPARE_ROWS" :tiers="tiers" />
      </section>

      <PricingLegalNote class="mt-12" title-key="pricing.legal.title" :note-keys="legalNoteKeys" :links="legalLinks" />

      <PricingLaunchFaq :item-keys="PRICING_FAQ_KEYS" />
    </template>
  </div>
</template>
