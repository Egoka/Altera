<script setup lang="ts">
  import EditorRevisionList from "./RevisionList.vue"

  /**
   * Боковая панель редактора (`article-edit.md` §5 зона 5): «Проверка», «Ревизии», «SEO»,
   * «Языки». Вкладка выбирается параметром `?tab=` (§3 `[ДОПУЩЕНИЕ]`), поэтому состояние панели
   * живёт в адресе, а не только в памяти страницы.
   *
   * Вкладка «Проверка» здесь показывает состояние версии и ведёт в историю решений: вердикт,
   * причины и переписка с рецензентом — страница `/me/articles/{id}/review`. Вкладка «Языки»
   * показывает существующие версии: создание второй версии — F-09 (T-046).
   */
  import type { SidePanelTab } from "~/utils/articleEditor"

  interface Revision {
    id: string
    createdAt: string
    kind: string
    size: number
  }

  interface Sibling {
    id: string
    locale: string
    status: string
  }

  const props = defineProps<{
    tab: SidePanelTab
    translationId: string
    status: string
    rejected: boolean
    readOnly: boolean
    currentRevisionId: string
    revisions: Revision[]
    siblings: Sibling[]
    seoDescription: string
    slug: string
    slugLocked: boolean
  }>()
  const emit = defineEmits<{
    tab: [tab: SidePanelTab]
    restore: [id: string]
    seoDescription: [value: string]
    slug: [value: string]
  }>()

  const { t } = useI18n()

  const tabs: SidePanelTab[] = ["review", "revisions", "seo", "languages"]
  const slugDraft = ref(props.slug)
  watch(
    () => props.slug,
    (value) => {
      slugDraft.value = value
    }
  )

  const statusKey = computed(() => (props.rejected ? "rejected" : props.status))
</script>

<template>
  <aside class="grid gap-6" data-testid="editor-panel">
    <nav class="flex flex-wrap gap-4" :aria-label="t('myArticles.editor.panel.label')">
      <button
        v-for="name in tabs"
        :key="name"
        type="button"
        :data-testid="`editor-tab-${name}`"
        class="text-sm font-semibold underline-offset-8"
        :class="name === tab ? 'text-zinc-950 underline dark:text-zinc-50' : 'text-zinc-500 dark:text-zinc-400'"
        @click="emit('tab', name)">
        {{ t(`myArticles.editor.panel.tabs.${name}`) }}
      </button>
    </nav>

    <section v-if="tab === 'review'" class="grid gap-3 text-sm" data-testid="editor-panel-review">
      <p>{{ t(`myArticles.editor.panel.review.${statusKey}`) }}</p>
      <NuxtLink
        :to="`/me/articles/${translationId}/review`"
        class="justify-self-start underline underline-offset-4"
        data-testid="editor-review-link">
        {{ t("myArticles.editor.panel.review.history") }}
      </NuxtLink>
    </section>

    <EditorRevisionList
      v-else-if="tab === 'revisions'"
      :revisions="revisions"
      :read-only="readOnly"
      :current-revision-id="currentRevisionId"
      @restore="emit('restore', $event)" />

    <section v-else-if="tab === 'seo'" class="grid gap-3 text-sm" data-testid="editor-panel-seo">
      <label class="grid gap-1">
        <span class="font-semibold">{{ t("myArticles.editor.panel.seo.description") }}</span>
        <textarea
          :value="seoDescription"
          :readonly="readOnly"
          rows="3"
          data-testid="editor-seo-description"
          class="bg-white px-3 py-2 ring-1 ring-zinc-300 dark:bg-zinc-950 dark:ring-zinc-700"
          @input="emit('seoDescription', ($event.target as HTMLTextAreaElement).value)" />
      </label>
      <label class="grid gap-1">
        <span class="font-semibold">{{ t("myArticles.editor.panel.seo.slug") }}</span>
        <input
          v-model="slugDraft"
          type="text"
          :readonly="readOnly || slugLocked"
          data-testid="editor-seo-slug"
          class="bg-white px-3 py-2 ring-1 ring-zinc-300 dark:bg-zinc-950 dark:ring-zinc-700" />
      </label>
      <p v-if="slugLocked" class="text-zinc-600 dark:text-zinc-300">
        {{ t("myArticles.editor.panel.seo.slugLocked") }}
      </p>
      <button
        v-else-if="!readOnly"
        type="button"
        data-testid="editor-seo-slug-save"
        class="justify-self-start bg-zinc-950 px-4 py-2 font-semibold text-white dark:bg-zinc-50 dark:text-zinc-950"
        @click="emit('slug', slugDraft)">
        {{ t("myArticles.editor.panel.seo.slugSave") }}
      </button>
    </section>

    <section v-else class="grid gap-2 text-sm" data-testid="editor-panel-languages">
      <ul class="grid gap-1">
        <li v-for="sibling in siblings" :key="sibling.id">
          <NuxtLink :to="`/me/articles/${sibling.id}/edit`" class="underline underline-offset-4">
            {{ t(`myArticles.editor.locales.${sibling.locale}`) }} —
            {{ t(`myArticles.editor.statusName.${sibling.status}`) }}
          </NuxtLink>
        </li>
      </ul>
      <p class="text-zinc-600 dark:text-zinc-300">{{ t("myArticles.editor.panel.languages.later") }}</p>
    </section>
  </aside>
</template>
