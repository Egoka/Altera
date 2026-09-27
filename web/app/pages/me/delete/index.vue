<script setup lang="ts">
  import {
    CancelAccountArchiveDocument,
    GetAccountArchivePreviewDocument,
    RequestAccountArchiveDocument,
    type AccountArchivePreviewFieldsFragment
  } from "~/graphql/generated/graphql"
  import {
    accountArchiveErrorKind,
    isArchiveRequestExpired,
    type AccountArchiveErrorKind
  } from "~/utils/accountArchive"
  import NoticeCard from "~/components/legal/NoticeCard.vue"

  definePageMeta({
    i18n: false,
    layout: "auth",
    requiresAuth: true
  })

  // Спецификация: docs/spec/30-account/reader/delete-account.md. Таблица состояний — §8.
  // «Удалить» здесь значит «архивировать»: данные сохраняются, вернуться можно самому (журнал §5.1–2).
  type PageState = "loading" | "data_error" | "ready"

  interface GraphQLErrorLike {
    extensions?: Record<string, unknown> | null
  }

  interface GraphQLEnvelope<T> {
    data?: T | null
    errors?: readonly GraphQLErrorLike[]
  }

  const { t, locale } = useI18n()

  useHead({
    title: () => `${t("account.delete.pageTitle")} — Altera`,
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })

  const readExtension = (errors: readonly GraphQLErrorLike[] | undefined, key: string) => errors?.[0]?.extensions?.[key]

  /**
   * Ограниченная сессия видит только экран состояния, гость — форму входа (§3, §8).
   * Возвращает `true`, когда уход со страницы уже начат и обрабатывать отказ больше не нужно.
   */
  const leaveOnAccessFailure = async (errors: readonly GraphQLErrorLike[] | undefined): Promise<boolean> => {
    const code = readExtension(errors, "code")
    if (code === "FORBIDDEN") {
      await navigateTo("/me/archived", { replace: true, redirectCode: 302 })
      return true
    }
    if (code === "UNAUTHENTICATED") {
      await navigateTo({ path: "/login", query: { next: "/me/delete" } }, { replace: true, redirectCode: 302 })
      return true
    }

    return false
  }

  const emptyPreview: AccountArchivePreviewFieldsFragment = {
    articlesCount: 0,
    isLastOwner: false,
    plan: null,
    pending: null
  }

  const fetchPreview = async (): Promise<AccountArchivePreviewFieldsFragment> => {
    const envelope = (await useGraphQL(GetAccountArchivePreviewDocument)) as GraphQLEnvelope<{
      me: { id: string; archivePreview: AccountArchivePreviewFieldsFragment } | null
    }>

    if (!envelope.data?.me) {
      if (await leaveOnAccessFailure(envelope.errors)) return emptyPreview
      throw createError({ statusCode: 500, statusMessage: "archivePreview" })
    }

    return envelope.data.me.archivePreview
  }

  const { data, status, error, refresh } = await useAsyncData("account-archive-preview", fetchPreview, {
    server: false
  })

  const preview = ref<AccountArchivePreviewFieldsFragment | null>(null)
  watch(data, (next) => (preview.value = next ?? preview.value), { immediate: true })

  const pageState = computed<PageState>(() => {
    if (error.value) return "data_error"
    if (!preview.value || status.value === "pending") return "loading"
    return "ready"
  })

  const busy = ref(false)
  const cancelled = ref(false)
  const errorKind = ref<AccountArchiveErrorKind | null>(null)
  const errorRetryAfter = ref<number | null>(null)
  const requestId = ref<string | null>(null)

  // Истёкшую ссылку сервер уже не признаёт: экран возвращается к кнопке «отправить письмо» (§5).
  const pending = computed(() => {
    const open = preview.value?.pending ?? null
    return open && !isArchiveRequestExpired(open.expiresAt) ? open : null
  })
  const lastOwner = computed(() => preview.value?.isLastOwner === true)

  const pendingUntil = computed(() =>
    pending.value
      ? new Intl.DateTimeFormat(locale.value, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(
          new Date(pending.value.expiresAt)
        )
      : ""
  )

  const errorMessage = computed(() => {
    if (!errorKind.value) return null
    if (errorKind.value === "rateLimited") {
      const minutes = errorRetryAfter.value === null ? null : Math.max(1, Math.ceil(errorRetryAfter.value / 60))
      return t("account.delete.error.rateLimited", { retryAfter: minutes === null ? "—" : `${minutes}` })
    }
    if (errorKind.value === "generic") {
      return t("account.delete.error.generic", { requestId: requestId.value ?? "—" })
    }
    return t(`account.delete.error.${errorKind.value}`)
  })

  const applyFailure = async (errors: readonly GraphQLErrorLike[] | undefined): Promise<void> => {
    if (await leaveOnAccessFailure(errors)) return

    const id = readExtension(errors, "requestId")
    requestId.value = typeof id === "string" ? id : null
    const retryAfter = readExtension(errors, "retryAfter")
    errorRetryAfter.value = typeof retryAfter === "number" ? retryAfter : null
    errorKind.value = accountArchiveErrorKind({
      code: readExtension(errors, "code"),
      entity: readExtension(errors, "entity"),
      actual: readExtension(errors, "actual")
    })

    // Открытый запрос и инвариант владельцев экран должен увидеть на следующем чтении.
    if (errorKind.value === "openRequest" || errorKind.value === "lastOwner") await refresh()
  }

  async function run<T>(
    call: () => Promise<GraphQLEnvelope<T>>,
    apply: (payload: T) => void | Promise<void>
  ): Promise<void> {
    if (busy.value) return
    busy.value = true
    errorKind.value = null
    errorRetryAfter.value = null
    requestId.value = null

    try {
      const envelope = await call()
      if (!envelope.data) {
        await applyFailure(envelope.errors)
        return
      }
      await apply(envelope.data)
    } catch {
      errorKind.value = "generic"
    } finally {
      busy.value = false
    }
  }

  const requestArchive = () =>
    run(
      () => useGraphQL(RequestAccountArchiveDocument),
      (payload) => {
        cancelled.value = false
        preview.value = payload.requestAccountArchive
      }
    )

  const cancelArchive = () =>
    run(
      () => useGraphQL(CancelAccountArchiveDocument),
      (payload) => {
        cancelled.value = true
        preview.value = payload.cancelAccountArchive
      }
    )
</script>

<template>
  <section class="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-16" :data-delete-account-state="pageState">
    <h1 class="font-serif text-3xl text-zinc-950 dark:text-zinc-50">{{ t("account.delete.pageTitle") }}</h1>

    <div v-if="pageState === 'loading'" data-testid="delete-account-skeleton" class="flex flex-col gap-4">
      <span class="h-4 w-64 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      <span class="h-24 w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      <span class="h-11 w-full max-w-xs animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>

    <div
      v-else-if="pageState === 'data_error'"
      role="alert"
      data-testid="delete-account-data-error"
      class="flex flex-col gap-3">
      <p class="font-sans text-base text-zinc-900 dark:text-zinc-100">
        {{ t("account.delete.error.dataUnavailable") }}
      </p>
      <button
        type="button"
        data-testid="delete-account-retry"
        class="self-start border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 hover:border-orange-600 hover:text-orange-700 dark:text-zinc-400"
        @click="refresh()">
        {{ t("account.delete.retry") }}
      </button>
    </div>

    <template v-else>
      <p class="font-sans text-base text-zinc-700 dark:text-zinc-300" data-testid="delete-account-lead">
        {{ t("account.delete.lead") }}
      </p>

      <NoticeCard :title="t('account.delete.consequencesTitle')" tone="accent">
        <ul class="flex flex-col gap-2" data-testid="delete-account-consequences">
          <li>{{ t("account.delete.consequenceAccess") }}</li>
          <li>{{ t("account.delete.consequenceProfile") }}</li>
          <li>{{ t("account.delete.consequenceData") }}</li>
          <li>{{ t("account.delete.consequenceReturn") }}</li>
        </ul>
      </NoticeCard>

      <p class="font-sans text-base text-zinc-900 dark:text-zinc-100" data-testid="delete-account-articles">
        {{
          preview?.articlesCount
            ? t("account.delete.articlesCount", { count: preview.articlesCount })
            : t("account.delete.articlesNone")
        }}
      </p>
      <p
        v-if="preview?.plan"
        class="font-sans text-base text-zinc-700 dark:text-zinc-300"
        data-testid="delete-account-plan">
        {{ t("account.delete.planNote") }}
      </p>

      <div class="flex flex-col gap-2">
        <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("account.delete.exportTitle") }}
        </h2>
        <!-- Выгрузка данных — отдельная задача (T-034); адрес зафиксирован реестром маршрутов #39. -->
        <a
          href="/me/export"
          data-testid="delete-account-export"
          class="self-start border-b border-orange-600 font-sans text-sm text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
          {{ t("account.delete.exportLink") }}
        </a>
      </div>

      <fieldset class="flex flex-col gap-2" data-testid="delete-account-fate">
        <legend class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("account.delete.fateTitle") }}
        </legend>
        <label class="flex items-center gap-3 font-sans text-base text-zinc-900 dark:text-zinc-100">
          <input type="radio" name="archive-fate" value="archive" checked class="size-4 accent-orange-600" />
          {{ t("account.delete.fateOption") }}
        </label>
        <p class="font-sans text-sm text-zinc-600 dark:text-zinc-400">{{ t("account.delete.fateNote") }}</p>
      </fieldset>

      <p
        v-if="cancelled"
        role="status"
        data-testid="delete-account-cancelled"
        class="font-sans text-base text-zinc-900 dark:text-zinc-100">
        {{ t("account.delete.cancelled") }}
      </p>
      <p
        v-if="errorMessage"
        role="alert"
        data-testid="delete-account-error"
        class="font-sans text-base text-orange-700">
        {{ errorMessage }}
      </p>

      <p
        v-if="lastOwner"
        role="alert"
        data-testid="delete-account-last-owner"
        class="font-sans text-base text-orange-700">
        {{ t("account.delete.error.lastOwner") }}
      </p>

      <div v-else-if="pending" class="flex flex-col gap-3" data-testid="delete-account-pending">
        <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("account.delete.pendingTitle") }}
        </h2>
        <p class="font-sans text-base text-zinc-900 dark:text-zinc-100">
          {{ t("account.delete.pendingBody", { time: pendingUntil }) }}
        </p>
        <button
          type="button"
          data-testid="delete-account-cancel"
          :disabled="busy"
          class="self-start border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 transition-colors hover:border-orange-600 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none dark:text-zinc-400"
          @click="cancelArchive">
          {{ t("account.delete.cancel") }}
        </button>
      </div>

      <button
        v-else
        type="button"
        data-testid="delete-account-send"
        :disabled="busy"
        class="inline-flex min-h-11 w-full items-center justify-center border border-zinc-900 px-4 font-sans text-sm font-semibold text-zinc-950 transition-colors hover:border-orange-700 hover:bg-orange-700 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none sm:w-auto sm:self-start dark:border-zinc-100 dark:text-zinc-100"
        @click="requestArchive">
        {{ busy ? t("account.delete.sending") : t("account.delete.send") }}
      </button>
    </template>
  </section>
</template>
