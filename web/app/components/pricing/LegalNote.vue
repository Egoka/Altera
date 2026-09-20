<script setup lang="ts">
  // Блок правил со ссылками на правовые тексты (`pricing.md` §5 зона 5 и §6, компонент `LegalNote`).
  // На первом запуске он объясняет, что оплаты нет, и ведёт к оферте, возвратам и реквизитам
  // продавца (54-ФЗ, ADR-0010) — сами тексты живут на страницах `/legal/*`.
  defineProps<{
    titleKey: string
    noteKeys: readonly string[]
    links: readonly { labelKey: string; to: string }[]
  }>()

  const { t } = useI18n()
</script>

<template>
  <section class="py-12" aria-labelledby="pricing-legal-title">
    <h2 id="pricing-legal-title" class="font-waterway text-3xl tracking-wide text-zinc-950 dark:text-zinc-100">
      {{ t(titleKey) }}
    </h2>

    <ul class="mt-6 max-w-3xl space-y-4">
      <li
        v-for="note in noteKeys"
        :key="note"
        class="font-garamond-libre text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
        {{ t(note) }}
      </li>
    </ul>

    <ul class="mt-8 flex flex-wrap gap-x-8 gap-y-3">
      <li v-for="link in links" :key="link.to">
        <NuxtLink
          :to="link.to"
          class="inline-flex border-b-2 border-orange-600 pb-1 font-sans text-sm font-semibold text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
          {{ t(link.labelKey) }}
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
