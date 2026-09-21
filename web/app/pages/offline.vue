<script setup lang="ts">
  import { computed } from "vue"
  import { useOfflinePage } from "~/composables/useOfflinePage"

  /**
   * Офлайн-страница (`docs/spec/20-public/offline.md`): собственный адрес `/offline` нужен для
   * предкеширования service worker, а показывается она по месту запрошенного адреса. Запросов к
   * API нет (§4), поэтому шапка и футер статические, а вход и «Писать» скрыты (§6): офлайн ни
   * то, ни другое не выполнится.
   *
   * Service worker и его стратегия кеширования — этап 3 (§1); до него список сохранённого пуст,
   * а сама страница уже ждёт сеть и возвращает читателя на исходный адрес.
   */
  definePageMeta({ layout: false })

  const { locale, t } = useI18n()
  const { state, pages, retrying, requestedPath, requestedCached, retry } = useOfflinePage()

  const notCached = computed(() => requestedPath.value !== null && requestedCached.value === false)
  const description = computed(() =>
    notCached.value ? t("service.offlineNotCached") : t("service.offlineDescription")
  )

  // Страница не должна попадать ни в индекс, ни в аналитику сервера (§10).
  useSeoMeta({ robots: "noindex" })
  useHead(() => ({ title: t("service.offlineMetaTitle") }))
</script>

<template>
  <div>
    <AppHeader static minimal />
    <AppMain>
      <section class="mx-auto max-w-2xl py-20 text-center" data-testid="offline">
        <h1 class="font-waterway text-3xl tracking-wide text-zinc-950 dark:text-zinc-100">
          {{ t("service.offlineTitle") }}
        </h1>
        <p data-testid="offline-description" class="mt-3 font-garamond-libre text-lg text-zinc-600 dark:text-zinc-400">
          {{ description }}
        </p>

        <button
          type="button"
          data-testid="offline-retry"
          :disabled="retrying"
          :aria-busy="retrying || undefined"
          class="mt-8 inline-flex min-h-11 w-full items-center justify-center border border-zinc-900 px-4 font-sans text-sm font-semibold text-zinc-950 transition-colors hover:border-orange-700 hover:bg-orange-700 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none sm:w-auto dark:border-zinc-100 dark:text-zinc-100"
          @click="retry">
          {{ t("service.offlineRetry") }}
        </button>

        <p
          v-if="retrying"
          data-testid="offline-retrying"
          class="mt-3 font-sans text-sm text-zinc-600 dark:text-zinc-400">
          {{ t("service.offlineRetrying") }}
        </p>
        <p
          v-else-if="state === 'unavailable'"
          data-testid="offline-storage-unavailable"
          class="mt-3 font-sans text-sm text-zinc-500">
          {{ t("service.offlineStorageUnavailable") }}
        </p>
      </section>

      <ServiceCachedList v-if="state === 'ready'" :pages="pages" :locale="locale === 'en' ? 'en' : 'ru'" />
    </AppMain>
    <AppFooter />
  </div>
</template>
