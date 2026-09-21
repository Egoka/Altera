<script setup lang="ts">
  import { computed, ref, watch } from "vue"
  import CodeInput from "./CodeInput.vue"

  /**
   * Адрес → код в одном окне (`email-change.md` §5 зоны 3–4, §6). `LoginForm` не подходит:
   * у него нет шага кода. Варианты: `address` и `code`; состояния — ошибка формата, код неверен,
   * код истёк, лимит.
   */
  interface EmailChangePending {
    newEmailMasked: string
    expiresAt: string
    attemptsLeft: number
  }

  const props = defineProps<{
    pending: EmailChangePending | null
    busy?: boolean
    expired?: boolean
    errorMessage?: string | null
  }>()

  const emit = defineEmits<{ request: [string]; confirm: [string]; cancel: [] }>()

  const { t, locale } = useI18n()

  const newEmail = ref("")
  const code = ref("")
  // Повторная отправка возвращает шаг адреса, когда открытый запрос пришёл с сервера: полного
  // адреса у экрана нет — он маскирован, а мутация повтора принимает тот же адрес (§7).
  const addressStepForced = ref(false)

  const variant = computed<"address" | "code">(() => (props.pending && !addressStepForced.value ? "code" : "address"))

  watch(
    () => props.pending,
    (next) => {
      if (next) addressStepForced.value = false
      else code.value = ""
    }
  )

  const expiresAtLabel = computed(() => {
    if (!props.pending) return ""
    const parsed = new Date(props.pending.expiresAt)
    if (Number.isNaN(parsed.getTime())) return ""

    return new Intl.DateTimeFormat(locale.value === "en" ? "en-GB" : "ru-RU", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(parsed)
  })

  const canRequest = computed(() => !props.busy && newEmail.value.trim().length > 0)
  const canConfirm = computed(() => !props.busy && !props.expired && code.value.length === 6)

  const submitAddress = () => {
    if (!canRequest.value) return
    emit("request", newEmail.value.trim())
  }

  const submitCode = () => {
    if (!canConfirm.value) return
    emit("confirm", code.value)
  }

  const resend = () => {
    if (props.busy) return
    if (newEmail.value.trim().length > 0) {
      emit("request", newEmail.value.trim())
      return
    }
    addressStepForced.value = true
  }
</script>

<template>
  <section :data-email-change-variant="variant" data-testid="email-change-form">
    <form v-if="variant === 'address'" class="flex max-w-xl flex-col gap-4" novalidate @submit.prevent="submitAddress">
      <label for="email-change-new" class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {{ t("account.email.newLabel") }}
      </label>
      <input
        id="email-change-new"
        v-model="newEmail"
        type="email"
        name="newEmail"
        autocomplete="email"
        inputmode="email"
        :disabled="props.busy"
        :placeholder="t('account.email.newPlaceholder')"
        data-testid="email-change-address"
        class="w-full border border-zinc-300 bg-white px-3 py-2 font-sans text-base text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
      <p class="font-sans text-sm text-zinc-600 dark:text-zinc-400">{{ t("account.email.newHint") }}</p>
      <div class="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          :disabled="!canRequest"
          :aria-busy="props.busy || undefined"
          data-testid="email-change-send"
          class="inline-flex min-h-11 w-full items-center justify-center border border-zinc-900 px-4 font-sans text-sm font-semibold text-zinc-950 transition-colors hover:border-orange-700 hover:bg-orange-700 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none sm:w-auto dark:border-zinc-100 dark:text-zinc-100">
          {{ t("account.email.send") }}
        </button>
        <button
          v-if="props.pending"
          type="button"
          data-testid="email-change-back"
          class="border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 hover:border-orange-600 hover:text-orange-700 dark:text-zinc-400"
          @click="addressStepForced = false">
          {{ t("account.email.backToCode") }}
        </button>
      </div>
    </form>

    <form v-else class="flex max-w-xl flex-col gap-4" novalidate @submit.prevent="submitCode">
      <p class="font-sans text-base text-zinc-900 dark:text-zinc-100" data-testid="email-change-sent-to">
        {{ t("account.email.sentTo", { email: props.pending?.newEmailMasked ?? "" }) }}
      </p>
      <label for="email-change-code" class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {{ t("account.email.codeLabel") }}
      </label>
      <CodeInput
        id="email-change-code"
        v-model="code"
        :disabled="props.busy || props.expired"
        :invalid="Boolean(props.errorMessage)" />

      <p
        v-if="props.expired"
        data-testid="email-change-expired"
        class="font-sans text-sm text-zinc-600 dark:text-zinc-400">
        {{ t("account.email.expired") }}
      </p>
      <p v-else class="font-sans text-sm text-zinc-600 dark:text-zinc-400" data-testid="email-change-expires-at">
        {{ t("account.email.expiresAt", { time: expiresAtLabel }) }}
      </p>
      <p class="font-sans text-sm text-zinc-600 dark:text-zinc-400" data-testid="email-change-attempts">
        {{ t("account.email.attemptsLeft", { count: props.pending?.attemptsLeft ?? 0 }) }}
      </p>

      <div class="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          :disabled="!canConfirm"
          :aria-busy="props.busy || undefined"
          data-testid="email-change-confirm"
          class="inline-flex min-h-11 w-full items-center justify-center border border-zinc-900 px-4 font-sans text-sm font-semibold text-zinc-950 transition-colors hover:border-orange-700 hover:bg-orange-700 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none sm:w-auto dark:border-zinc-100 dark:text-zinc-100">
          {{ t("account.email.confirm") }}
        </button>
        <button
          type="button"
          :disabled="props.busy"
          data-testid="email-change-resend"
          class="border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 hover:border-orange-600 hover:text-orange-700 disabled:opacity-60 dark:text-zinc-400"
          @click="resend">
          {{ t("account.email.resend") }}
        </button>
        <button
          type="button"
          :disabled="props.busy"
          data-testid="email-change-cancel"
          class="border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 hover:border-orange-600 hover:text-orange-700 disabled:opacity-60 dark:text-zinc-400"
          @click="emit('cancel')">
          {{ t("account.email.cancel") }}
        </button>
      </div>
    </form>

    <p
      v-if="props.errorMessage"
      role="alert"
      data-testid="email-change-error"
      class="mt-4 font-sans text-sm text-zinc-900 dark:text-zinc-100">
      {{ props.errorMessage }}
    </p>
  </section>
</template>
