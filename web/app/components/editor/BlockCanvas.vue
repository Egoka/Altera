<script setup lang="ts">
  import type { EditorBlock } from "~/utils/articleEditor"

  /**
   * Область блоков (`docs/spec/30-account/author/article-edit.md` §5 зона 4).
   *
   * Это контейнер обвязки: каталог узлов и панель вставки — отдельный проход
   * `docs/spec/95-blocks/` (ADR-0017, Q-02), поэтому здесь блок правится как текст, а его вид
   * только показывается. Идентификатор блока сохраняется: к нему привязаны заметки редактора
   * и якоря (ADR-0001 п. 3).
   */
  defineProps<{ blocks: EditorBlock[]; readOnly: boolean }>()
  const emit = defineEmits<{ update: [id: string, text: string]; add: []; remove: [id: string] }>()

  const { t } = useI18n()

  const blockLabel = (type: string) => t(`myArticles.editor.blocks.kind.${type}`)

  const onInput = (id: string, event: Event) => {
    emit("update", id, (event.target as HTMLTextAreaElement).value)
  }
</script>

<template>
  <section class="grid gap-4" data-testid="editor-body" :aria-label="t('myArticles.editor.blocks.label')">
    <article v-for="block in blocks" :key="block.id" class="grid gap-2" :data-block-type="block.type">
      <div class="flex items-baseline justify-between gap-4">
        <span class="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          {{ blockLabel(block.type) }}
        </span>
        <button
          v-if="!readOnly && blocks.length > 1"
          type="button"
          class="text-xs text-zinc-500 underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
          @click="emit('remove', block.id)">
          {{ t("myArticles.editor.blocks.remove") }}
        </button>
      </div>

      <!-- Изображение — ссылка на медиафайл: подпись, атрибуция и `alt` живут в самом файле
           (журнал §29.13), и узел документа их не переопределяет. -->
      <p
        v-if="block.type === 'figure'"
        class="bg-zinc-100 px-4 py-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
        {{ t("myArticles.editor.blocks.figure", { id: block.assetId ?? "" }) }}
      </p>
      <p
        v-else-if="block.type === 'horizontalRule'"
        class="bg-zinc-100 px-4 py-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
        {{ t("myArticles.editor.blocks.divider") }}
      </p>
      <textarea
        v-else
        :value="block.text"
        :readonly="readOnly"
        :aria-label="blockLabel(block.type)"
        rows="4"
        class="w-full resize-y bg-white px-4 py-3 text-base leading-7 text-zinc-950 outline-none ring-1 ring-zinc-300 focus:ring-2 focus:ring-orange-500 dark:bg-zinc-950 dark:text-zinc-50 dark:ring-zinc-700"
        :placeholder="t('myArticles.editor.blocks.placeholder')"
        @input="onInput(block.id, $event)" />
    </article>

    <button
      v-if="!readOnly"
      type="button"
      data-testid="editor-add-block"
      class="justify-self-start px-4 py-2 text-sm font-semibold text-orange-700 underline underline-offset-4 dark:text-orange-300"
      @click="emit('add')">
      {{ t("myArticles.editor.blocks.add") }}
    </button>
  </section>
</template>
