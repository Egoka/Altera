<script setup lang="ts">
  import { ref } from "vue"

  /**
   * Поле с кнопкой копирования (`docs/spec/20-public/error.md` §6). Второе состояние —
   * «буфер недоступен»: в небезопасном контексте и в части браузеров `navigator.clipboard`
   * нет вовсе, поэтому значение тогда выделяется, а не теряется.
   */
  const props = defineProps<{ label: string; value: string }>()
  const { t } = useI18n()

  const copied = ref(false)
  const unavailable = ref(false)
  const field = ref<HTMLElement | null>(null)

  const selectValue = () => {
    const node = field.value
    if (!node || typeof window === "undefined") return
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value)
      copied.value = true
      unavailable.value = false
    } catch {
      copied.value = false
      unavailable.value = true
      selectValue()
    }
  }
</script>

<template>
  <div class="mt-6">
    <p class="font-sans text-xs uppercase tracking-wider text-zinc-500">{{ label }}</p>
    <div class="mt-2 flex flex-wrap items-center gap-3">
      <code
        ref="field"
        data-testid="copy-field-value"
        class="min-w-0 break-all border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
        {{ value }}
      </code>
      <button
        type="button"
        data-testid="copy-field-button"
        class="inline-flex min-h-10 items-center border border-zinc-900 px-3 font-sans text-sm font-semibold text-zinc-950 transition-colors hover:border-orange-700 hover:bg-orange-700 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 motion-reduce:transition-none dark:border-zinc-100 dark:text-zinc-100"
        @click="copy">
        {{ t("service.copy") }}
      </button>
    </div>
    <p v-if="copied" data-testid="copy-field-copied" class="mt-2 font-sans text-sm text-zinc-600 dark:text-zinc-400">
      {{ t("service.copied") }}
    </p>
    <p
      v-else-if="unavailable"
      data-testid="copy-field-unavailable"
      class="mt-2 font-sans text-sm text-zinc-600 dark:text-zinc-400">
      {{ t("service.copyUnavailable") }}
    </p>
  </div>
</template>
