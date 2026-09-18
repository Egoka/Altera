<script setup lang="ts">
  withDefaults(
    defineProps<{
      loading?: boolean
      error?: boolean
    }>(),
    {
      loading: false,
      error: false
    }
  )

  const { t } = useI18n()
</script>

<template>
  <div class="relative" :aria-busy="loading">
    <div
      v-if="error"
      role="alert"
      class="mb-4 rounded border px-4 py-3 font-sans text-sm dark:border-[var(--color-error-800)] dark:bg-[var(--color-error-950)] dark:text-[var(--color-error-300)]"
      style="border-color: var(--color-error-300); background: var(--color-error-50); color: var(--color-error-700)">
      {{ t("common.loadError") }}
    </div>

    <slot />

    <div
      v-show="loading"
      class="absolute inset-0 flex items-center justify-center backdrop-blur-2xl z-10 rounded-xl"
      data-list-loading>
      <Loading type="FingerprintSpinner" :size="80" :color="'theme.500'" />
    </div>
  </div>
</template>
