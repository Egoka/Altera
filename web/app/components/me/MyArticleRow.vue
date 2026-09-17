<script setup lang="ts">
  import type { GetMyArticlesQuery } from "~/graphql/generated/graphql"

  type MyArticle = GetMyArticlesQuery["myArticles"]["items"][number]
  type Translation = MyArticle["translations"][number]

  const props = defineProps<{ article: MyArticle }>()
  const { t } = useI18n()

  const translation = computed<Translation>(() => props.article.translations[0]!)
  const isRejected = computed(() => translation.value.rejected)
  const effectiveStatus = computed(() => (props.article.status === "archived" ? "archived" : translation.value.status))

  const statusLabel = computed(() => {
    if (isRejected.value) return t("myArticles.row.status.rejected")
    switch (effectiveStatus.value) {
      case "draft":
        return t("myArticles.row.status.draft")
      case "ai_check":
        return t("myArticles.row.status.aiCheck")
      case "review":
      case "in_review":
        return t("myArticles.row.status.review")
      case "rework":
        return t("myArticles.row.status.rework")
      case "published":
        return t("myArticles.row.status.published")
      case "archived":
        return t("myArticles.row.status.archived")
      default:
        return effectiveStatus.value
    }
  })

  const statusClass = computed(() => {
    if (isRejected.value) return "bg-red-50 text-red-800 ring-red-600/15 dark:bg-red-950 dark:text-red-200"
    switch (effectiveStatus.value) {
      case "draft":
        return "bg-zinc-100 text-zinc-700 ring-zinc-500/15 dark:bg-zinc-800 dark:text-zinc-200"
      case "ai_check":
      case "review":
      case "in_review":
        return "bg-blue-50 text-blue-800 ring-blue-600/15 dark:bg-blue-950 dark:text-blue-200"
      case "rework":
        return "bg-amber-50 text-amber-900 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-200"
      case "published":
        return "bg-emerald-50 text-emerald-800 ring-emerald-600/15 dark:bg-emerald-950 dark:text-emerald-200"
      case "archived":
        return "bg-violet-50 text-violet-800 ring-violet-600/15 dark:bg-violet-950 dark:text-violet-200"
      default:
        return "bg-zinc-100 text-zinc-700 ring-zinc-500/15 dark:bg-zinc-800 dark:text-zinc-200"
    }
  })

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Moscow"
    }).format(new Date(value))

  const stateDetail = computed(() => {
    if (isRejected.value) return t("myArticles.row.rejectedDetail")
    if (effectiveStatus.value === "rework") return t("myArticles.row.reworkDetail")
    if (effectiveStatus.value === "archived") {
      return props.article.archivedBy === "self" ? t("myArticles.row.archivedSelf") : t("myArticles.row.archivedStaff")
    }
    if (effectiveStatus.value === "published" && translation.value.reeditUntil) {
      return t("myArticles.row.reeditUntil", { date: formatDate(translation.value.reeditUntil) })
    }
    return null
  })

  const updatedAt = computed(() => formatDate(translation.value.updatedAt))
  const detailPath = computed(() => `/me/articles/${translation.value.slug}`)
  const editPath = computed(() => `${detailPath.value}/edit`)
</script>

<template>
  <article
    :aria-label="translation.title"
    class="group grid gap-5 border-t border-zinc-200 py-6 first:border-t-0 dark:border-zinc-800 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
    <div class="min-w-0">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <Badge :class="['ring-1 ring-inset', statusClass]">
          {{ statusLabel }}
        </Badge>
        <span class="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
          {{ translation.locale }}
        </span>
        <span v-if="article.translations.length > 1" class="text-xs text-zinc-500">
          {{ t("myArticles.row.versionCount", { count: article.translations.length - 1 }) }}
        </span>
      </div>

      <h2 class="text-xl font-semibold leading-tight text-zinc-950 dark:text-zinc-50 sm:text-2xl">
        {{ translation.title }}
      </h2>

      <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
        <span>{{ t("myArticles.row.updated", { date: updatedAt }) }}</span>
        <span v-if="article.section" aria-hidden="true">·</span>
        <span v-if="article.section">{{ article.section.name }}</span>
        <span v-if="article.format" aria-hidden="true">·</span>
        <span v-if="article.format">{{ article.format.name }}</span>
      </div>

      <p v-if="stateDetail" class="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">
        {{ stateDetail }}
      </p>
    </div>

    <div class="flex items-center gap-3 md:justify-end">
      <NuxtLink
        v-if="isRejected"
        :to="detailPath"
        class="inline-flex min-h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-semibold text-zinc-900 transition hover:border-orange-500 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:border-zinc-700 dark:text-zinc-100">
        {{ t("myArticles.row.openReadOnly") }}
      </NuxtLink>
      <NuxtLink
        v-else-if="effectiveStatus !== 'archived'"
        :to="editPath"
        class="inline-flex min-h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-orange-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-orange-400">
        {{ t("myArticles.row.edit") }}
      </NuxtLink>
      <NuxtLink
        v-else
        :to="detailPath"
        class="inline-flex min-h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-semibold text-zinc-900 transition hover:border-orange-500 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:border-zinc-700 dark:text-zinc-100">
        {{ t("myArticles.row.open") }}
      </NuxtLink>
    </div>
  </article>
</template>
