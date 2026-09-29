<script setup lang="ts">
  import { computed, ref, watch } from "vue"
  import type { PermanentDeleteEntity } from "~/graphql/generated/graphql"

  /**
   * Общий диалог «Удалить навсегда» (T-076, `docs/spec/10-flows/permanent-delete.md`): открывается
   * только для уже заархивированной сущности и только `owner`. Родительский экран сам проверяет
   * право и статус до показа кнопки — диалог лишь запрашивает предпросмотр и подтверждает удаление.
   */
  const props = defineProps<{
    entity: PermanentDeleteEntity
    id: string
    open: boolean
  }>()

  const emit = defineEmits<{
    "update:open": [value: boolean]
    deleted: []
  }>()

  const { t } = useI18n()
  const { preview, loading, errorCode, requestId, loadPreview, deletePermanently } = usePermanentDelete()

  const confirmedName = ref("")
  const reason = ref("")
  const submitting = ref(false)
  const previewFailed = ref(false)

  const close = () => emit("update:open", false)

  const reset = () => {
    confirmedName.value = ""
    reason.value = ""
    previewFailed.value = false
  }

  watch(
    () => props.open,
    async (isOpen) => {
      if (!isOpen) return
      reset()
      try {
        await loadPreview(props.entity, props.id)
      } catch {
        previewFailed.value = true
      }
    },
    { immediate: true }
  )

  const nameMatches = computed(() => Boolean(preview.value) && confirmedName.value === preview.value?.name)
  const canConfirm = computed(() => nameMatches.value && reason.value.trim().length > 0 && !submitting.value)

  const errorMessage = computed(() => {
    if (previewFailed.value && !preview.value) return t("admin.permanentDelete.previewError")
    switch (errorCode.value) {
      case "FORBIDDEN":
        return t("admin.permanentDelete.errorForbidden")
      case "NOT_FOUND":
        return t("admin.permanentDelete.errorNotFound")
      case "CONFLICT":
        return t("admin.permanentDelete.errorConflict")
      case "VALIDATION_ERROR":
        return t("admin.permanentDelete.errorValidation")
      case null:
        return null
      default:
        return t("admin.permanentDelete.errorGeneric")
    }
  })

  const confirm = async () => {
    if (!canConfirm.value || !preview.value) return
    submitting.value = true
    try {
      await deletePermanently(props.entity, props.id, confirmedName.value, reason.value.trim())
      close()
      emit("deleted")
    } catch {
      // Причина уже в `errorCode` composable-а: окно остаётся открытым, чтобы прочитать пояснение.
    } finally {
      submitting.value = false
    }
  }
</script>

<template>
  <dialog
    :open="open"
    data-permanent-delete-dialog
    class="fixed inset-0 z-50 m-auto w-[min(34rem,calc(100%-2rem))] border border-red-300 bg-white p-6 shadow-2xl backdrop:bg-black/40 dark:border-red-800 dark:bg-zinc-900 dark:text-zinc-50">
    <h2 class="font-serif text-2xl text-red-700 dark:text-red-400">{{ t("admin.permanentDelete.title") }}</h2>
    <p class="mt-2 font-sans text-sm text-zinc-600 dark:text-zinc-300">{{ t("admin.permanentDelete.hint") }}</p>

    <div v-if="loading && !preview" aria-busy="true" class="mt-5 grid gap-2">
      <div class="h-4 w-2/3 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      <div class="h-4 w-1/2 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>

    <template v-else-if="preview">
      <p class="mt-4 font-sans text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ preview.name }}</p>

      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p class="font-sans text-xs font-semibold uppercase tracking-widest text-red-700 dark:text-red-400">
            {{ t("admin.permanentDelete.willDelete") }}
          </p>
          <ul class="mt-1 grid gap-1 font-sans text-sm text-zinc-700 dark:text-zinc-300">
            <li v-for="item in preview.willDelete" :key="item">{{ item }}</li>
          </ul>
        </div>
        <div>
          <p class="font-sans text-xs font-semibold uppercase tracking-widest text-zinc-500">
            {{ t("admin.permanentDelete.willKeep") }}
          </p>
          <ul class="mt-1 grid gap-1 font-sans text-sm text-zinc-700 dark:text-zinc-300">
            <li v-for="item in preview.willKeep" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>

      <label class="mt-5 block font-sans text-xs font-semibold text-zinc-500" for="permanent-delete-name">
        {{ t("admin.permanentDelete.confirmLabel", { name: preview.name }) }}
      </label>
      <input
        id="permanent-delete-name"
        v-model="confirmedName"
        data-confirmed-name
        type="text"
        autocomplete="off"
        class="mt-1 min-h-11 w-full border border-zinc-300 bg-white px-3 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-950" />

      <label class="mt-4 block font-sans text-xs font-semibold text-zinc-500" for="permanent-delete-reason">
        {{ t("admin.permanentDelete.reasonLabel") }}
      </label>
      <textarea
        id="permanent-delete-reason"
        v-model="reason"
        data-permanent-delete-reason
        required
        rows="3"
        class="mt-1 w-full border border-zinc-300 bg-white px-3 py-2 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-950" />
    </template>

    <p
      v-if="errorMessage"
      role="alert"
      data-permanent-delete-error
      class="mt-4 border border-amber-400 bg-amber-50 p-3 font-sans text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      {{ errorMessage }} <span v-if="requestId" class="font-mono">requestId: {{ requestId }}</span>
    </p>

    <div class="mt-5 flex justify-end gap-2">
      <button
        type="button"
        class="min-h-10 border border-zinc-300 px-4 font-sans text-sm dark:border-zinc-700"
        @click="close">
        {{ t("admin.permanentDelete.cancel") }}
      </button>
      <button
        type="button"
        data-confirm-delete-permanently
        :disabled="!canConfirm"
        class="min-h-10 bg-red-700 px-4 font-sans text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        @click="confirm">
        {{ t("admin.permanentDelete.confirm") }}
      </button>
    </div>
  </dialog>
</template>
