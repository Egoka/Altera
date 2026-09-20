<script setup lang="ts">
  import { computed } from "vue"

  // FAQ страницы (`pricing.md` §5 зона 6, компонент `Accordion` из FishtVue).
  // Вопросы и ответы берутся из словаря локали; в `dataSource` уходят уже переведённые строки.
  const props = defineProps<{ itemKeys: readonly string[] }>()

  const { t } = useI18n()

  const items = computed(() =>
    props.itemKeys.map((key) => ({
      title: t(`pricing.faq.items.${key}.question`),
      subtitle: t(`pricing.faq.items.${key}.answer`)
    }))
  )
</script>

<template>
  <section class="py-12" aria-labelledby="pricing-faq-title">
    <h2 id="pricing-faq-title" class="font-waterway text-3xl tracking-wide text-zinc-950 dark:text-zinc-100">
      {{ t("pricing.faq.title") }}
    </h2>

    <Accordion
      class="mt-8 max-w-3xl divide-y divide-zinc-200 dark:divide-zinc-800"
      class-title="font-garamond-libre text-xl text-zinc-900 dark:text-zinc-100"
      class-subtitle="font-garamond-libre text-lg leading-relaxed text-zinc-600 dark:text-zinc-400"
      :data-source="items" />
  </section>
</template>
