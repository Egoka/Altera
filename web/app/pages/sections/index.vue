<script setup lang="ts">
  import { GET_SECTION_CATALOG } from "~/query"
  import { errorRequestId, requestLocale, throwOnFeedError } from "~/utils/publicFeed"

  /**
   * Список рубрик (`docs/spec/20-public/sections-index.md`): карточки рубрик в ручном
   * порядке из админки, с описанием, счётчиком и превью последних материалов.
   * Пустые и архивированные рубрики сюда не приходят (журнал §20.9) — их прячет сервер.
   * Пагинации нет: рубрик единицы (ADR-0005).
   */
  definePageMeta({ layout: "default" })

  const { locale, t } = useI18n()

  const {
    data: sections,
    error,
    status
  } = await useAsyncData(
    () => `section-catalog:${locale.value}`,
    async () =>
      throwOnFeedError(await useGraphQL(GET_SECTION_CATALOG, { locale: requestLocale(locale.value) })).sectionCatalog,
    { watch: [locale] }
  )

  const requestId = computed(() => errorRequestId(error.value))

  useHead(() => ({ title: t("sectionsIndex.title") }))
</script>

<template>
  <div class="pb-16">
    <ReadingPageHeader
      :title="t('sectionsIndex.title')"
      :count="sections?.length ? t('sectionsIndex.count', { count: sections.length }) : undefined"
      :description="t('sectionsIndex.description')" />

    <ReadingErrorState v-if="error" :request-id="requestId" />
    <ReadingLoadingSkeleton v-else-if="status === 'pending'" :cards="6" />

    <div v-else-if="sections?.length" class="grid grid-cols-1 gap-x-12 gap-y-16 md:grid-cols-2 lg:grid-cols-3">
      <ReadingSectionCard
        v-for="section in sections"
        :key="section.slug"
        :section="section"
        :count-label="t('sectionsIndex.articleCount', { count: section.articleCount })" />
    </div>

    <!-- Рубрика становится публичной с первой публикацией, поэтому пустой каталог
         означает, что издание ещё ничего не опубликовало. -->
    <ReadingEmptyState
      v-else
      :title="t('sectionsIndex.emptyTitle')"
      :description="t('sectionsIndex.emptyDescription')"
      :action-label="t('sectionsIndex.emptyAction')"
      action-to="/pricing" />
  </div>
</template>
