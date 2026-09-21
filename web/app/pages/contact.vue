<script setup lang="ts">
  import { print } from "graphql"
  import {
    CreateSupportRequestDocument,
    GetContactViewerDocument,
    type SupportTopic
  } from "~/graphql/generated/graphql"
  import { requestLocale } from "~/utils/publicFeed"
  import {
    contactFailure,
    formatRetryAfter,
    hasContactQuery,
    normalizeContactPath,
    parseContactPath,
    parseContactRequestId,
    parseContactTopic,
    validateContactDraft,
    type ContactField,
    type ContactFieldError
  } from "~/utils/contactForm"

  // Письмо в редакцию (`docs/spec/20-public/contact.md`, реестр страниц #14). Таблица состояний — §8.
  definePageMeta({ layout: "default" })

  interface GraphQLEnvelope<T> {
    data?: T | null
    errors?: readonly { extensions?: Record<string, unknown> | null }[]
  }

  const route = useRoute()
  const { locale, t } = useI18n()

  const topic = ref<SupportTopic>(parseContactTopic(route.query.topic))
  const email = ref("")
  const message = ref("")
  const path = ref(parseContactPath(route.query.path))
  const requestId = parseContactRequestId(route.query.requestId)
  const acceptPrivacy = ref(false)

  // Аккаунт пишет с адреса из сессии; архивированная запись — как гость (§2, §8). Сессия читается
  // в браузере: публичная страница одинакова для всех и кешируется без ПДн.
  const { data: viewerData } = useAsyncData(
    "contact:viewer",
    async () => {
      const envelope = (await useGraphQL(GetContactViewerDocument)) as GraphQLEnvelope<{
        me: { id: string; email: string; isArchived: boolean } | null
      }>
      const me = envelope.data?.me
      return me && !me.isArchived ? { email: me.email } : null
    },
    { server: false, lazy: true }
  )
  const viewer = computed<"guest" | "account">(() => (viewerData.value ? "account" : "guest"))
  const origin = useRequestURL().origin
  const accountEmail = computed(() => viewerData.value?.email ?? null)

  type PageState = "form" | "sending" | "sent" | "error"
  const state = ref<PageState>("form")
  const fieldErrors = ref<Partial<Record<ContactField, ContactFieldError>>>({})
  const failureRequestId = ref<string | null>(null)
  const sent = ref<{ ticketNo: number; email: string } | null>(null)

  // Лимит — строка с таймером (§8 «Ограничение»): кнопка недоступна, пока окно не закроется.
  const retryLeft = ref<number | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null
  const stopTimer = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
  const startTimer = (seconds: number | null) => {
    stopTimer()
    retryLeft.value = seconds ?? 60
    timer = setInterval(() => {
      retryLeft.value = Math.max(0, (retryLeft.value ?? 0) - 1)
      if (retryLeft.value === 0) stopTimer()
    }, 1000)
  }
  onBeforeUnmount(stopTimer)
  const limited = computed(() => retryLeft.value !== null && retryLeft.value > 0)

  const submit = async () => {
    if (state.value === "sending" || limited.value) return
    path.value = normalizeContactPath(path.value, origin) ?? ""
    fieldErrors.value = validateContactDraft(
      {
        topic: topic.value,
        email: email.value,
        message: message.value,
        path: path.value,
        acceptPrivacy: acceptPrivacy.value
      },
      viewer.value
    )
    if (Object.keys(fieldErrors.value).length) return

    state.value = "sending"
    failureRequestId.value = null
    try {
      const envelope = await $fetch<GraphQLEnvelope<{ createSupportRequest: { ok: boolean; ticketNo: number } }>>(
        "/api/graphql",
        {
          method: "POST",
          body: {
            query: print(CreateSupportRequestDocument),
            variables: {
              topic: topic.value,
              email: viewer.value === "guest" ? email.value.trim() : null,
              message: message.value.trim(),
              path: path.value || null,
              requestId: requestId || null,
              locale: requestLocale(locale.value),
              acceptPrivacy: viewer.value === "guest" ? acceptPrivacy.value : null
            }
          }
        }
      )

      const result = envelope.data?.createSupportRequest
      if (result?.ok) {
        sent.value = { ticketNo: result.ticketNo, email: accountEmail.value ?? email.value.trim() }
        state.value = "sent"
        return
      }

      const failure = contactFailure(envelope.errors)
      if (failure.kind === "rateLimited") {
        startTimer(failure.retryAfter)
        state.value = "form"
      } else if (failure.kind === "field") {
        // Сервер не признал сессию аккаунта (истекла между чтением и отправкой): форма
        // переходит к виду гостя, чтобы поле адреса с ошибкой стало видно.
        if (failure.field === "email" || failure.field === "acceptPrivacy") viewerData.value = null
        fieldErrors.value = { [failure.field]: failure.error }
        state.value = "form"
      } else {
        failureRequestId.value = failure.requestId
        state.value = "error"
      }
    } catch {
      state.value = "error"
    }
  }

  // Новое письмо после отправленного: тема и ссылка остаются, текст начинается заново.
  const writeAnother = () => {
    message.value = ""
    sent.value = null
    state.value = "form"
  }

  const hintKey = computed(() =>
    ["refund", "copyright", "restore", "broken_link"].includes(topic.value) ? topic.value : null
  )

  const canonicalUrl = computed(() => `${origin}${locale.value === "en" ? "/en" : ""}/contact`)

  useSeoMeta({
    title: () => t("contact.meta.title"),
    description: () => t("contact.meta.description"),
    ogTitle: () => t("contact.meta.title"),
    ogDescription: () => t("contact.meta.description"),
    // Адреса с параметрами (`?topic=`, `?path=`, `?requestId=`) не индексируются (§10).
    robots: () => (hasContactQuery(route.query) ? "noindex, follow" : "index, follow")
  })

  useHead({
    link: () => [
      { rel: "canonical", href: canonicalUrl.value },
      { rel: "alternate", hreflang: "ru-RU", href: `${origin}/contact` },
      { rel: "alternate", hreflang: "en-US", href: `${origin}/en/contact` }
    ],
    script: () => [
      {
        type: "application/ld+json",
        innerHTML: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: t("contact.meta.title"),
          url: canonicalUrl.value,
          about: { "@type": "Organization", name: "Altera", url: origin }
        })
      }
    ]
  })
</script>

<template>
  <article class="py-12" :data-contact-state="state" aria-labelledby="contact-title">
    <header class="max-w-3xl">
      <p class="font-sans text-xs font-semibold tracking-widest text-zinc-500 uppercase">
        {{ t("contact.kicker") }}
      </p>
      <h1
        id="contact-title"
        class="mt-4 font-waterway text-4xl leading-tight tracking-wide text-zinc-950 sm:text-5xl dark:text-zinc-100">
        {{ t("contact.title") }}
      </h1>
      <p class="mt-4 font-garamond-libre text-xl leading-relaxed text-zinc-700 dark:text-zinc-300">
        {{ t("contact.lead") }}
      </p>
    </header>

    <div class="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,42rem)_minmax(0,1fr)] lg:gap-16">
      <div class="min-w-0">
        <section v-if="state === 'sent' && sent" role="status" data-testid="contact-sent">
          <h2 class="font-waterway text-3xl tracking-wide text-zinc-950 dark:text-zinc-100">
            {{ t("contact.sent.title", { ticketNo: sent.ticketNo }) }}
          </h2>
          <p class="mt-3 font-garamond-libre text-lg text-zinc-700 dark:text-zinc-300">
            {{ t("contact.sent.reply", { email: sent.email }) }}
          </p>
          <button
            type="button"
            class="mt-6 border-b-2 border-orange-600 pb-1 font-sans text-sm font-semibold text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100"
            data-testid="contact-another"
            @click="writeAnother">
            {{ t("contact.sent.another") }}
          </button>
        </section>

        <div v-else>
          <ReadingErrorState
            v-if="state === 'error'"
            class="mb-8"
            :title="t('contact.failedTitle')"
            :description="t('contact.failedDescription')"
            :request-id="failureRequestId ?? undefined"
            data-testid="contact-error" />

          <ContactForm
            v-model:topic="topic"
            v-model:email="email"
            v-model:message="message"
            v-model:path="path"
            v-model:accept-privacy="acceptPrivacy"
            :viewer="viewer"
            :account-email="accountEmail"
            :request-id="requestId"
            :errors="fieldErrors"
            :sending="state === 'sending'"
            :disabled="limited"
            @submit="submit">
            <template #status>
              <p
                v-if="limited && retryLeft !== null"
                role="status"
                class="font-sans text-sm text-zinc-700 dark:text-zinc-300"
                data-testid="contact-limited">
                {{ t("contact.limited", { timer: formatRetryAfter(retryLeft) }) }}
              </p>
            </template>
          </ContactForm>
        </div>
      </div>

      <aside class="flex flex-col gap-6">
        <LegalNoticeCard v-if="hintKey" :title="t('contact.hints.title')" data-testid="contact-hint">
          {{ t(`contact.hints.${hintKey}`) }}
          <NuxtLink
            v-if="hintKey === 'refund'"
            to="/me/subscription"
            class="ml-1 border-b border-orange-600 font-semibold"
            data-testid="contact-refund-link">
            {{ t("contact.hints.refundLink") }}
          </NuxtLink>
        </LegalNoticeCard>

        <section data-testid="contact-requisites">
          <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            {{ t("contact.requisites.title") }}
          </h2>
          <p class="mt-2 font-garamond-libre text-lg text-zinc-600 dark:text-zinc-400">
            {{ t("contact.requisites.text") }}
          </p>
        </section>
      </aside>
    </div>
  </article>
</template>
