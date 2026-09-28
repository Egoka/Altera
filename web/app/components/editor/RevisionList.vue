<script setup lang="ts">
  /**
   * Снимки версии (`article-edit.md` §5 зона 5, §7 действие «восстановить»). Каждое сохранение —
   * снимок (журнал §6.7, ADR-0007); восстановление заводит новую ревизию, а не переписывает
   * историю.
   */
  interface Revision {
    id: string
    createdAt: string
    kind: string
    size: number
  }

  defineProps<{ revisions: Revision[]; readOnly: boolean; currentRevisionId: string }>()
  const emit = defineEmits<{ restore: [id: string] }>()

  const { t } = useI18n()

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Moscow"
    }).format(new Date(value))
</script>

<template>
  <div class="grid gap-3" data-testid="editor-revisions">
    <p v-if="revisions.length === 0" class="text-sm text-zinc-600 dark:text-zinc-300">
      {{ t("myArticles.editor.revisions.empty") }}
    </p>
    <ul v-else class="grid gap-3">
      <li v-for="revision in revisions" :key="revision.id" class="grid gap-1 text-sm">
        <span class="font-semibold">{{ formatDate(revision.createdAt) }}</span>
        <span class="text-zinc-600 dark:text-zinc-300">
          {{ t(`myArticles.editor.revisions.kind.${revision.kind}`) }} ·
          {{ t("myArticles.editor.revisions.size", { size: revision.size }) }}
        </span>
        <button
          v-if="!readOnly && revision.id !== currentRevisionId"
          type="button"
          class="justify-self-start text-orange-700 underline underline-offset-4 dark:text-orange-300"
          @click="emit('restore', revision.id)">
          {{ t("myArticles.editor.revisions.restore") }}
        </button>
      </li>
    </ul>
  </div>
</template>
