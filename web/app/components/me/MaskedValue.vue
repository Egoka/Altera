<script setup lang="ts">
  import { ref } from "vue"

  /**
   * Скрытое значение с кнопкой «показать» (`email-change.md` §6): по умолчанию адрес
   * маскирован, полный открывается по нажатию. Компонент нужен и чекам, поэтому полное
   * значение он только показывает и никуда не отправляет.
   * Состояния компонента: скрыто / показано.
   */
  const props = defineProps<{ masked: string; value?: string | null; testid?: string }>()
  const { t } = useI18n()

  const revealed = ref(false)
</script>

<template>
  <span class="inline-flex flex-wrap items-baseline gap-3" :data-testid="props.testid ?? 'masked-value'">
    <span class="font-sans text-base text-zinc-900 dark:text-zinc-100" data-testid="masked-value-text">
      {{ revealed && props.value ? props.value : props.masked }}
    </span>
    <button
      v-if="props.value"
      type="button"
      data-testid="masked-value-toggle"
      :aria-pressed="revealed"
      class="border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 transition-colors hover:border-orange-600 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 motion-reduce:transition-none dark:text-zinc-400 dark:hover:text-orange-400"
      @click="revealed = !revealed">
      {{ revealed ? t("account.email.hide") : t("account.email.reveal") }}
    </button>
  </span>
</template>
