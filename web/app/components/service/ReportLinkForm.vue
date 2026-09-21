<script setup lang="ts">
  import { computed, ref } from "vue"
  import { useBrokenLinkReport } from "~/composables/useBrokenLinkReport"

  /**
   * «Сообщить о битой ссылке» (`not-found.md` §5 зона 5, §6; журнал §20.15): ненавязчивая
   * текстовая кнопка, по нажатию — компактная форма с необязательным комментарием.
   * Состояния компонента: свёрнута, развёрнута, отправка, отправлено, лимит.
   */
  const props = defineProps<{ path: string }>()
  const { locale, t } = useI18n()
  const localePath = useLocalePath()

  const contactTo = computed(() => `${localePath("/contact")}?topic=broken_link&path=${encodeURIComponent(props.path)}`)

  const expanded = ref(false)
  const message = ref("")
  const { state, send } = useBrokenLinkReport()

  const submit = () => send(props.path, message.value, locale.value === "en" ? "en" : "ru")
</script>

<template>
  <section class="mt-16" data-testid="report-link">
    <button
      v-if="!expanded"
      type="button"
      data-testid="report-link-toggle"
      class="border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 transition-colors hover:border-orange-600 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 motion-reduce:transition-none dark:text-zinc-400 dark:hover:text-orange-400"
      @click="expanded = true">
      {{ t("service.reportLink") }}
    </button>

    <form v-else-if="state !== 'sent'" data-testid="report-link-form" class="max-w-xl" @submit.prevent="submit">
      <label for="report-link-message" class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {{ t("service.reportLinkLabel") }}
      </label>
      <textarea
        id="report-link-message"
        v-model="message"
        rows="3"
        data-testid="report-link-message"
        :placeholder="t('service.reportLinkPlaceholder')"
        class="mt-2 w-full border border-zinc-300 bg-white px-3 py-2 font-sans text-sm text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          data-testid="report-link-submit"
          :disabled="state === 'sending'"
          :aria-busy="state === 'sending' || undefined"
          class="inline-flex min-h-10 items-center border border-zinc-900 px-3 font-sans text-sm font-semibold text-zinc-950 transition-colors hover:border-orange-700 hover:bg-orange-700 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none dark:border-zinc-100 dark:text-zinc-100">
          {{ t("service.reportLinkSubmit") }}
        </button>
        <span
          v-if="state === 'sending'"
          data-testid="report-link-sending"
          class="font-sans text-sm text-zinc-600 dark:text-zinc-400">
          {{ t("service.reportLinkSending") }}
        </span>
      </div>

      <p
        v-if="state === 'limited'"
        data-testid="report-link-limited"
        class="mt-3 font-sans text-sm text-zinc-600 dark:text-zinc-400">
        {{ t("service.reportLinkLimited") }}
      </p>
      <p
        v-else-if="state === 'failed'"
        data-testid="report-link-failed"
        class="mt-3 font-sans text-sm text-zinc-600 dark:text-zinc-400">
        {{ t("service.reportLinkFailed") }}
        <NuxtLink
          :to="contactTo"
          class="border-b border-orange-600 text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
          {{ t("service.reportLinkContact") }}
        </NuxtLink>
      </p>
    </form>

    <p v-else data-testid="report-link-sent" class="font-sans text-sm text-zinc-600 dark:text-zinc-400">
      {{ t("service.reportLinkSent") }}
    </p>
  </section>
</template>
