<script setup lang="ts">
  /**
   * Политика обработки персональных данных (`docs/spec/20-public/legal-privacy.md`, реестр #16).
   * Зона «Ваши данные» (§5 п. 5) — только ссылки: сами данные живут в кабинете (§12). Гостю она не
   * видна; архивированный аккаунт видит только связь с редакцией (строка «Заблокирован» §8).
   */
  definePageMeta({ layout: "default" })
  const { t } = useI18n()
  const localePath = useLocalePath()

  const accountLinks = computed(() => [
    { to: localePath("/me/export"), label: t("legal.yourData.export"), testid: "legal-your-data-export" },
    { to: localePath("/me/email"), label: t("legal.yourData.email"), testid: "legal-your-data-email" },
    { to: localePath("/me/delete"), label: t("legal.yourData.delete"), testid: "legal-your-data-delete" }
  ])
</script>

<template>
  <LegalPage kind="privacy">
    <template #after-text="{ viewer }">
      <LegalNoticeCard
        v-if="viewer !== 'guest'"
        class="mt-12 print:hidden"
        :title="t('legal.yourData.title')"
        data-testid="legal-your-data">
        <MeLinkList v-if="viewer === 'account'" :title="t('legal.yourData.linksTitle')" :links="accountLinks" />
        <NuxtLink
          v-else
          to="/contact?topic=privacy"
          class="border-b border-zinc-400 pb-0.5 font-sans text-sm"
          data-testid="legal-your-data-contact">
          {{ t("legal.yourData.contact") }}
        </NuxtLink>
      </LegalNoticeCard>
    </template>
  </LegalPage>
</template>
