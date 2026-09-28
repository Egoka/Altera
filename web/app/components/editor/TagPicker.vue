<script setup lang="ts">
  import { CREATE_TAG, TAG_AUTOCOMPLETE } from "~/query"

  /**
   * Теги материала (`article-edit.md` §6): автодополнение по существующим и создание нового на
   * месте. Тег создаёт автор сразу, без проверки (§26.3, матрица #85); переименование, слияние
   * и архив остаются за администратором.
   */
  interface Tag {
    id: string
    name: string
    slug: string
  }

  const props = defineProps<{ tags: Tag[]; readOnly: boolean }>()
  const emit = defineEmits<{ change: [tagIds: string[]] }>()

  const { t } = useI18n()

  const query = ref("")
  const suggestions = ref<Tag[]>([])
  const busy = ref(false)

  const search = async () => {
    const value = query.value.trim()
    if (value.length === 0) {
      suggestions.value = []
      return
    }
    const response = await useGraphQL(TAG_AUTOCOMPLETE, { q: value, limit: 8 })
    const known = new Set(props.tags.map((tag) => tag.id))
    suggestions.value = (response.data?.tagAutocomplete ?? []).filter((tag) => !known.has(tag.id))
  }

  const add = (tag: Tag) => {
    query.value = ""
    suggestions.value = []
    emit("change", [...props.tags.map((existing) => existing.id), tag.id])
  }

  const remove = (id: string) => {
    emit(
      "change",
      props.tags.filter((tag) => tag.id !== id).map((tag) => tag.id)
    )
  }

  const create = async () => {
    const name = query.value.trim()
    if (!name || busy.value) return
    busy.value = true
    try {
      const response = await useGraphQL(CREATE_TAG, { input: { name } })
      const created = response.data?.createTag
      if (created) add(created as Tag)
    } finally {
      busy.value = false
    }
  }
</script>

<template>
  <div class="grid gap-2 text-sm" data-testid="editor-tags">
    <span class="font-semibold">{{ t("myArticles.editor.tags.label") }}</span>

    <ul v-if="tags.length" class="flex flex-wrap gap-2">
      <li v-for="tag in tags" :key="tag.id" class="flex items-center gap-2 bg-zinc-100 px-3 py-1 dark:bg-zinc-900">
        <span>{{ tag.name }}</span>
        <button
          v-if="!readOnly"
          type="button"
          :aria-label="t('myArticles.editor.tags.remove', { name: tag.name })"
          class="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          @click="remove(tag.id)">
          ×
        </button>
      </li>
    </ul>

    <template v-if="!readOnly">
      <input
        v-model="query"
        type="text"
        data-testid="editor-tag-query"
        :placeholder="t('myArticles.editor.tags.placeholder')"
        class="bg-white px-3 py-2 ring-1 ring-zinc-300 dark:bg-zinc-950 dark:ring-zinc-700"
        @input="search" />
      <ul v-if="suggestions.length" class="grid gap-1">
        <li v-for="tag in suggestions" :key="tag.id">
          <button type="button" class="underline underline-offset-4" @click="add(tag)">{{ tag.name }}</button>
        </li>
      </ul>
      <button
        v-if="query.trim()"
        type="button"
        data-testid="editor-tag-create"
        class="justify-self-start text-orange-700 underline underline-offset-4 dark:text-orange-300"
        @click="create">
        {{ t("myArticles.editor.tags.create", { name: query.trim() }) }}
      </button>
    </template>
  </div>
</template>
