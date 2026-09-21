<script setup lang="ts">
  /**
   * Поле одноразового кода (`email-change.md` §6). На телефоне поле крупное и с числовой
   * клавиатурой (§9); `autocomplete="one-time-code"` позволяет системе подставить код из письма.
   */
  const props = defineProps<{ modelValue: string; id: string; disabled?: boolean; invalid?: boolean }>()
  const emit = defineEmits<{ "update:modelValue": [string] }>()

  // Код цифровой: всё остальное отсекается сразу, иначе вставка из письма приносит пробелы.
  const onInput = (event: Event) => {
    const input = event.target as HTMLInputElement
    const digits = input.value.replace(/\D/g, "").slice(0, 6)
    if (input.value !== digits) input.value = digits
    emit("update:modelValue", digits)
  }
</script>

<template>
  <input
    :id="props.id"
    :value="props.modelValue"
    type="text"
    name="code"
    inputmode="numeric"
    autocomplete="one-time-code"
    maxlength="6"
    :disabled="props.disabled"
    :aria-invalid="props.invalid || undefined"
    data-testid="email-change-code"
    class="w-full border border-zinc-300 bg-white px-3 py-3 text-center font-mono text-2xl tracking-[0.5em] text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:opacity-60 sm:w-56 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
    @input="onInput" />
</template>
