<script setup lang="ts">
  import { computed } from "vue"

  const props = defineProps<{
    status: string | null
    reeditUntil: string | null
    editPath: string | null
  }>()

  const { locale, t } = useI18n()
  const statusLabel = computed(() => (props.status ? t(`article.status.${props.status}`) : ""))
  const deadline = computed(() => {
    if (!props.reeditUntil) return null
    return new Intl.DateTimeFormat(locale.value, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC"
    }).format(new Date(props.reeditUntil))
  })
</script>

<template>
  <aside
    data-testid="preview-banner"
    class="border-y border-orange-300 bg-orange-50 text-zinc-950 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-50"
    :aria-label="t('article.preview')">
    <div class="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <strong class="font-sans text-xs uppercase tracking-[0.18em] text-orange-800 dark:text-orange-300">
          {{ t("article.preview") }}
        </strong>
        <span v-if="status" class="font-sans text-sm text-zinc-700 dark:text-zinc-300">
          {{ t("article.previewStatus", { status: statusLabel }) }}
        </span>
        <span v-if="deadline" class="font-sans text-sm font-medium">
          {{ t("article.reeditUntil", { time: deadline }) }}
        </span>
      </div>
      <NuxtLink
        v-if="editPath"
        :to="editPath"
        class="font-sans text-sm font-semibold text-orange-900 underline decoration-orange-400 underline-offset-4 hover:decoration-orange-800 dark:text-orange-200">
        {{ t("article.openEditor") }}
      </NuxtLink>
    </div>
  </aside>
</template>
