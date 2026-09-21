<script setup lang="ts">
  /**
   * Подтверждение необратимого действия (`docs/spec/30-account/reader/sessions.md` §6).
   * Переиспользуется удалением аккаунта и архивом, поэтому текст целиком приходит снаружи,
   * а компонент отвечает только за развилку «подтвердить / отменить».
   */
  const props = defineProps<{
    open: boolean
    title: string
    body?: string | null
    confirmLabel: string
    cancelLabel: string
    busy?: boolean
    testid?: string
  }>()

  const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <AppDialog
    :model-value="props.open"
    close-button
    class="max-w-md"
    @update:model-value="(value: boolean) => !value && emit('cancel')">
    <!-- Диалог телепортируется в `body`, поэтому отметка теста ставится на содержимое,
         а не на корневой компонент: сквозной атрибут туда не доходит. -->
    <div
      class="flex flex-col gap-6"
      role="alertdialog"
      aria-modal="true"
      :data-testid="props.testid ?? 'confirm-dialog'">
      <h2 class="font-serif text-xl text-zinc-950 dark:text-zinc-50" data-testid="confirm-dialog-title">
        {{ props.title }}
      </h2>
      <p v-if="props.body" class="font-sans text-base text-zinc-700 dark:text-zinc-300">{{ props.body }}</p>

      <div class="flex flex-wrap items-center gap-6">
        <button
          type="button"
          data-testid="confirm-dialog-confirm"
          :disabled="props.busy"
          class="border-b border-orange-600 pb-0.5 font-sans text-sm text-zinc-950 transition-colors hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none dark:text-zinc-50"
          @click="emit('confirm')">
          {{ props.confirmLabel }}
        </button>
        <button
          type="button"
          data-testid="confirm-dialog-cancel"
          :disabled="props.busy"
          class="border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 transition-colors hover:border-orange-600 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none dark:text-zinc-400"
          @click="emit('cancel')">
          {{ props.cancelLabel }}
        </button>
      </div>
    </div>
  </AppDialog>
</template>
