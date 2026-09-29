<script setup lang="ts">
  import {
    GetTranslationReviewDocument,
    MarkReviewReadDocument,
    ReplyToDecisionDocument,
    ResolveReviewNoteDocument,
    type GetTranslationReviewQuery
  } from "~/graphql/generated/graphql"

  definePageMeta({
    i18n: false,
    layout: "auth",
    requiresAuth: true
  })

  const { t, locale } = useI18n()
  const route = useRoute()
  const translationId = String(route.params.id)
  type Review = GetTranslationReviewQuery["translationReview"]
  type ReviewItem = Review["items"][number]

  interface Envelope<T> {
    data?: T | null
    errors?: readonly { extensions?: Record<string, unknown> | null }[]
  }

  const errorCode = (errors: Envelope<unknown>["errors"]) =>
    errors?.find((error) => typeof error.extensions?.code === "string")?.extensions?.code as string | undefined

  const load = async (): Promise<{ review: Review | null; redirect: string | null }> => {
    const response = (await useGraphQL(GetTranslationReviewDocument, {
      id: translationId
    })) as Envelope<GetTranslationReviewQuery>
    if (response.data?.translationReview) return { review: response.data.translationReview, redirect: null }

    const code = errorCode(response.errors)
    if (code === "UNAUTHENTICATED") {
      return { review: null, redirect: `/login?next=${encodeURIComponent(route.fullPath)}` }
    }
    if (code === "FORBIDDEN") return { review: null, redirect: "/me/archived" }
    throw createError({
      statusCode: code === "NOT_FOUND" ? 404 : 500,
      statusMessage: "Review history is unavailable",
      fatal: true
    })
  }

  const {
    data: loaded,
    status,
    error,
    refresh
  } = await useAsyncData(`review-history-${translationId}`, load, {
    lazy: import.meta.client
  })
  const review = computed(() => loaded.value?.review ?? null)

  const applyLoadOutcome = () => {
    if (error.value) {
      if (import.meta.server) throw error.value
      return
    }
    if (loaded.value?.redirect) return navigateTo(loaded.value.redirect, { redirectCode: 302, replace: true })
  }

  if (import.meta.server) applyLoadOutcome()
  else watch([loaded, error], () => void applyLoadOutcome(), { immediate: true })

  useHead({
    title: () => `${t("review.pageTitle", { title: review.value?.title ?? t("review.untitled") })} — Altera`,
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })

  const pageState = computed(() => {
    if (!review.value) return error.value ? "error" : "loading"
    if (review.value.rejected) return "final_reject"
    if (review.value.status === "ai_check") return "pending"
    if (
      review.value.items.length === 0 &&
      review.value.notes.length === 0 &&
      review.value.aiDecision.decision === "none"
    ) {
      return "empty"
    }
    if (review.value.status === "rework") return "rework"
    if (review.value.status === "published") return "published"
    if (review.value.reviewState) return review.value.reviewState
    return "history"
  })

  const date = (value: string) =>
    new Intl.DateTimeFormat(locale.value === "ru" ? "ru-RU" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Moscow"
    }).format(new Date(value))

  const replyDrafts = reactive<Record<string, string>>({})
  const replyBusy = reactive<Record<string, boolean>>({})
  const replyErrors = reactive<Record<string, string | null>>({})
  const noteBusy = reactive<Record<string, boolean>>({})

  const sendReply = async (item: ReviewItem) => {
    const text = replyDrafts[item.id]?.trim() ?? ""
    if (!text || replyBusy[item.id]) return
    replyBusy[item.id] = true
    replyErrors[item.id] = null
    try {
      const response = (await useGraphQL(ReplyToDecisionDocument, {
        decisionId: item.id,
        text
      })) as Envelope<{ replyToDecision: ReviewItem["thread"][number] }>
      if (!response.data?.replyToDecision) {
        const code = errorCode(response.errors)
        replyErrors[item.id] = code === "RATE_LIMITED" ? t("review.errors.rateLimited") : t("review.errors.reply")
        return
      }
      item.thread.push(response.data.replyToDecision)
      replyDrafts[item.id] = ""
    } catch {
      replyErrors[item.id] = t("review.errors.reply")
    } finally {
      replyBusy[item.id] = false
    }
  }

  const resolveNote = async (noteId: string) => {
    const current = review.value?.notes.find((note) => note.id === noteId)
    if (!current || current.resolved || noteBusy[noteId]) return
    noteBusy[noteId] = true
    try {
      const response = (await useGraphQL(ResolveReviewNoteDocument, { noteId })) as Envelope<{
        resolveReviewNote: Review["notes"][number]
      }>
      if (response.data?.resolveReviewNote) Object.assign(current, response.data.resolveReviewNote)
    } finally {
      noteBusy[noteId] = false
    }
  }

  onMounted(() => {
    if (!review.value || !review.value.items.some((item) => item.readAt === null)) return
    void useGraphQL(MarkReviewReadDocument, { translationId })
  })
</script>

<template>
  <main class="min-h-full bg-stone-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
    <div class="mx-auto max-w-3xl px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
      <div v-if="status === 'pending'" data-review-state="loading" class="space-y-4" aria-busy="true">
        <div class="h-7 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"></div>
        <div class="h-32 animate-pulse rounded-3xl bg-zinc-200 dark:bg-zinc-900"></div>
        <div class="h-52 animate-pulse rounded-3xl bg-zinc-200 dark:bg-zinc-900"></div>
      </div>

      <section
        v-else-if="error || !review"
        data-review-state="error"
        class="border-l-4 border-red-600 bg-white p-6 dark:bg-zinc-900">
        <h1 class="text-2xl font-semibold">{{ t("review.error.title") }}</h1>
        <p class="mt-2 text-zinc-600 dark:text-zinc-300">{{ t("review.error.description") }}</p>
        <button class="mt-5 font-semibold underline" type="button" @click="refresh()">{{ t("review.retry") }}</button>
      </section>

      <section v-else :data-review-state="pageState">
        <header class="border-b border-zinc-950 pb-8 dark:border-zinc-100">
          <NuxtLink to="/me/articles" class="text-sm font-semibold underline underline-offset-4">
            {{ t("review.back") }}
          </NuxtLink>
          <p class="mt-8 text-xs font-bold uppercase tracking-[0.24em] text-orange-700 dark:text-orange-400">
            {{ t("review.eyebrow") }} · {{ t(`review.locale.${review.locale}`) }}
          </p>
          <h1 data-testid="review-title" class="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
            {{ review.title || t("review.untitled") }}
          </h1>
          <p class="mt-4 text-lg text-zinc-600 dark:text-zinc-300">{{ t(`review.state.${pageState}`) }}</p>
        </header>

        <div
          v-if="review.rejected"
          class="mt-6 border-l-4 border-zinc-950 bg-white p-5 dark:border-zinc-100 dark:bg-zinc-900">
          <p class="font-semibold">{{ t("review.readOnly.finalReject") }}</p>
        </div>
        <div
          v-else-if="review.planLimited"
          class="mt-6 border-l-4 border-orange-600 bg-orange-50 p-5 dark:bg-orange-950/30">
          <p class="font-semibold">{{ t("review.readOnly.plan") }}</p>
          <NuxtLink to="/pricing" class="mt-2 inline-block underline underline-offset-4">{{
            t("review.pricing")
          }}</NuxtLink>
        </div>

        <section
          v-if="pageState === 'empty'"
          class="mt-8 rounded-3xl border border-dashed border-zinc-300 bg-white p-8 dark:border-zinc-700 dark:bg-zinc-900">
          <h2 class="text-2xl font-semibold">{{ t("review.empty.title") }}</h2>
          <p class="mt-3 text-zinc-600 dark:text-zinc-300">{{ t("review.empty.description") }}</p>
        </section>

        <section
          v-if="review.aiDecision.decision !== 'none'"
          data-testid="review-reasons"
          class="mt-8 rounded-3xl bg-zinc-950 p-6 text-white dark:bg-zinc-100 dark:text-zinc-950 sm:p-8">
          <p class="text-xs font-bold uppercase tracking-[0.2em] text-orange-400">{{ t("review.ai.eyebrow") }}</p>
          <h2 class="mt-3 text-2xl font-semibold">{{ t(`review.ai.${review.aiDecision.decision}`) }}</h2>
          <ul v-if="review.aiDecision.reasons.length" class="mt-6 space-y-5">
            <li v-for="reason in review.aiDecision.reasons" :key="`${reason.category}-${reason.anchor}`">
              <NuxtLink
                :to="`/legal/content-rules#${reason.category}`"
                class="font-semibold text-orange-300 underline underline-offset-4 dark:text-orange-700">
                {{ t(`review.reason.${reason.category}`) }}
              </NuxtLink>
              <p class="mt-1 leading-7">{{ reason.text }}</p>
            </li>
          </ul>
          <p
            v-if="review.aiDecision.decision === 'reject'"
            class="mt-6 border-t border-white/20 pt-5 text-sm leading-6">
            {{ t("review.ai.noRepeat") }}
          </p>
        </section>

        <section v-if="review.notes.length" class="mt-10">
          <h2 class="text-2xl font-semibold">{{ t("review.notes.title") }}</h2>
          <ul class="mt-4 space-y-3">
            <li
              v-for="note in review.notes"
              :key="note.id"
              :data-testid="`review-note-${note.id}`"
              class="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p class="text-xs font-bold uppercase tracking-wider text-zinc-500">
                {{ t("review.notes.block", { id: note.blockId }) }}
              </p>
              <p class="mt-2 leading-7">{{ note.text }}</p>
              <p v-if="note.resolved" class="mt-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                {{ t("review.notes.resolved") }}
              </p>
              <button
                v-else-if="!review.readOnly && review.status === 'rework'"
                :data-testid="`review-note-resolve-${note.id}`"
                :disabled="noteBusy[note.id]"
                class="mt-4 text-sm font-semibold underline underline-offset-4 disabled:opacity-50"
                type="button"
                @click="resolveNote(note.id)">
                {{ t("review.notes.resolve") }}
              </button>
            </li>
          </ul>
        </section>

        <section v-if="review.items.length" class="mt-10">
          <h2 class="text-2xl font-semibold">{{ t("review.history.title") }}</h2>
          <ol class="mt-5 space-y-5 border-l border-zinc-300 pl-5 dark:border-zinc-700">
            <li
              v-for="item in review.items"
              :id="`decision-${item.id}`"
              :key="item.id"
              class="relative rounded-3xl bg-white p-5 shadow-sm dark:bg-zinc-900 sm:p-6">
              <span
                class="absolute -left-[1.65rem] top-7 h-3 w-3 rounded-full bg-orange-600 ring-4 ring-stone-50 dark:ring-zinc-950"></span>
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <h3 class="text-lg font-semibold">{{ t(`review.kind.${item.kind}`) }}</h3>
                <time class="text-sm text-zinc-500">{{ date(item.createdAt) }}</time>
              </div>
              <p class="mt-1 text-sm text-zinc-500">
                {{ item.byRole ? t(`review.role.${item.byRole}`) : t("review.role.system") }}
              </p>
              <p v-if="item.text" class="mt-4 whitespace-pre-line leading-7">{{ item.text }}</p>
              <details v-if="item.recommendations" class="mt-4 rounded-xl bg-zinc-100 p-4 dark:bg-zinc-800" open>
                <summary class="cursor-pointer font-semibold">{{ t("review.recommendations") }}</summary>
                <p class="mt-2 whitespace-pre-line leading-7">{{ item.recommendations }}</p>
              </details>

              <div
                :data-testid="`review-thread-${item.id}`"
                class="mt-5 space-y-3 border-t border-zinc-200 pt-5 dark:border-zinc-700">
                <p v-if="!item.thread.length" class="text-sm text-zinc-500">{{ t("review.thread.empty") }}</p>
                <article
                  v-for="message in item.thread"
                  :key="message.id"
                  class="rounded-xl bg-zinc-100 p-4 dark:bg-zinc-800">
                  <div class="flex flex-wrap justify-between gap-2 text-sm font-semibold">
                    <span>{{ message.author ? t("review.role.author") : t(`review.role.${message.byRole}`) }}</span>
                    <time class="font-normal text-zinc-500">{{ date(message.createdAt) }}</time>
                  </div>
                  <p class="mt-2 leading-7">{{ message.text }}</p>
                </article>
              </div>

              <form
                v-if="item.canReply && !review.readOnly"
                :data-testid="`review-reply-form-${item.id}`"
                class="mt-5"
                @submit.prevent="sendReply(item)">
                <label :for="`reply-${item.id}`" class="text-sm font-semibold">{{ t("review.thread.reply") }}</label>
                <textarea
                  :id="`reply-${item.id}`"
                  v-model="replyDrafts[item.id]"
                  :data-testid="`review-reply-input-${item.id}`"
                  rows="3"
                  class="mt-2 w-full rounded-xl border border-zinc-300 bg-transparent p-3 focus:border-orange-600 focus:outline-none dark:border-zinc-700"></textarea>
                <p v-if="replyErrors[item.id]" class="mt-2 text-sm text-red-700 dark:text-red-300">
                  {{ replyErrors[item.id] }}
                </p>
                <button
                  :disabled="!replyDrafts[item.id]?.trim() || replyBusy[item.id]"
                  class="mt-3 rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950"
                  type="submit">
                  {{ t("review.thread.send") }}
                </button>
              </form>
            </li>
          </ol>
        </section>

        <aside class="mt-10 border-t border-zinc-300 pt-8 dark:border-zinc-700">
          <h2 class="text-xl font-semibold">{{ t("review.next.title") }}</h2>
          <p class="mt-3 leading-7 text-zinc-600 dark:text-zinc-300">{{ t("review.next.description") }}</p>
          <div class="mt-5 flex flex-wrap gap-3">
            <NuxtLink
              :to="`/me/articles/${translationId}/edit`"
              data-testid="review-open-editor"
              class="rounded-full bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white">
              {{ t(review.readOnly ? "review.openReadOnly" : "review.openEditor") }}
            </NuxtLink>
            <NuxtLink to="/me/articles" class="rounded-full border border-zinc-400 px-5 py-2.5 text-sm font-semibold">
              {{ t("review.allArticles") }}
            </NuxtLink>
          </div>
        </aside>
      </section>
    </div>
  </main>
</template>
