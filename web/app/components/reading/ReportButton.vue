<script setup lang="ts">
  import { REPORT_CONTACT_TOPIC } from "~/utils/contactForm"

  /**
   * Кнопка «Пожаловаться» у материала (журнал §37 п. 9, T-118). До разбора сценария жалоб
   * (отложен, F-06) она ведёт на «Письмо в редакцию» со ссылкой на материал: путь уходит через
   * `?path=` (`docs/spec/20-public/contact.md` §3 `[ДОПУЩЕНИЕ]`), поэтому обращение приходит в
   * очередь с адресом страницы, а тему посетитель уточняет сам в форме.
   */
  const props = defineProps<{ path: string }>()
  const { t } = useI18n()
  const localePath = useLocalePath()

  const contactTo = computed(
    () => `${localePath("/contact")}?topic=${REPORT_CONTACT_TOPIC}&path=${encodeURIComponent(props.path)}`
  )
</script>

<template>
  <NuxtLink
    :to="contactTo"
    data-testid="article-report"
    class="border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 transition-colors hover:border-orange-600 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 motion-reduce:transition-none dark:text-zinc-400 dark:hover:text-orange-400">
    {{ t("article.report") }}
  </NuxtLink>
</template>
