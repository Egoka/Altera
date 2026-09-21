<script setup lang="ts">
  import { computed, ref, watch } from "vue"
  import type { SupportTopic } from "~/graphql/generated/graphql"
  import {
    CONTACT_MESSAGE_MAX,
    CONTACT_MESSAGE_MIN,
    CONTACT_TOPICS,
    type ContactField,
    type ContactFieldError
  } from "~/utils/contactForm"

  /**
   * `ContactForm` (`contact.md` §5 зона 3, §6): тема, e-mail (у аккаунта скрыт), текст, ссылка на
   * страницу и скрытый `requestId`; согласие с политикой ПД — только гостю. Состояния компонента:
   * ошибки полей, лимит, отправка. Сама отправка и строка «отправлено» — на странице.
   */
  const props = defineProps<{
    viewer: "guest" | "account"
    accountEmail: string | null
    requestId: string
    errors: Partial<Record<ContactField, ContactFieldError>>
    sending: boolean
    disabled: boolean
  }>()
  const emit = defineEmits<{ submit: [] }>()

  const topic = defineModel<SupportTopic>("topic", { required: true })
  const email = defineModel<string>("email", { required: true })
  const message = defineModel<string>("message", { required: true })
  const path = defineModel<string>("path", { required: true })
  const acceptPrivacy = defineModel<boolean>("acceptPrivacy", { required: true })

  const { t } = useI18n()
  const localePath = useLocalePath()

  // Предзаполненная со страницы 404 ссылка свёрнута в строку и раскрывается по кнопке (§9 `[ДОПУЩЕНИЕ]`).
  const pathExpanded = ref(!path.value)
  watch(
    () => props.errors.path,
    (error) => {
      if (error) pathExpanded.value = true
    }
  )

  const errorText = (field: ContactField): string | null => {
    const error = props.errors[field]
    if (!error) return null
    if (field === "acceptPrivacy") return t("contact.errors.consent")
    if (field === "path") return t("contact.errors.path")
    return t(`contact.errors.${error}`, { min: CONTACT_MESSAGE_MIN, max: CONTACT_MESSAGE_MAX })
  }

  const describedBy = (field: ContactField, hint?: string) =>
    [props.errors[field] ? `contact-${field}-error` : null, hint].filter(Boolean).join(" ") || undefined

  const fieldClass =
    "mt-2 w-full border bg-white px-3 py-2 font-sans text-base text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:bg-zinc-950 dark:text-zinc-100"
  const borderOf = (field: ContactField) =>
    props.errors[field] ? "border-red-600 dark:border-red-500" : "border-zinc-300 dark:border-zinc-700"

  const messageLength = computed(() => message.value.trim().length)
</script>

<template>
  <form class="flex flex-col gap-6" novalidate data-testid="contact-form" @submit.prevent="emit('submit')">
    <div>
      <label for="contact-topic" class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {{ t("contact.fields.topic") }}
      </label>
      <select
        id="contact-topic"
        v-model="topic"
        data-testid="contact-topic"
        :class="[fieldClass, 'border-zinc-300 dark:border-zinc-700']">
        <option v-for="value in CONTACT_TOPICS" :key="value" :value="value">
          {{ t(`contact.topics.${value}`) }}
        </option>
      </select>
    </div>

    <div v-if="viewer === 'guest'">
      <label for="contact-email" class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {{ t("contact.fields.email") }}
      </label>
      <input
        id="contact-email"
        v-model="email"
        type="email"
        autocomplete="email"
        inputmode="email"
        data-testid="contact-email"
        :aria-invalid="Boolean(errors.email) || undefined"
        :aria-describedby="describedBy('email')"
        :class="[fieldClass, borderOf('email')]" />
      <p
        v-if="errors.email"
        id="contact-email-error"
        class="mt-1 font-sans text-sm text-red-700 dark:text-red-400"
        data-testid="contact-email-error">
        {{ errorText("email") }}
      </p>
    </div>
    <p v-else class="font-sans text-sm text-zinc-600 dark:text-zinc-400" data-testid="contact-account-email">
      {{ t("contact.fields.accountEmail", { email: accountEmail ?? "" }) }}
    </p>

    <div>
      <label for="contact-message" class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {{ t("contact.fields.message") }}
      </label>
      <textarea
        id="contact-message"
        v-model="message"
        rows="6"
        :maxlength="CONTACT_MESSAGE_MAX"
        data-testid="contact-message"
        :aria-invalid="Boolean(errors.message) || undefined"
        :aria-describedby="describedBy('message', 'contact-message-hint')"
        :class="[fieldClass, borderOf('message')]" />
      <p id="contact-message-hint" class="mt-1 font-sans text-xs text-zinc-500">
        {{ t("contact.fields.messageHint", { min: CONTACT_MESSAGE_MIN, max: CONTACT_MESSAGE_MAX }) }}
        · {{ messageLength }}
      </p>
      <p
        v-if="errors.message"
        id="contact-message-error"
        class="mt-1 font-sans text-sm text-red-700 dark:text-red-400"
        data-testid="contact-message-error">
        {{ errorText("message") }}
      </p>
    </div>

    <div>
      <template v-if="pathExpanded">
        <label for="contact-path" class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {{ t("contact.fields.path") }}
        </label>
        <input
          id="contact-path"
          v-model="path"
          type="text"
          data-testid="contact-path"
          :placeholder="t('contact.fields.pathPlaceholder')"
          :aria-invalid="Boolean(errors.path) || undefined"
          :aria-describedby="describedBy('path')"
          :class="[fieldClass, borderOf('path')]" />
        <p
          v-if="errors.path"
          id="contact-path-error"
          class="mt-1 font-sans text-sm text-red-700 dark:text-red-400"
          data-testid="contact-path-error">
          {{ errorText("path") }}
        </p>
      </template>
      <p v-else class="font-sans text-sm text-zinc-700 dark:text-zinc-300" data-testid="contact-path-line">
        {{ t("contact.fields.pathLine", { path }) }}
        <button
          type="button"
          class="ml-2 border-b border-zinc-400 font-semibold hover:border-orange-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600"
          data-testid="contact-path-edit"
          @click="pathExpanded = true">
          {{ t("contact.fields.pathEdit") }}
        </button>
      </p>
      <p v-if="requestId" class="mt-2 font-mono text-xs text-zinc-500" data-testid="contact-request-id">
        {{ t("contact.fields.requestIdLine", { requestId }) }}
      </p>
    </div>

    <div v-if="viewer === 'guest'">
      <label class="flex items-start gap-3 font-sans text-sm text-zinc-700 dark:text-zinc-300">
        <input
          v-model="acceptPrivacy"
          type="checkbox"
          class="mt-0.5 size-4 accent-orange-600"
          data-testid="contact-consent"
          :aria-invalid="Boolean(errors.acceptPrivacy) || undefined"
          :aria-describedby="describedBy('acceptPrivacy')" />
        <span>
          {{ t("contact.fields.consent") }}
          <NuxtLink :to="localePath('/legal/privacy')" class="border-b border-orange-600" target="_blank">
            {{ t("contact.fields.consentLink") }}
          </NuxtLink>
        </span>
      </label>
      <p
        v-if="errors.acceptPrivacy"
        id="contact-acceptPrivacy-error"
        class="mt-1 font-sans text-sm text-red-700 dark:text-red-400"
        data-testid="contact-consent-error">
        {{ errorText("acceptPrivacy") }}
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        data-testid="contact-submit"
        :disabled="sending || disabled"
        :aria-busy="sending || undefined"
        class="inline-flex min-h-11 w-full items-center justify-center bg-zinc-950 px-6 font-sans text-sm font-semibold text-white transition-colors hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none sm:w-auto dark:bg-zinc-100 dark:text-zinc-950">
        {{ sending ? t("contact.sending") : t("contact.submit") }}
      </button>
      <slot name="status" />
    </div>
  </form>
</template>
