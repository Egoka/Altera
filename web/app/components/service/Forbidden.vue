<script setup lang="ts">
  import { computed } from "vue"

  /**
   * Отказ в доступе (403). Отдельная страница, потому что «нет доступа» — не сбой сервиса:
   * админка открыта только служебным записям (журнал §25.2, `40-admin/dashboard.md` §2), а
   * разделы внутри неё — своим ролям (`admin-*` middleware).
   *
   * `requestId` здесь не выводится: журнал §28.4 оставил его техническим сбоям. Запросов к API
   * страница не делает — 403 приходит из middleware, и шапка не должна падать следом.
   */
  const { t } = useI18n()
  // Локаль берётся из префикса запроса: английский отказ уводит на английские адреса.
  const localePath = useLocalePath()

  const homeTo = computed(() => localePath("/"))
  const contactTo = computed(() => localePath("/contact"))
</script>

<template>
  <AppHeader static />
  <AppMain>
    <section class="mx-auto max-w-lg py-20 text-center" data-testid="forbidden">
      <p class="font-waterway text-6xl text-zinc-300 dark:text-zinc-700" aria-hidden="true">403</p>
      <h1 class="mt-4 font-waterway text-3xl tracking-wide text-zinc-950 dark:text-zinc-100">
        {{ t("service.forbiddenTitle") }}
      </h1>
      <p class="mt-3 font-garamond-libre text-lg text-zinc-600 dark:text-zinc-400">
        {{ t("service.forbiddenDescription") }}
      </p>

      <div class="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <NuxtLink
          :to="homeTo"
          class="inline-flex min-h-10 w-full items-center justify-center border-b-2 border-orange-600 px-4 font-serif font-semibold text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 sm:w-auto dark:text-zinc-100">
          {{ t("service.goHome") }}
        </NuxtLink>
        <NuxtLink
          :to="contactTo"
          data-testid="forbidden-contact"
          class="inline-flex min-h-10 w-full items-center justify-center border-b-2 border-orange-600 px-4 font-serif font-semibold text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 sm:w-auto dark:text-zinc-100">
          {{ t("service.contactEditorial") }}
        </NuxtLink>
      </div>
    </section>
  </AppMain>
  <AppFooter />
</template>
