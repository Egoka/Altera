<script setup lang="ts">
  import { GET_LEGAL_TEXT, GET_MY_CONSENTS } from "~/query"
  import { errorRequestId, requestLocale, throwOnFeedError } from "~/utils/publicFeed"
  import {
    consentFor,
    formatLegalDate,
    LEGAL_PATHS,
    LEGAL_RELATED,
    legalVersionParam,
    legalViewerFromCode,
    type LegalConsentView,
    type LegalKind,
    type LegalViewer
  } from "~/utils/legalDocument"

  /**
   * `LegalPage` (`docs/spec/20-public/legal-terms.md` §5–6 и соседние `legal-*.md`): заголовок с
   * редакцией и датой, оглавление, текст, архив редакций и связанные документы. Текст публичный и
   * одинаков для всех (ADR-0019), поэтому зоны аккаунта — принятая редакция, «ваши данные» —
   * читаются в браузере отдельным запросом и в серверный HTML не попадают.
   */
  const props = defineProps<{ kind: LegalKind }>()

  const route = useRoute()
  const { locale, t } = useI18n()
  const localePath = useLocalePath()

  const version = computed(() => legalVersionParam(route.query.version))
  // `?version=abc`, `?version=0` — адрес не ведёт ни к какой редакции (строка «Не найдено» §8).
  if (version.value === null) throw createError({ statusCode: 404, statusMessage: "NOT_FOUND", fatal: true })

  const legalData = useAsyncData(
    () => `legal:${props.kind}:${locale.value}:${version.value ?? "current"}`,
    async () =>
      throwOnFeedError(
        await useGraphQL(GET_LEGAL_TEXT, {
          kind: props.kind,
          locale: requestLocale(locale.value),
          version: version.value ?? null
        })
      ),
    { lazy: true, watch: [locale, version] }
  )
  // На сервере текст дожидается рендера: страница отдаётся уже с текстом и верным кодом ответа.
  // При клиентском переходе загрузка ленивая — это строка «Загрузка» со скелетом текста.
  if (import.meta.server) await legalData
  const { data, error, status } = legalData

  const isNotFound = (value: unknown) => (value as { statusCode?: number } | null)?.statusCode === 404
  if (isNotFound(error.value)) throw createError({ statusCode: 404, statusMessage: "NOT_FOUND", fatal: true })
  watch(error, (value) => {
    if (isNotFound(value)) showError({ statusCode: 404, statusMessage: "NOT_FOUND", fatal: true })
  })

  if (import.meta.server && error.value) {
    const event = useRequestEvent()
    if (event) setResponseStatus(event, 500)
  }

  const document = computed(() => data.value?.legalText ?? null)
  const requestId = computed(() => errorRequestId(error.value))

  type LegalState = "loading" | "error" | "unpublished" | "ready"
  const state = computed<LegalState>(() => {
    if (error.value) return "error"
    if (document.value) return "ready"
    return status.value === "pending" || status.value === "idle" ? "loading" : "unpublished"
  })

  const { data: account } = useAsyncData(
    "legal:consents",
    async (): Promise<{ viewer: LegalViewer; consents: LegalConsentView[] }> => {
      const result = await useGraphQL(GET_MY_CONSENTS)
      const code = result.errors?.[0]?.extensions?.code
      if (result.errors?.length || !result.data?.me) {
        return { viewer: legalViewerFromCode(typeof code === "string" ? code : undefined), consents: [] }
      }
      return { viewer: "account", consents: result.data.me.consents }
    },
    { server: false, lazy: true }
  )
  const viewer = computed<LegalViewer>(() => account.value?.viewer ?? "guest")
  const consent = computed(() => (viewer.value === "account" ? consentFor(props.kind, account.value?.consents) : null))

  const title = computed(() => t(`legal.titles.${props.kind}`))
  const dateOf = (iso: string) => formatLegalDate(iso, locale.value)
  const languageName = (value: string) => t(`legal.languages.${value}`)

  const path = LEGAL_PATHS[props.kind]
  const versionLink = (value: number) =>
    value === document.value?.currentVersion ? localePath(path) : `${localePath(path)}?version=${value}`

  // Origin читается сразу в setup: внутри ленивого резолвера `useHead` контекста Nuxt уже нет.
  const origin = useRequestURL().origin
  const localizedUrl = (value: string) => `${origin}${value === "en" ? "/en" : ""}${path}`

  useSeoMeta({
    title: () => t("legal.meta.title", { title: title.value }),
    ogTitle: () => t("legal.meta.title", { title: title.value }),
    // Прежние редакции не индексируются (§10); неопубликованный документ индексировать нечем.
    robots: () => (version.value !== undefined || state.value === "unpublished" ? "noindex, follow" : "index, follow")
  })

  useHead({
    link: () => [
      { rel: "canonical", href: localizedUrl(requestLocale(locale.value)) },
      ...(document.value?.availableLocales ?? [])
        .filter(() => (document.value?.availableLocales.length ?? 0) > 1)
        .map((value) => ({
          rel: "alternate",
          hreflang: value === "en" ? "en-US" : "ru-RU",
          href: localizedUrl(value)
        }))
    ]
  })

  // Адреса `/legal/*` получают префикс локали; `/contact` пока живёт без языковой версии.
  const relatedLinks = computed(() =>
    LEGAL_RELATED[props.kind].map((link) => ({
      to: link.to.startsWith("/legal/") ? localePath(link.to) : link.to,
      label: t(link.labelKey),
      testid: `legal-related-${link.to.replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`
    }))
  )

  const print = () => window.print()
</script>

<template>
  <article class="py-12" :data-legal-state="state" :data-legal-kind="kind" :aria-labelledby="`legal-${kind}-title`">
    <header class="max-w-3xl">
      <p class="font-sans text-xs font-semibold tracking-widest text-zinc-500 uppercase print:hidden">
        {{ t("legal.kicker") }}
      </p>
      <h1
        :id="`legal-${kind}-title`"
        class="mt-4 font-waterway text-4xl leading-tight tracking-wide text-zinc-950 sm:text-5xl dark:text-zinc-100">
        {{ title }}
      </h1>

      <template v-if="document">
        <p class="mt-4 font-sans text-sm text-zinc-600 dark:text-zinc-400" data-testid="legal-version">
          {{ t("legal.versionLine", { version: document.version, date: dateOf(document.publishedAt) }) }}
        </p>
        <p
          v-if="document.summaryOfChanges"
          id="changes"
          class="mt-2 font-sans text-sm text-zinc-600 dark:text-zinc-400"
          data-testid="legal-changes">
          {{ t("legal.changes", { summary: document.summaryOfChanges }) }}
        </p>

        <div class="mt-6 flex flex-col gap-3">
          <LegalNoticeCard v-if="document.isFallbackLocale" tone="accent" data-testid="legal-fallback">
            {{
              t("legal.fallback", {
                requested: languageName(document.requestedLocale),
                shown: languageName(document.locale)
              })
            }}
          </LegalNoticeCard>

          <LegalNoticeCard v-if="!document.isCurrent" tone="accent" data-testid="legal-previous" role="status">
            {{ t("legal.previous", { version: document.version, current: document.currentVersion }) }}
            <NuxtLink
              :to="localePath(path)"
              class="ml-1 border-b border-orange-600 font-semibold print:hidden"
              data-testid="legal-current-link">
              {{ t("legal.openCurrent") }}
            </NuxtLink>
          </LegalNoticeCard>

          <LegalNoticeCard v-if="consent && document.isCurrent" data-testid="legal-consent" class="print:hidden">
            {{
              t("legal.consent.accepted", {
                version: consent.acceptedVersion,
                date: consent.acceptedAt ? dateOf(consent.acceptedAt) : ""
              })
            }}
            <span v-if="consent.reconsentRequired" class="block" data-testid="legal-reconsent">
              {{ t("legal.consent.reconsent", { version: document.currentVersion }) }}
            </span>
          </LegalNoticeCard>
        </div>

        <button
          type="button"
          class="mt-6 border-b-2 border-orange-600 pb-1 font-sans text-sm font-semibold text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 print:hidden dark:text-zinc-100"
          data-testid="legal-print"
          @click="print">
          {{ t("legal.print") }}
        </button>
      </template>
    </header>

    <section
      v-if="state === 'loading'"
      class="mt-12 max-w-3xl"
      aria-busy="true"
      :aria-label="t('reading.loading')"
      data-testid="legal-skeleton">
      <span class="sr-only">{{ t("reading.loading") }}</span>
      <div class="flex animate-pulse flex-col gap-3 motion-reduce:animate-none" aria-hidden="true">
        <div class="h-4 w-1/3 bg-zinc-200 dark:bg-zinc-800"></div>
        <div v-for="line in 8" :key="line" class="h-4 w-full bg-zinc-200 dark:bg-zinc-800"></div>
        <div class="h-4 w-2/3 bg-zinc-200 dark:bg-zinc-800"></div>
      </div>
    </section>

    <ReadingErrorState v-else-if="state === 'error'" class="mt-12" :request-id="requestId" data-testid="legal-error" />

    <ReadingEmptyState
      v-else-if="state === 'unpublished'"
      class="mt-12"
      :title="t('legal.unpublished.title')"
      :description="t('legal.unpublished.description')"
      data-testid="legal-unpublished" />

    <template v-else-if="document">
      <slot name="summary" :document="document" :viewer="viewer" />

      <div class="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-[14rem_minmax(0,48rem)] lg:gap-16">
        <LegalTableOfContents :anchors="document.anchors" />
        <div class="min-w-0">
          <!-- Текст публикует владелец; разметка проверяется при публикации (`server/src/legal/texts.ts`). -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="legal-body" data-testid="legal-body" v-html="document.html" />
          <slot name="after-text" :document="document" :viewer="viewer" />
        </div>
      </div>

      <section
        v-if="document.previousVersions.length"
        class="mt-16 max-w-3xl print:hidden"
        aria-labelledby="legal-archive-title"
        data-testid="legal-archive">
        <h2 id="legal-archive-title" class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("legal.archive") }}
        </h2>
        <ol class="mt-3 flex flex-col gap-2 font-sans text-sm">
          <li>
            <NuxtLink
              :to="versionLink(document.currentVersion)"
              class="text-zinc-700 hover:text-orange-700 dark:text-zinc-300">
              {{ t("legal.archiveCurrent", { version: document.currentVersion }) }}
            </NuxtLink>
          </li>
          <li v-for="item in document.previousVersions" :key="item.version">
            <NuxtLink :to="versionLink(item.version)" class="text-zinc-700 hover:text-orange-700 dark:text-zinc-300">
              {{ t("legal.archiveItem", { version: item.version, date: dateOf(item.publishedAt) }) }}
            </NuxtLink>
          </li>
        </ol>
      </section>
    </template>

    <MeLinkList
      v-if="state !== 'loading'"
      class="mt-16 print:hidden"
      :title="t('legal.related.title')"
      :links="relatedLinks" />
  </article>
</template>

<style scoped>
  .legal-body {
    font-family: var(--font-garamond-libre, serif);
    font-size: 1.125rem;
    line-height: 1.75;
  }

  .legal-body :deep(h2) {
    margin-top: 2.5rem;
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.3;
    /* Якорь не прячется под фиксированной шапкой сайта (`legal-content-rules.md` §9). */
    scroll-margin-top: 6rem;
  }

  .legal-body :deep(h2:first-child) {
    margin-top: 0;
  }

  .legal-body :deep(h2:target) {
    background-color: rgb(255 237 213 / 0.7);
  }

  .legal-body :deep(h3) {
    margin-top: 1.75rem;
    font-size: 1.25rem;
    font-weight: 600;
    scroll-margin-top: 6rem;
  }

  .legal-body :deep(p),
  .legal-body :deep(ul),
  .legal-body :deep(ol) {
    margin-top: 1rem;
  }

  .legal-body :deep(ul) {
    list-style: disc;
    padding-left: 1.5rem;
  }

  .legal-body :deep(ol) {
    list-style: decimal;
    padding-left: 1.5rem;
  }

  .legal-body :deep(a) {
    text-decoration: underline;
    text-underline-offset: 4px;
  }

  @media print {
    .legal-body {
      font-size: 11pt;
      line-height: 1.5;
      color: #000;
    }

    .legal-body :deep(h2:target) {
      background: none;
    }

    .legal-body :deep(a)::after {
      content: " (" attr(href) ")";
      font-size: 0.85em;
    }
  }
</style>
