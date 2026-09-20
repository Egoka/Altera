<script setup lang="ts">
  import type { PricingCompareRow, PricingPlanTier } from "~/utils/pricingLaunch"

  // Сравнение возможностей (`pricing.md` §5 зона 4). На первом запуске таблица говорит только
  // о составе: ни цен, ни чисел, ни позиций в выдаче — про `pro` сказано об усилении видимости
  // и статуса автора без формулы (журнал §20.13).
  defineProps<{
    rows: readonly PricingCompareRow[]
    tiers: readonly PricingPlanTier[]
  }>()

  const { t } = useI18n()
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full min-w-xl border-collapse text-left">
      <caption class="sr-only">
        {{
          t("pricing.compare.caption")
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col" class="py-4 pr-6 font-sans text-xs font-semibold tracking-widest text-zinc-500 uppercase">
            {{ t("pricing.compare.feature") }}
          </th>
          <th
            v-for="tier in tiers"
            :key="tier"
            scope="col"
            class="py-4 pr-6 font-sans text-xs font-semibold tracking-widest text-zinc-500 uppercase">
            {{ t(`pricing.plans.${tier}.name`) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key">
          <th scope="row" class="py-4 pr-6 font-garamond-libre text-lg font-normal text-zinc-700 dark:text-zinc-300">
            {{ t(`pricing.compare.rows.${row.key}`) }}
          </th>
          <td
            v-for="tier in tiers"
            :key="tier"
            class="py-4 pr-6 font-sans text-sm text-zinc-600 dark:text-zinc-400"
            :data-included="row.included[tier] ? 'yes' : 'no'">
            <span class="text-lg text-zinc-800 dark:text-zinc-200" aria-hidden="true">
              {{ row.included[tier] ? "•" : "—" }}
            </span>
            <span class="sr-only">
              {{ t(row.included[tier] ? "pricing.compare.included" : "pricing.compare.excluded") }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
