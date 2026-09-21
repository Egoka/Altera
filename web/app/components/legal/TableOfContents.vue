<script setup lang="ts">
  /**
   * `TableOfContents` (`legal-terms.md` §6): якорное оглавление длинного текста. На `lg` —
   * липкая колонка слева, ниже — раскрывашка над текстом (§9). В печать не попадает.
   */
  defineProps<{ anchors: readonly { id: string; title: string }[] }>()
  const { t } = useI18n()
</script>

<template>
  <nav v-if="anchors.length" :aria-label="t('legal.toc')" class="print:hidden" data-testid="legal-toc">
    <details class="lg:hidden">
      <summary class="cursor-pointer py-2 font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {{ t("legal.toc") }}
      </summary>
      <ol class="mt-2 flex flex-col gap-2 pb-2 font-sans text-sm">
        <li v-for="anchor in anchors" :key="anchor.id">
          <a
            :href="`#${anchor.id}`"
            class="text-zinc-700 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:text-zinc-300">
            {{ anchor.title }}
          </a>
        </li>
      </ol>
    </details>

    <div class="hidden lg:sticky lg:top-24 lg:block">
      <p class="font-sans text-xs font-semibold tracking-widest text-zinc-500 uppercase">{{ t("legal.toc") }}</p>
      <ol class="mt-4 flex flex-col gap-3 font-sans text-sm">
        <li v-for="anchor in anchors" :key="anchor.id">
          <a
            :href="`#${anchor.id}`"
            class="text-zinc-700 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:text-zinc-300">
            {{ anchor.title }}
          </a>
        </li>
      </ol>
    </div>
  </nav>
</template>
