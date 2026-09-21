<script setup lang="ts">
  /**
   * Лицензия на контент (`docs/spec/20-public/legal-license.md`, реестр страниц #18).
   *
   * Запрет обучения ИИ на публичных материалах — решение владельца (журнал §24.2): лицензия
   * обязана его содержать независимо от редакции текста. Если опубликованный текст ещё не имеет
   * раздела `#ai-training`, страница показывает его из §24.2 сама; когда раздел появится в тексте
   * (T-102), якорь ведёт в текст, а дубль не выводится.
   */
  definePageMeta({ layout: "default" })
  const { t } = useI18n()

  const summaryKeys = ["authorRights", "platformLicense", "codeMit"] as const
</script>

<template>
  <LegalPage kind="license">
    <template #summary>
      <section
        class="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3"
        :aria-label="t('legal.license.summaryLabel')"
        data-testid="legal-license-summary">
        <LegalNoticeCard v-for="key in summaryKeys" :key="key">
          {{ t(`legal.license.summary.${key}`) }}
        </LegalNoticeCard>
      </section>
    </template>

    <template #after-text="{ document }">
      <section
        v-if="!document.anchors.some((anchor) => anchor.id === 'ai-training')"
        id="ai-training"
        class="legal-ai-training mt-10"
        aria-labelledby="legal-ai-training-title"
        data-testid="legal-ai-training">
        <h2 id="legal-ai-training-title" class="font-garamond-libre text-2xl font-semibold">
          {{ t("legal.license.aiTraining.title") }}
        </h2>
        <p class="mt-4 font-garamond-libre text-lg leading-relaxed">{{ t("legal.license.aiTraining.ban") }}</p>
        <p class="mt-4 font-garamond-libre text-lg leading-relaxed">{{ t("legal.license.aiTraining.allowed") }}</p>
        <p class="mt-4 font-garamond-libre text-lg leading-relaxed">{{ t("legal.license.aiTraining.nature") }}</p>
      </section>
    </template>
  </LegalPage>
</template>

<style scoped>
  .legal-ai-training {
    scroll-margin-top: 6rem;
  }
</style>
