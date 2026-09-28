<script setup lang="ts">
  /**
   * Выбор рубрики с описанием (`article-edit.md` §6). Рубрика обязательна только перед подачей
   * (журнал §25.3), поэтому пустое значение — обычное состояние черновика. Архивированной
   * рубрики в перечне нет; если она уже выбрана у материала, строка остаётся видимой.
   */
  interface Option {
    id: string
    name: string
    description?: string | null
  }

  const props = defineProps<{
    options: Option[]
    selected: Option | null
    readOnly: boolean
    label: string
    testId: string
    /** Пустой выбор допустим у черновика; перед подачей он становится недостающим полем. */
    emptyLabel: string
  }>()
  const emit = defineEmits<{ select: [id: string | null] }>()

  const visible = computed<Option[]>(() => {
    const known = props.options.some((option) => option.id === props.selected?.id)
    return known || !props.selected ? props.options : [props.selected, ...props.options]
  })

  const description = computed(() => props.selected?.description ?? null)
</script>

<template>
  <label class="grid gap-1 text-sm">
    <span class="font-semibold">{{ label }}</span>
    <select
      :value="selected?.id ?? ''"
      :disabled="readOnly"
      :data-testid="testId"
      class="bg-white px-3 py-2 ring-1 ring-zinc-300 disabled:opacity-60 dark:bg-zinc-950 dark:ring-zinc-700"
      @change="emit('select', ($event.target as HTMLSelectElement).value || null)">
      <option value="">{{ emptyLabel }}</option>
      <option v-for="option in visible" :key="option.id" :value="option.id">{{ option.name }}</option>
    </select>
    <span v-if="description" class="text-zinc-600 dark:text-zinc-300">{{ description }}</span>
  </label>
</template>
