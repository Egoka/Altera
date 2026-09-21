<script setup lang="ts">
  import { GetAboutPageDocument, GetAboutViewerDocument } from "~/graphql/generated/graphql"
  import { formatLegalDate } from "~/utils/legalDocument"
  import { errorRequestId, requestLocale, throwOnFeedError } from "~/utils/publicFeed"

  /**
   * «О проекте» (`docs/spec/20-public/about.md`, реестр страниц #13). Зоны 2, 3 и 7 — статическая
   * часть страницы, зоны 5–6 — текст владельца из `/admin/legal` (вид `about`), зона 4 — непустые
   * рубрики. Статическая часть остаётся на месте и при ошибке данных (§8 `[ДОПУЩЕНИЕ]`).
   */
  definePageMeta({ layout: "default" })

  const { locale, t } = useI18n()
  const localePath = useLocalePath()

  const aboutData = useAsyncData(
    () => `about:${locale.value}`,
    async () => throwOnFeedError(await useGraphQL(GetAboutPageDocument, { locale: requestLocale(locale.value) })),
    { lazy: true, watch: [locale] }
  )
  // На сервере текст дожидается рендера, при клиентском переходе — строка «Загрузка» со скелетом.
  if (import.meta.server) await aboutData
  const { data, error, status } = aboutData

  if (import.meta.server && error.value) {
    const event = useRequestEvent()
    if (event) setResponseStatus(event, 500)
  }

  const text = computed(() => data.value?.staticText ?? null)
  const sections = computed(() => (data.value?.sectionCatalog ?? []).filter((section) => section.articleCount > 0))
  const requestId = computed(() => errorRequestId(error.value))

  type AboutState = "loading" | "error" | "unpublished" | "ready"
  const state = computed<AboutState>(() => {
    if (error.value) return "error"
    if (text.value) return "ready"
    return status.value === "pending" || status.value === "idle" ? "loading" : "unpublished"
  })

  // `owner` видит ссылку на редактирование и подсказку опубликовать (§2, §8 «Пусто»). Роль читается
  // в браузере: публичный HTML одинаков для всех.
  const { data: viewer } = useAsyncData(
    "about:viewer",
    async () => {
      const result = await useGraphQL(GetAboutViewerDocument)
      return result.data?.me?.role ?? null
    },
    { server: false, lazy: true }
  )
  const isOwner = computed(() => viewer.value === "owner")
  const ownerHint = computed(() => isOwner.value && (state.value === "unpublished" || text.value?.isFallbackLocale))

  const columns = computed(() =>
    (["read", "write", "check"] as const).map((key) => ({
      key,
      title: t(`about.how.${key}.title`),
      text: t(`about.how.${key}.text`)
    }))
  )

  const languageName = (value: string) => t(`legal.languages.${value}`)

  const origin = useRequestURL().origin
  const canonicalUrl = computed(() => `${origin}${locale.value === "en" ? "/en" : ""}/about`)

  useSeoMeta({
    title: () => t("about.meta.title"),
    description: () => t("about.meta.description"),
    ogTitle: () => t("about.meta.title"),
    ogDescription: () => t("about.meta.description"),
    robots: "index, follow"
  })

  useHead({
    link: () => [
      { rel: "canonical", href: canonicalUrl.value },
      { rel: "alternate", hreflang: "ru-RU", href: `${origin}/about` },
      { rel: "alternate", hreflang: "en-US", href: `${origin}/en/about` }
    ],
    script: () => [
      {
        type: "application/ld+json",
        innerHTML: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "AboutPage",
          name: t("about.meta.title"),
          description: t("about.meta.description"),
          url: canonicalUrl.value,
          about: { "@type": "Organization", name: "Altera", url: origin }
        })
      }
    ]
  })
</script>

<template>
  <article class="py-12" :data-about-state="state" aria-labelledby="about-title">
    <header class="max-w-3xl" data-testid="about-lead">
      <p class="font-sans text-xs font-semibold tracking-widest text-zinc-500 uppercase">{{ t("about.kicker") }}</p>
      <h1
        id="about-title"
        class="mt-4 font-waterway text-4xl leading-tight tracking-wide text-zinc-950 sm:text-5xl dark:text-zinc-100">
        {{ t("about.title") }}
      </h1>
      <p class="mt-4 font-garamond-libre text-xl leading-relaxed text-zinc-700 dark:text-zinc-300">
        {{ t("about.lead") }}
      </p>
    </header>

    <section class="mt-16" aria-labelledby="about-how-title">
      <h2 id="about-how-title" class="font-sans text-sm font-semibold tracking-wide text-zinc-800 dark:text-zinc-200">
        {{ t("about.how.title") }}
      </h2>
      <AboutFeatureColumns class="mt-6" :columns="columns" />
    </section>

    <section v-if="sections.length" class="mt-16" aria-labelledby="about-sections-title" data-testid="about-sections">
      <h2
        id="about-sections-title"
        class="font-sans text-sm font-semibold tracking-wide text-zinc-800 dark:text-zinc-200">
        {{ t("about.sections.title") }}
      </h2>
      <ul class="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
        <li v-for="section in sections" :key="section.slug">
          <NuxtLink
            :to="localePath(`/${section.slug}`)"
            class="font-waterway text-2xl tracking-wide text-zinc-950 transition-colors hover:text-orange-700 dark:text-zinc-100">
            {{ section.name }}
          </NuxtLink>
          <p
            v-if="section.description"
            class="mt-2 line-clamp-2 font-garamond-libre text-lg text-zinc-600 dark:text-zinc-400">
            {{ section.description }}
          </p>
        </li>
      </ul>
    </section>

    <section class="mt-16 max-w-3xl" aria-labelledby="about-text-title">
      <h2 id="about-text-title" class="font-sans text-sm font-semibold tracking-wide text-zinc-800 dark:text-zinc-200">
        {{ t("about.text.title") }}
      </h2>

      <div
        v-if="state === 'loading'"
        class="mt-6"
        aria-busy="true"
        :aria-label="t('reading.loading')"
        data-testid="about-skeleton">
        <span class="sr-only">{{ t("reading.loading") }}</span>
        <div class="flex animate-pulse flex-col gap-3 motion-reduce:animate-none" aria-hidden="true">
          <div v-for="line in 6" :key="line" class="h-4 w-full bg-zinc-200 dark:bg-zinc-800"></div>
          <div class="h-4 w-2/3 bg-zinc-200 dark:bg-zinc-800"></div>
        </div>
      </div>

      <ReadingErrorState v-else-if="state === 'error'" class="mt-6" :request-id="requestId" data-testid="about-error" />

      <ReadingEmptyState
        v-else-if="state === 'unpublished'"
        class="mt-6"
        :title="t('about.text.unpublishedTitle')"
        :description="t('about.text.unpublishedDescription')"
        data-testid="about-unpublished" />

      <template v-else-if="text">
        <LegalNoticeCard v-if="text.isFallbackLocale" class="mt-6" tone="accent" data-testid="about-fallback">
          {{ t("about.text.fallback", { shown: languageName(text.locale) }) }}
        </LegalNoticeCard>
        <p class="mt-6 font-sans text-sm text-zinc-500" data-testid="about-version">
          {{ t("about.text.version", { version: text.version, date: formatLegalDate(text.publishedAt, locale) }) }}
        </p>
        <!-- Текст публикует владелец; разметка проверяется при публикации (`server/src/legal/texts.ts`). -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="about-body mt-4" data-testid="about-body" v-html="text.html" />
      </template>

      <LegalNoticeCard v-if="ownerHint" class="mt-6" data-testid="about-owner-hint">
        {{ t("about.text.ownerHint") }}
      </LegalNoticeCard>
      <NuxtLink
        v-if="isOwner"
        to="/admin/legal/about"
        class="mt-6 inline-flex border-b border-orange-600 pb-0.5 font-sans text-sm font-semibold text-zinc-950 dark:text-zinc-100"
        data-testid="about-edit">
        {{ t("about.text.edit") }}
      </NuxtLink>
    </section>

    <section class="mt-16" aria-labelledby="about-cta-title" data-testid="about-cta">
      <h2 id="about-cta-title" class="font-waterway text-3xl tracking-wide text-zinc-950 dark:text-zinc-100">
        {{ t("about.cta.title") }}
      </h2>
      <div class="mt-6 flex flex-col gap-3 sm:flex-row">
        <NuxtLink
          :to="localePath('/pricing')"
          class="inline-flex min-h-11 items-center justify-center bg-zinc-950 px-6 font-sans text-sm font-semibold text-white transition-colors hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 motion-reduce:transition-none dark:bg-zinc-100 dark:text-zinc-950"
          data-testid="about-cta-pricing">
          {{ t("about.cta.becomeAuthor") }}
        </NuxtLink>
        <NuxtLink
          :to="localePath('/contact')"
          class="inline-flex min-h-11 items-center justify-center border border-zinc-900 px-6 font-sans text-sm font-semibold text-zinc-950 transition-colors hover:border-orange-700 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 motion-reduce:transition-none dark:border-zinc-100 dark:text-zinc-100"
          data-testid="about-cta-contact">
          {{ t("about.cta.writeEditorial") }}
        </NuxtLink>
      </div>
    </section>
  </article>
</template>

<style scoped>
  .about-body {
    font-family: var(--font-garamond-libre, serif);
    font-size: 1.125rem;
    line-height: 1.75;
  }

  .about-body :deep(h2) {
    margin-top: 2.5rem;
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.3;
  }

  .about-body :deep(h2:first-child) {
    margin-top: 0;
  }

  .about-body :deep(p),
  .about-body :deep(ul),
  .about-body :deep(ol) {
    margin-top: 1rem;
  }

  .about-body :deep(ul) {
    list-style: disc;
    padding-left: 1.5rem;
  }

  .about-body :deep(a) {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
</style>
