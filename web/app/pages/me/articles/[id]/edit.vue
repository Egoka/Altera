<script setup lang="ts">
  import EditorBlockCanvas from "~/components/editor/BlockCanvas.vue"
  import EditorConflictDialog from "~/components/editor/ConflictDialog.vue"
  import EditorCoverUploader from "~/components/editor/CoverUploader.vue"
  import EditorNotice from "~/components/editor/Notice.vue"
  import EditorSectionPicker from "~/components/editor/SectionPicker.vue"
  import EditorSidePanel from "~/components/editor/SidePanel.vue"
  import EditorTagPicker from "~/components/editor/TagPicker.vue"
  import { editorNotice, readTab, type SidePanelTab } from "~/utils/articleEditor"

  /**
   * Редактор языковой версии (`docs/spec/30-account/author/article-edit.md`).
   *
   * Страница только собирает зоны §5 и передаёт действия в `useArticleEditor`: решения о
   * сохранении, конфликте и подаче живут там, а состояния баннера и готовности подачи — в
   * `utils/articleEditor`.
   */
  definePageMeta({
    i18n: false,
    layout: "auth",
    requiresAuth: true
  })

  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const translationId = String(route.params.id)

  const editor = useArticleEditor(translationId)

  // Редактор — закрытая страница: `noindex, nofollow`, без canonical и hreflang (§10).
  useHead({
    title: () =>
      `${editor.form.value.title || t("myArticles.editor.untitled")} — ${t("myArticles.editor.pageTitle")} — Altera`,
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })

  const tab = computed<SidePanelTab>(() => readTab(route.query.tab))
  const selectTab = (next: SidePanelTab) => {
    void router.replace({ query: { ...route.query, tab: next } })
    if (next === "revisions") void editor.loadRevisions()
  }

  /**
   * Первый ответ сервер собирает уже с данными: иначе 404 и 500 не были бы кодом ответа
   * навигации (§8, строки «Не найдено» и «Ошибка данных»). Переход внутри приложения страницу
   * не задерживает — пока версия едет, показан скелет (строка «Загрузка»).
   *
   * Оба запроса начинаются сразу: `useGraphQL` на сервере читает событие запроса в момент
   * вызова, и второй вызов после `await` остался бы без контекста Nuxt.
   */
  const { data: loaded, error: loadError } = await useAsyncData(
    `editor-${translationId}`,
    () => Promise.all([editor.load(), editor.loadTaxonomy()]).then(([outcome]) => outcome),
    { lazy: import.meta.client }
  )

  const applyLoadOutcome = () => {
    if (loadError.value) {
      if (import.meta.server) throw loadError.value
      return showError(loadError.value)
    }
    const redirect = loaded.value?.redirect
    if (redirect) return navigateTo(redirect, { redirectCode: 302, replace: true })
  }

  if (import.meta.server) applyLoadOutcome()
  else watch([loaded, loadError], () => void applyLoadOutcome(), { immediate: true })

  const notice = computed(() => editorNotice(editor.readOnlyReason.value, { offline: editor.offline.value }))
  const cover = computed(() => editor.translation.value?.article.cover ?? null)
  const article = computed(() => editor.translation.value?.article ?? null)
  const previewPath = computed(() => {
    const sectionSlug = article.value?.section?.slug
    const slug = editor.translation.value?.seo.slug
    return sectionSlug && slug ? `/${sectionSlug}/${slug}?preview=1` : null
  })

  const saveIndicator = computed(() => {
    if (editor.saveState.value === "saving") return t("myArticles.editor.save.saving")
    if (editor.saveState.value === "conflict") return t("myArticles.editor.save.conflict")
    if (editor.saveState.value === "error") return t("myArticles.editor.save.error")
    if (editor.savedAt.value) return t("myArticles.editor.save.saved")
    if (editor.dirty.value) return t("myArticles.editor.save.pending")
    return t("myArticles.editor.save.idle")
  })

  // Обработчики полей живут в скрипте: две инструкции в выражении шаблона Vue не разбирает.
  const setTitle = (event: Event) => {
    editor.form.value.title = (event.target as HTMLInputElement).value
    editor.touch()
  }
  const setLead = (event: Event) => {
    editor.form.value.lead = (event.target as HTMLTextAreaElement).value
    editor.touch()
  }
  const setSeoDescription = (value: string) => {
    editor.form.value.seoDescription = value
    editor.touch()
  }

  const onTaxonomy = (next: { sectionId?: string | null; formatId?: string | null; tagIds?: string[] }) => {
    void editor.saveTaxonomy({
      sectionId: next.sectionId !== undefined ? next.sectionId : (article.value?.section?.id ?? null),
      formatId: next.formatId !== undefined ? next.formatId : (article.value?.format?.id ?? null),
      tagIds: next.tagIds ?? (article.value?.tags ?? []).map((tag) => tag.id)
    })
  }

  const markOnline = () => {
    editor.offline.value = false
  }
  const markOffline = () => {
    editor.offline.value = true
  }

  onMounted(() => {
    editor.startAutosave()
    editor.offline.value = typeof navigator !== "undefined" && navigator.onLine === false
    window.addEventListener("online", markOnline)
    window.addEventListener("offline", markOffline)
  })
  onBeforeUnmount(() => {
    editor.stopAutosave()
    window.removeEventListener("online", markOnline)
    window.removeEventListener("offline", markOffline)
  })
</script>

<template>
  <main v-if="editor.translation.value" class="min-h-full bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
    <!-- Шапка сайта закреплена поверх страницы (`components/app/header.vue`), поэтому верхняя
         панель редактора отступает от неё воздухом, а не прячется под ней. -->
    <div class="mx-auto grid max-w-7xl gap-8 px-4 pb-8 pt-24 sm:px-6 lg:px-8">
      <!-- Зона 1: верхняя панель. -->
      <header class="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div class="grid gap-2">
          <NuxtLink to="/me/articles" class="text-sm underline underline-offset-4">
            {{ t("myArticles.editor.back") }}
          </NuxtLink>
          <p class="flex flex-wrap items-center gap-3 text-sm">
            <span data-testid="editor-status" class="bg-zinc-100 px-3 py-1 font-semibold dark:bg-zinc-900">
              {{
                t(
                  `myArticles.editor.statusName.${editor.translation.value.rejected ? "rejected" : editor.translation.value.status}`
                )
              }}
            </span>
            <span data-testid="editor-save-state" class="text-zinc-600 dark:text-zinc-300">{{ saveIndicator }}</span>
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <NuxtLink
            v-if="previewPath"
            :to="previewPath"
            data-testid="editor-preview"
            class="px-4 py-2 text-sm font-semibold underline underline-offset-4">
            {{ t("myArticles.editor.preview") }}
          </NuxtLink>
          <button
            v-if="!editor.readOnly.value"
            type="button"
            data-testid="editor-save"
            class="px-4 py-2 text-sm font-semibold underline underline-offset-4"
            @click="editor.save('manual')">
            {{ t("myArticles.editor.saveNow") }}
          </button>
          <button
            v-if="editor.action.value === 'submit'"
            type="button"
            data-testid="editor-submit"
            :disabled="!editor.canSubmit.value"
            class="bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950"
            @click="editor.submit()">
            {{ t("myArticles.editor.submit") }}
          </button>
          <button
            v-else-if="editor.action.value === 'withdraw'"
            type="button"
            data-testid="editor-withdraw"
            class="bg-zinc-950 px-4 py-2 text-sm font-semibold text-white dark:bg-zinc-50 dark:text-zinc-950"
            @click="editor.withdraw()">
            {{ t("myArticles.editor.withdraw") }}
          </button>
        </div>
      </header>

      <!-- Зона 2: баннер состояния. -->
      <EditorNotice v-if="notice" :tone="notice.tone" :test-id="notice.testId">
        {{ t(`myArticles.editor.notice.${notice.key}`) }}
        <!-- Истёкший план ведёт к тарифам прямо из баннера (§8 строка «Ограничение плана»). -->
        <NuxtLink v-if="notice.key === 'plan'" to="/pricing" class="underline underline-offset-4">
          {{ t("myArticles.editor.notice.planLink") }}
        </NuxtLink>
      </EditorNotice>

      <EditorConflictDialog
        :open="editor.saveState.value === 'conflict'"
        @fresh="editor.reloadFresh()"
        @copy="editor.saveAsCopy()" />

      <p v-if="editor.saveErrorKey.value" data-testid="editor-error" class="text-sm text-red-700 dark:text-red-300">
        {{ t(`myArticles.editor.errors.${editor.saveErrorKey.value}`) }}
      </p>

      <p
        v-if="editor.missing.value.length"
        data-testid="editor-missing"
        class="text-sm text-zinc-600 dark:text-zinc-300">
        {{
          t("myArticles.editor.missing", {
            fields: editor.missing.value.map((field) => t(`myArticles.editor.fields.${field}`)).join(", ")
          })
        }}
      </p>

      <div class="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="grid gap-8">
          <!-- Зона 3: метаданные. -->
          <section class="grid gap-4" data-testid="editor-meta">
            <label class="grid gap-1">
              <span class="text-sm font-semibold">{{ t("myArticles.editor.fields.title") }}</span>
              <input
                :value="editor.form.value.title"
                type="text"
                :readonly="editor.readOnly.value"
                data-testid="editor-title"
                class="bg-white px-4 py-3 text-2xl font-semibold ring-1 ring-zinc-300 dark:bg-zinc-950 dark:ring-zinc-700"
                :placeholder="t('myArticles.editor.placeholders.title')"
                @input="setTitle" />
            </label>

            <label class="grid gap-1">
              <span class="text-sm font-semibold">{{ t("myArticles.editor.fields.lead") }}</span>
              <textarea
                :value="editor.form.value.lead"
                rows="2"
                :readonly="editor.readOnly.value"
                data-testid="editor-lead"
                class="bg-white px-4 py-3 text-base ring-1 ring-zinc-300 dark:bg-zinc-950 dark:ring-zinc-700"
                :placeholder="t('myArticles.editor.placeholders.lead')"
                @input="setLead" />
            </label>

            <div class="grid gap-4 sm:grid-cols-2">
              <EditorSectionPicker
                :options="editor.taxonomy.value.sections"
                :selected="article?.section ?? null"
                :read-only="editor.readOnly.value"
                :label="t('myArticles.editor.fields.section')"
                :empty-label="t('myArticles.editor.sectionEmpty')"
                test-id="editor-section"
                @select="onTaxonomy({ sectionId: $event })" />
              <EditorSectionPicker
                :options="editor.taxonomy.value.formats"
                :selected="article?.format ?? null"
                :read-only="editor.readOnly.value"
                :label="t('myArticles.editor.fields.format')"
                :empty-label="t('myArticles.editor.formatEmpty')"
                test-id="editor-format"
                @select="onTaxonomy({ formatId: $event })" />
            </div>

            <EditorTagPicker
              :tags="article?.tags ?? []"
              :read-only="editor.readOnly.value"
              @change="onTaxonomy({ tagIds: $event })" />

            <EditorCoverUploader
              :cover="cover"
              :busy="editor.coverBusy.value"
              :read-only="editor.readOnly.value"
              :error-key="editor.coverErrorKey.value"
              @upload="(file, license, attribution) => editor.uploadCover(file, license, attribution)"
              @focal="editor.setCover(cover?.assetId ?? null, $event)"
              @remove="editor.setCover(null, null)" />
          </section>

          <!-- Зона 4: область блоков. -->
          <EditorBlockCanvas
            :blocks="editor.blocks.value"
            :read-only="editor.readOnly.value"
            @update="editor.setBlockText"
            @add="editor.addBlock"
            @remove="editor.removeBlock" />
        </div>

        <!-- Зона 5: боковая панель. -->
        <EditorSidePanel
          :tab="tab"
          :translation-id="translationId"
          :status="editor.translation.value.status"
          :rejected="editor.translation.value.rejected"
          :read-only="editor.readOnly.value"
          :current-revision-id="editor.baseRevisionId.value"
          :revisions="editor.revisions.value"
          :siblings="editor.translation.value.article.translations"
          :seo-description="editor.form.value.seoDescription"
          :slug="editor.translation.value.seo.slug"
          :slug-locked="editor.translation.value.seo.slugLocked"
          @tab="selectTab"
          @restore="editor.restore"
          @seo-description="setSeoDescription"
          @slug="editor.saveSlug" />
      </div>
    </div>

    <!-- Зона 6: липкие действия на телефоне. -->
    <div
      v-if="!editor.readOnly.value"
      class="sticky bottom-0 flex gap-3 bg-white/95 px-4 py-3 shadow-[0_-1px_0_rgba(0,0,0,0.06)] dark:bg-zinc-950/95 lg:hidden">
      <button
        type="button"
        data-testid="editor-save-mobile"
        class="flex-1 px-4 py-2 text-sm font-semibold underline underline-offset-4"
        @click="editor.save('manual')">
        {{ t("myArticles.editor.saveNow") }}
      </button>
      <button
        type="button"
        data-testid="editor-submit-mobile"
        :disabled="!editor.canSubmit.value"
        class="flex-1 bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950"
        @click="editor.submit()">
        {{ t("myArticles.editor.submit") }}
      </button>
    </div>
  </main>

  <!-- Строка «Загрузка» §8: скелет редактора до ответа `translation`. -->
  <main v-else class="mx-auto max-w-7xl px-4 py-10" aria-live="polite" data-testid="editor-loading">
    <p>{{ t("common.loading") }}</p>
  </main>
</template>
