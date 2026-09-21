<script setup lang="ts">
  import { computed } from "vue"
  import { GET_HOME_FEED } from "~/query"
  import { toHomeSections } from "~/utils/homeFeed"
  import { reportablePath } from "~/composables/useBrokenLinkReport"

  /**
   * Страница 404 (`docs/spec/20-public/not-found.md`). Текст одинаков для всех ролей: страница
   * не подтверждает существование скрытой сущности (§2, `50-access/visibility.md` п. 2).
   *
   * `requestId` здесь не выводится: журнал §28.4 оставил его только техническим сбоям, а «нет
   * такой страницы» — обычное пользовательское состояние. Допущение §5 про мелкий `requestId`
   * этим решением отменено.
   *
   * Зона поиска (§5 зона 3) появляется этапом 3 вместе с поиском — до него она скрыта.
   */
  const { locale, t } = useI18n()
  const route = useRoute()
  // Адреса с префиксом локали: английская 404 не должна уводить читателя в русский каталог.
  const localePath = useLocalePath()

  const links = computed(() =>
    [
      { labelKey: "service.notFoundHome", to: "/" },
      { labelKey: "service.notFoundSections", to: "/sections" },
      { labelKey: "service.notFoundAuthors", to: "/authors" }
    ].map((link) => ({ ...link, to: localePath(link.to) }))
  )

  // Отказ ленты зону скрывает и статус не меняет (§8): карточки — подсказка, а не содержание.
  const { data: feed, status } = await useAsyncData(
    () => `not-found-feed:${locale.value}`,
    async () => {
      const result = await useGraphQL(GET_HOME_FEED, { locale: locale.value === "en" ? "en" : "ru" })
      if (result.errors?.length || !result.data) return null
      return result.data.feed
    },
    { watch: [locale], default: () => null }
  )

  const cards = computed(() =>
    toHomeSections(feed.value)
      .flatMap((section) => section.articles)
      .slice(0, 3)
  )
  const reportedPath = computed(() => reportablePath(route.fullPath))
</script>

<template>
  <AppHeader />
  <AppMain>
    <section class="mx-auto max-w-2xl py-20 text-center" data-testid="not-found">
      <p class="font-waterway text-6xl text-zinc-300 dark:text-zinc-700" aria-hidden="true">404</p>
      <h1 class="mt-4 font-waterway text-3xl tracking-wide text-zinc-950 dark:text-zinc-100">
        {{ t("service.notFoundTitle") }}
      </h1>
      <p class="mt-3 font-garamond-libre text-lg text-zinc-600 dark:text-zinc-400">
        {{ t("service.notFoundDescription") }}
      </p>
    </section>

    <section class="mx-auto max-w-5xl" aria-labelledby="not-found-links">
      <h2 id="not-found-links" class="font-sans text-xs uppercase tracking-wider text-zinc-500">
        {{ t("service.notFoundWhereTo") }}
      </h2>
      <ul data-testid="not-found-links" class="mt-4 flex flex-wrap gap-x-8 gap-y-3">
        <li v-for="link in links" :key="link.to">
          <NuxtLink
            :to="link.to"
            class="border-b-2 border-orange-600 pb-1 font-serif font-semibold text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
            {{ t(link.labelKey) }}
          </NuxtLink>
        </li>
      </ul>

      <ReadingLoadingSkeleton v-if="status === 'pending'" class="mt-10" :cards="3" />
      <div
        v-else-if="cards.length"
        data-testid="not-found-cards"
        class="mt-10 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        <ArticleCard
          v-for="(card, index) in cards"
          :key="card.id"
          :article="card"
          variant="small"
          :locale="locale === 'en' ? 'en' : 'ru'"
          :class="index > 0 ? 'hidden md:grid' : ''" />
      </div>
    </section>

    <ServiceReportLinkForm :path="reportedPath" />
  </AppMain>
  <AppFooter />
</template>
