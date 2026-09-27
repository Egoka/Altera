<script setup lang="ts">
  import { ConfirmAccountArchiveDocument } from "~/graphql/generated/graphql"
  import { isConfirmationWord } from "~/utils/accountArchive"

  definePageMeta({
    i18n: false,
    layout: "auth",
    requiresAuth: true
  })

  /**
   * Подтверждение из письма (`docs/spec/30-account/reader/delete-account.md` §3, §5, §8).
   * Ссылка одноразовая и требует сессии того же аккаунта (§4 `[ДОПУЩЕНИЕ]`).
   *
   * Спецификация описывает шаг как «сообщение и 302 на `/`». Переноса сообщения на главную в
   * приложении нет, а редирект сразу после подтверждения увёл бы единственную строку состояния
   * с экрана, поэтому сообщение остаётся здесь и уводит на `/` ссылкой.
   */
  type PageState = "form" | "done" | "invalid" | "error"

  interface GraphQLErrorLike {
    extensions?: Record<string, unknown> | null
  }

  interface GraphQLEnvelope<T> {
    data?: T | null
    errors?: readonly GraphQLErrorLike[]
  }

  const { t } = useI18n()
  const route = useRoute()

  useHead({
    title: () => `${t("account.delete.confirm.pageTitle")} — Altera`,
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })

  const token = computed(() => (typeof route.query.token === "string" ? route.query.token : ""))
  const confirmationWord = computed(() => t("account.delete.confirm.word"))

  const state = ref<PageState>(token.value ? "form" : "invalid")
  const entered = ref("")
  const busy = ref(false)
  const requestId = ref<string | null>(null)

  const canSubmit = computed(() => !busy.value && isConfirmationWord(entered.value, confirmationWord.value))

  const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string) => errors?.[0]?.extensions?.[key]

  const confirm = async () => {
    if (!canSubmit.value) return
    busy.value = true
    requestId.value = null

    try {
      const envelope = (await useGraphQL(ConfirmAccountArchiveDocument, { token: token.value })) as GraphQLEnvelope<{
        confirmAccountArchive: { archived: boolean }
      }>

      if (envelope.data?.confirmAccountArchive.archived) {
        state.value = "done"
        return
      }

      const code = readExtension(envelope.errors, "code")
      if (code === "UNAUTHENTICATED") {
        await navigateTo(
          { path: "/login", query: { next: `/me/delete/confirm?token=${token.value}` } },
          { replace: true, redirectCode: 302 }
        )
        return
      }
      // Истёкшая, использованная и чужая ссылка отвечают одинаково (§8).
      if (code === "NOT_FOUND") {
        state.value = "invalid"
        return
      }

      const id = readExtension(envelope.errors, "requestId")
      requestId.value = typeof id === "string" ? id : null
      state.value = "error"
    } catch {
      state.value = "error"
    } finally {
      busy.value = false
    }
  }
</script>

<template>
  <section class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-16" :data-confirm-archive-state="state">
    <div v-if="state === 'form' || state === 'error'" class="flex flex-col gap-8">
      <h1 class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">{{ t("account.delete.confirm.title") }}</h1>
      <p class="font-sans text-base text-zinc-700 dark:text-zinc-300">
        {{ t("account.delete.confirm.body", { word: confirmationWord }) }}
      </p>

      <form class="flex flex-col gap-4" @submit.prevent="confirm">
        <label class="flex flex-col gap-2 font-sans text-sm text-zinc-800 dark:text-zinc-200">
          {{ t("account.delete.confirm.inputLabel") }}
          <input
            v-model="entered"
            type="text"
            autocomplete="off"
            data-testid="confirm-archive-word"
            class="min-h-11 w-full max-w-xs border border-zinc-400 px-3 font-sans text-base text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:border-zinc-600 dark:text-zinc-50" />
        </label>

        <p
          v-if="state === 'error'"
          role="alert"
          data-testid="confirm-archive-error"
          class="font-sans text-base text-orange-700">
          {{ t("account.delete.confirm.error", { requestId: requestId ?? "—" }) }}
        </p>

        <div class="flex flex-wrap items-center gap-6">
          <button
            type="submit"
            data-testid="confirm-archive-submit"
            :disabled="!canSubmit"
            class="inline-flex min-h-11 w-full items-center justify-center border border-zinc-900 px-4 font-sans text-sm font-semibold text-zinc-950 transition-colors hover:border-orange-700 hover:bg-orange-700 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none sm:w-auto dark:border-zinc-100 dark:text-zinc-100">
            {{ t("account.delete.confirm.submit") }}
          </button>
          <NuxtLink
            to="/me/delete"
            data-testid="confirm-archive-cancel"
            class="border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 hover:border-orange-600 hover:text-orange-700 dark:text-zinc-400">
            {{ t("account.delete.confirm.cancel") }}
          </NuxtLink>
        </div>
      </form>
    </div>

    <div v-else-if="state === 'done'" class="flex flex-col gap-8">
      <h1 class="font-serif text-3xl text-zinc-950 dark:text-zinc-50" data-testid="confirm-archive-done">
        {{ t("account.delete.confirm.doneTitle") }}
      </h1>
      <p class="font-sans text-base text-zinc-700 dark:text-zinc-300">{{ t("account.delete.confirm.doneBody") }}</p>
      <!-- Сессии отозваны, cookie стёрты маршрутом BFF: уход выполняется полным переходом. -->
      <a
        href="/"
        data-testid="confirm-archive-home"
        class="self-start border-b border-orange-600 pb-0.5 font-sans text-sm text-zinc-950 dark:text-zinc-100">
        {{ t("account.delete.confirm.doneAction") }}
      </a>
    </div>

    <div v-else class="flex flex-col gap-8">
      <h1 class="font-serif text-3xl text-zinc-950 dark:text-zinc-50" data-testid="confirm-archive-invalid">
        {{ t("account.delete.confirm.invalidTitle") }}
      </h1>
      <p class="font-sans text-base text-zinc-700 dark:text-zinc-300">{{ t("account.delete.confirm.invalidBody") }}</p>
      <NuxtLink
        to="/me/delete"
        data-testid="confirm-archive-restart"
        class="self-start border-b border-orange-600 pb-0.5 font-sans text-sm text-zinc-950 dark:text-zinc-100">
        {{ t("account.delete.confirm.invalidAction") }}
      </NuxtLink>
    </div>
  </section>
</template>
