<script setup lang="ts">
  /**
   * Конфликт версий (`article-edit.md` §8, ADR-0033): одновременного редактирования нет, и когда
   * вторая вкладка сохранила свою правку раньше, редактор предлагает открыть свежую версию или
   * сохранить свой текст копией — новой ревизией поверх свежей.
   */
  defineProps<{ open: boolean }>()
  const emit = defineEmits<{ fresh: []; copy: [] }>()

  const { t } = useI18n()
</script>

<template>
  <section
    v-if="open"
    role="alertdialog"
    aria-modal="false"
    data-testid="editor-conflict"
    class="grid gap-3 bg-amber-50 px-5 py-4 text-sm text-zinc-900 dark:bg-amber-950/40 dark:text-zinc-100">
    <p class="font-semibold">{{ t("myArticles.editor.conflict.title") }}</p>
    <p>{{ t("myArticles.editor.conflict.description") }}</p>
    <div class="flex flex-wrap gap-3">
      <button
        type="button"
        data-testid="editor-conflict-fresh"
        class="bg-zinc-950 px-4 py-2 font-semibold text-white dark:bg-zinc-50 dark:text-zinc-950"
        @click="emit('fresh')">
        {{ t("myArticles.editor.conflict.fresh") }}
      </button>
      <button
        type="button"
        data-testid="editor-conflict-copy"
        class="px-4 py-2 font-semibold underline underline-offset-4"
        @click="emit('copy')">
        {{ t("myArticles.editor.conflict.copy") }}
      </button>
    </div>
  </section>
</template>
