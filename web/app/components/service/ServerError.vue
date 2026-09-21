<script setup lang="ts">
  import { computed } from "vue"

  /**
   * Страница 500 (`docs/spec/20-public/error.md`). Ни одного запроса к API: страница ошибки не
   * должна зависеть от того, что упало (§4), поэтому шапка и футер статические.
   *
   * `requestId` показывается — это технический сбой, единственный случай, когда журнал §28.4
   * разрешает его читателю. Технических подробностей (стек, имена таблиц, адрес API) нет.
   */
  const props = defineProps<{ requestId?: string | null }>()
  const { t } = useI18n()
  // Локаль берётся из префикса запроса (§3): английский сбой уводит на английские адреса.
  const localePath = useLocalePath()

  const homeTo = computed(() => localePath("/"))
  const contactTo = computed(() => {
    const base = localePath("/contact")
    return props.requestId ? `${base}?requestId=${encodeURIComponent(props.requestId)}` : base
  })

  // «Повторить» — перезагрузка того же адреса (§3, §7), а не клиентский переход: упасть мог
  // и сам рендер, и повторная сборка той же страницы ничего не проверит.
  const retry = () => {
    if (typeof window !== "undefined") window.location.reload()
  }
</script>

<template>
  <AppHeader static />
  <AppMain>
    <section class="mx-auto max-w-lg py-20 text-center" data-testid="server-error">
      <p class="font-waterway text-6xl text-zinc-300 dark:text-zinc-700" aria-hidden="true">500</p>
      <h1 class="mt-4 font-waterway text-3xl tracking-wide text-zinc-950 dark:text-zinc-100">
        {{ t("service.serverErrorTitle") }}
      </h1>
      <p class="mt-3 font-garamond-libre text-lg text-zinc-600 dark:text-zinc-400">
        {{ t("service.serverErrorDescription") }}
      </p>

      <ReadingCopyField v-if="requestId" :label="t('service.requestIdLabel')" :value="requestId" />

      <div class="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          data-testid="server-error-retry"
          class="inline-flex min-h-10 w-full items-center justify-center border border-zinc-900 px-4 font-sans text-sm font-semibold text-zinc-950 transition-colors hover:border-orange-700 hover:bg-orange-700 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 motion-reduce:transition-none sm:w-auto dark:border-zinc-100 dark:text-zinc-100"
          @click="retry">
          {{ t("service.retry") }}
        </button>
        <NuxtLink
          :to="homeTo"
          class="inline-flex min-h-10 w-full items-center justify-center border-b-2 border-orange-600 px-4 font-serif font-semibold text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 sm:w-auto dark:text-zinc-100">
          {{ t("service.goHome") }}
        </NuxtLink>
        <NuxtLink
          :to="contactTo"
          data-testid="server-error-contact"
          class="inline-flex min-h-10 w-full items-center justify-center border-b-2 border-orange-600 px-4 font-serif font-semibold text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 sm:w-auto dark:text-zinc-100">
          {{ t("service.contactEditorial") }}
        </NuxtLink>
      </div>

      <!-- Публичной страницы статуса сервиса нет (журнал §20.17): вместо ссылки — что делать,
           если сбой повторяется. -->
      <p class="mt-10 font-sans text-sm text-zinc-500">{{ t("service.serverErrorRepeated") }}</p>
    </section>
  </AppMain>
  <AppFooter />
</template>
