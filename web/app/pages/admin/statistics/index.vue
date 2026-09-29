<script setup lang="ts">
  import { computed, watch } from "vue"
  import {
    parseStatisticsQueryState,
    statisticsQueryToRoute,
    type StatisticsQueryState,
    type StatisticsTab
  } from "~/composables/useAdminStatistics"

  const { t } = useI18n()
  const route = useRoute()
  const { growth, content, ai, loading, failure, retryAfter, load, exportCsv } = useAdminStatistics()

  definePageMeta({
    i18n: false,
    layout: "admin",
    middleware: ["admin", "admin-statistics"]
  })
  useHead({ meta: [{ name: "robots", content: "noindex" }] })

  const state = computed(() => parseStatisticsQueryState(route.query as Record<string, unknown>))
  const activeData = computed(() =>
    state.value.tab === "growth" ? growth.value : state.value.tab === "content" ? content.value : ai.value
  )
  const isFutureTab = computed(() => ["engagement", "finance", "ranking"].includes(state.value.tab))
  const isEmpty = computed(() => {
    if (state.value.tab === "growth") {
      return Boolean(
        growth.value &&
          growth.value.registrations === 0 &&
          growth.value.activeAccounts === 0 &&
          growth.value.enabledAuthors === 0 &&
          growth.value.authorsWithPublications === 0
      )
    }
    if (state.value.tab === "content") return Boolean(content.value && content.value.publications === 0)
    if (state.value.tab === "ai") return Boolean(ai.value && ai.value.total === 0)
    return false
  })

  const tabs: StatisticsTab[] = ["growth", "content", "engagement", "finance", "ai", "ranking"]
  const updateState = (patch: Partial<StatisticsQueryState>) => {
    const next = { ...state.value, ...patch }
    navigateTo({ path: "/admin/statistics", query: statisticsQueryToRoute(next) })
  }
  const changePeriod = (event: Event) =>
    updateState({ period: (event.target as HTMLSelectElement).value as StatisticsQueryState["period"] })
  const changeCustomDate = (field: "from" | "to", event: Event) =>
    updateState({ [field]: (event.target as HTMLInputElement).value || null })
  const changeSection = (event: Event) => updateState({ sectionId: (event.target as HTMLSelectElement).value || null })
  const changeLocale = (event: Event) => {
    const value = (event.target as HTMLSelectElement).value
    updateState({ locale: value === "ru" || value === "en" ? value : null })
  }

  const download = async () => {
    const file = await exportCsv(state.value)
    if (!file || !import.meta.client) return
    const url = URL.createObjectURL(new Blob([file.csv], { type: file.contentType }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = file.filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const formatPercent = (value: number) => `${Math.round(value * 1_000) / 10}%`
  const formatDuration = (hours: number | null) => (hours === null ? "—" : `${Math.round(hours * 10) / 10} ч`)
  const formatMinor = (minor: string) => Number(minor).toLocaleString("ru-RU")
  const retryMinutes = computed(() => Math.max(1, Math.ceil((retryAfter.value ?? 0) / 60)))

  watch(state, (next) => void load(next), { immediate: true })
</script>

<template>
  <section
    class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="statistics-title">
    <header class="mb-7 border-b border-zinc-300 pb-6 dark:border-zinc-700">
      <div class="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div class="max-w-3xl">
          <p class="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-orange-700 dark:text-orange-400">
            {{ t("admin.statisticsPage.eyebrow") }}
          </p>
          <h1
            id="statistics-title"
            class="font-serif text-4xl leading-none text-zinc-950 dark:text-zinc-50 sm:text-5xl">
            {{ t("admin.statisticsPage.title") }}
          </h1>
          <p class="mt-3 max-w-2xl font-sans text-sm leading-6 text-zinc-600 dark:text-zinc-300">
            {{ t("admin.statisticsPage.description") }}
          </p>
        </div>

        <div class="flex flex-wrap items-end gap-3">
          <label class="grid gap-1 font-sans text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {{ t("admin.statisticsPage.period") }}
            <select
              :value="state.period"
              class="min-h-10 border border-zinc-300 bg-white px-3 text-sm font-normal normal-case text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              @change="changePeriod">
              <option value="7d">7 {{ t("admin.statisticsPage.days") }}</option>
              <option value="30d">30 {{ t("admin.statisticsPage.days") }}</option>
              <option value="90d">90 {{ t("admin.statisticsPage.days") }}</option>
              <option value="custom">{{ t("admin.statisticsPage.custom") }}</option>
            </select>
          </label>
          <template v-if="state.period === 'custom'">
            <label class="grid gap-1 font-sans text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {{ t("admin.statisticsPage.from") }}
              <input
                type="date"
                :value="state.from ?? ''"
                class="min-h-10 border border-zinc-300 bg-white px-3 text-sm font-normal normal-case text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                @change="changeCustomDate('from', $event)" />
            </label>
            <label class="grid gap-1 font-sans text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {{ t("admin.statisticsPage.to") }}
              <input
                type="date"
                :value="state.to ?? ''"
                class="min-h-10 border border-zinc-300 bg-white px-3 text-sm font-normal normal-case text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                @change="changeCustomDate('to', $event)" />
            </label>
          </template>
          <button
            v-if="!isFutureTab"
            type="button"
            class="hidden min-h-10 border border-zinc-950 bg-zinc-950 px-4 font-sans text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 sm:inline-flex sm:items-center"
            @click="download">
            {{ t("admin.statisticsPage.export") }}
          </button>
        </div>
      </div>
    </header>

    <nav class="mb-7 overflow-x-auto" :aria-label="t('admin.statisticsPage.tabsLabel')">
      <div class="flex min-w-max border-b border-zinc-300 dark:border-zinc-700">
        <button
          v-for="tab in tabs"
          :key="tab"
          type="button"
          class="border-b-2 px-4 py-3 font-sans text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 motion-reduce:transition-none"
          :class="
            state.tab === tab
              ? 'border-orange-600 text-zinc-950 dark:text-zinc-50'
              : 'border-transparent text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50'
          "
          @click="updateState({ tab })">
          {{ t(`admin.statisticsPage.tabs.${tab}`) }}
        </button>
      </div>
    </nav>

    <div
      v-if="state.tab === 'content'"
      class="mb-6 flex flex-wrap gap-3 border-b border-zinc-200 pb-5 dark:border-zinc-800">
      <label class="grid gap-1 font-sans text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {{ t("admin.statisticsPage.section") }}
        <select
          data-statistics-filter="section"
          :value="state.sectionId ?? ''"
          class="min-h-10 border border-zinc-300 bg-white px-3 text-sm font-normal normal-case text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          @change="changeSection">
          <option value="">{{ t("admin.statisticsPage.allSections") }}</option>
          <option v-for="section in content?.bySection ?? []" :key="section.key" :value="section.key">
            {{ section.label }}
          </option>
        </select>
      </label>
      <label class="grid gap-1 font-sans text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {{ t("admin.statisticsPage.locale") }}
        <select
          data-statistics-filter="locale"
          :value="state.locale ?? ''"
          class="min-h-10 border border-zinc-300 bg-white px-3 text-sm font-normal normal-case text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          @change="changeLocale">
          <option value="">{{ t("admin.statisticsPage.allLocales") }}</option>
          <option value="ru">RU</option>
          <option value="en">EN</option>
        </select>
      </label>
    </div>

    <div
      v-if="retryAfter !== null"
      data-statistics-rate-limit
      class="mb-6 border border-amber-300 bg-amber-50 px-4 py-3 font-sans text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
      {{ t("admin.statisticsPage.rateLimited", { minutes: retryMinutes }) }}
    </div>

    <div v-if="loading" data-statistics-loading class="grid gap-4 md:grid-cols-4">
      <div
        v-for="index in 4"
        :key="index"
        class="h-32 animate-pulse border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800" />
    </div>

    <div
      v-else-if="failure"
      data-statistics-error
      role="alert"
      class="border border-red-300 bg-red-50 px-6 py-8 dark:border-red-900 dark:bg-red-950">
      <h2 class="font-serif text-2xl text-red-950 dark:text-red-100">{{ t("admin.statisticsPage.errorTitle") }}</h2>
      <p class="mt-2 font-sans text-sm text-red-800 dark:text-red-200">{{ t("admin.statisticsPage.errorHint") }}</p>
      <p v-if="failure.requestId" class="mt-4 font-mono text-xs text-red-700 dark:text-red-300">
        requestId: {{ failure.requestId }}
      </p>
    </div>

    <div
      v-else-if="isFutureTab"
      data-statistics-placeholder
      class="grid min-h-64 place-items-center border border-dashed border-zinc-400 px-6 text-center dark:border-zinc-600">
      <div class="max-w-xl">
        <p class="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">
          {{ t("admin.statisticsPage.futureStage") }}
        </p>
        <h2 class="mt-3 font-serif text-3xl text-zinc-950 dark:text-zinc-50">
          {{ t(`admin.statisticsPage.placeholders.${state.tab}.title`) }}
        </h2>
        <p class="mt-3 font-sans text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          {{ t(`admin.statisticsPage.placeholders.${state.tab}.description`) }}
        </p>
      </div>
    </div>

    <template v-else-if="activeData">
      <div
        v-if="isEmpty"
        data-statistics-empty
        class="mb-6 border-l-4 border-orange-500 bg-white px-5 py-4 font-sans text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
        {{ t("admin.statisticsPage.empty") }}
      </div>

      <template v-if="state.tab === 'growth' && growth">
        <div
          class="grid gap-px border border-zinc-300 bg-zinc-300 dark:border-zinc-700 dark:bg-zinc-700 sm:grid-cols-2 xl:grid-cols-4">
          <article
            v-for="metric in [
              ['registrations', growth.registrations],
              ['activeAccounts', growth.activeAccounts],
              ['enabledAuthors', growth.enabledAuthors],
              ['authorsWithPublications', growth.authorsWithPublications]
            ]"
            :key="metric[0]"
            :data-statistic="metric[0]"
            class="bg-white p-5 dark:bg-zinc-900">
            <p class="font-sans text-xs uppercase tracking-wide text-zinc-500">
              {{ t(`admin.statisticsPage.metrics.${metric[0]}`) }}
            </p>
            <p class="mt-4 font-mono text-4xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
              {{ metric[1] }}
            </p>
          </article>
        </div>

        <section class="mt-8 border-t border-zinc-300 pt-5 dark:border-zinc-700">
          <div class="mb-4 flex items-baseline justify-between gap-4">
            <h2 class="font-serif text-2xl text-zinc-950 dark:text-zinc-50">
              {{ t("admin.statisticsPage.dailyTitle") }}
            </h2>
            <p class="font-mono text-xs text-zinc-500">
              {{ growth.range.from.slice(0, 10) }} — {{ growth.range.to.slice(0, 10) }}
            </p>
          </div>
          <div
            class="grid gap-px overflow-hidden border border-zinc-300 bg-zinc-300 dark:border-zinc-700 dark:bg-zinc-700 md:grid-cols-2 xl:grid-cols-4">
            <div
              v-for="day in growth.daily"
              :key="day.date"
              :data-statistics-day="day.date"
              class="bg-zinc-50 p-4 dark:bg-zinc-950">
              <p class="font-mono text-xs text-zinc-500">{{ day.date }}</p>
              <p class="mt-3 font-sans text-sm text-zinc-800 dark:text-zinc-200">
                <strong class="font-mono text-xl">{{ day.registrations }}</strong>
                {{ t("admin.statisticsPage.shortRegistrations") }} ·
                <strong class="font-mono text-xl">{{ day.publications }}</strong>
                {{ t("admin.statisticsPage.shortPublications") }}
              </p>
            </div>
          </div>
        </section>
      </template>

      <template v-else-if="state.tab === 'content' && content">
        <div
          class="grid gap-px border border-zinc-300 bg-zinc-300 dark:border-zinc-700 dark:bg-zinc-700 sm:grid-cols-2 xl:grid-cols-4">
          <article
            v-for="metric in [
              ['publications', content.publications],
              ['drafts', content.drafts],
              ['queueSize', content.queueSize],
              ['oldestQueue', formatDuration(content.oldestQueueAgeHours)],
              ['medianDecision', formatDuration(content.medianDecisionHours)],
              ['rejectionRate', formatPercent(content.rejectionRate)],
              ['manualOverrideRate', formatPercent(content.manualOverrideRate)]
            ]"
            :key="metric[0]"
            :data-statistic="metric[0]"
            class="bg-white p-5 dark:bg-zinc-900">
            <p class="font-sans text-xs uppercase tracking-wide text-zinc-500">
              {{ t(`admin.statisticsPage.metrics.${metric[0]}`) }}
            </p>
            <p class="mt-4 font-mono text-3xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
              {{ metric[1] }}
            </p>
          </article>
        </div>

        <div class="mt-8 grid gap-8 xl:grid-cols-2">
          <section data-statistics-breakdown="locale">
            <h2 class="mb-4 font-serif text-2xl text-zinc-950 dark:text-zinc-50">
              {{ t("admin.statisticsPage.byLocale") }}
            </h2>
            <dl class="border border-zinc-300 dark:border-zinc-700">
              <div
                v-for="bucket in content.byLocale"
                :key="bucket.key"
                class="flex justify-between border-b border-zinc-200 p-3 last:border-b-0 dark:border-zinc-800">
                <dt class="font-sans uppercase text-zinc-600 dark:text-zinc-300">{{ bucket.key }}</dt>
                <dd class="font-mono font-semibold">{{ bucket.count }}</dd>
              </div>
            </dl>
          </section>

          <section data-statistics-breakdown="section">
            <h2 class="mb-4 font-serif text-2xl text-zinc-950 dark:text-zinc-50">
              {{ t("admin.statisticsPage.bySection") }}
            </h2>
            <dl class="border border-zinc-300 dark:border-zinc-700">
              <div
                v-for="bucket in content.bySection"
                :key="bucket.key"
                class="flex justify-between border-b border-zinc-200 p-3 last:border-b-0 dark:border-zinc-800">
                <dt class="font-sans text-zinc-600 dark:text-zinc-300">{{ bucket.label }}</dt>
                <dd class="font-mono font-semibold">{{ bucket.count }}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 class="mb-4 font-serif text-2xl text-zinc-950 dark:text-zinc-50">
              {{ t("admin.statisticsPage.topAuthors") }}
            </h2>
            <div class="overflow-x-auto border border-zinc-300 dark:border-zinc-700">
              <table class="w-full min-w-[42rem] border-collapse text-left font-sans text-sm">
                <thead class="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                  <tr>
                    <th class="p-3">{{ t("admin.statisticsPage.author") }}</th>
                    <th class="p-3">{{ t("admin.statisticsPage.publications") }}</th>
                    <th class="p-3">{{ t("admin.statisticsPage.reads") }}</th>
                    <th class="p-3">{{ t("admin.statisticsPage.saves") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="author in content.topAuthors"
                    :key="author.id"
                    class="border-t border-zinc-200 dark:border-zinc-800">
                    <td class="p-3">
                      <NuxtLink :to="`/admin/users/${author.id}`" class="font-semibold hover:underline">{{
                        author.name
                      }}</NuxtLink
                      ><span class="ml-2 text-zinc-500">@{{ author.handle }}</span>
                    </td>
                    <td class="p-3 font-mono">{{ author.publications }}</td>
                    <td class="p-3 font-mono">{{ author.qualifiedReads ?? "—" }}</td>
                    <td class="p-3 font-mono">{{ author.saves }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 class="mb-4 font-serif text-2xl text-zinc-950 dark:text-zinc-50">
              {{ t("admin.statisticsPage.topArticles") }}
            </h2>
            <div class="overflow-x-auto border border-zinc-300 dark:border-zinc-700">
              <table class="w-full min-w-[42rem] border-collapse text-left font-sans text-sm">
                <thead class="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                  <tr>
                    <th class="p-3">{{ t("admin.statisticsPage.article") }}</th>
                    <th class="p-3">{{ t("admin.statisticsPage.reads") }}</th>
                    <th class="p-3">{{ t("admin.statisticsPage.saves") }}</th>
                    <th class="p-3">{{ t("admin.statisticsPage.score") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="article in content.topArticles"
                    :key="article.id"
                    class="border-t border-zinc-200 dark:border-zinc-800">
                    <td class="p-3">
                      <NuxtLink :to="`/admin/articles/${article.slug}`" class="font-semibold hover:underline">{{
                        article.title
                      }}</NuxtLink
                      ><span class="block text-zinc-500">{{ article.authorName }}</span>
                    </td>
                    <td class="p-3 font-mono">{{ article.qualifiedReads ?? "—" }}</td>
                    <td class="p-3 font-mono">{{ article.saves }}</td>
                    <td class="p-3 font-mono">{{ article.totalScore ?? "—" }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </template>

      <template v-else-if="state.tab === 'ai' && ai">
        <div
          class="grid gap-px border border-zinc-300 bg-zinc-300 dark:border-zinc-700 dark:bg-zinc-700 sm:grid-cols-2 xl:grid-cols-5">
          <article
            v-for="metric in [
              ['aiTotal', ai.total],
              ['aiFailed', ai.failed],
              ['aiFailureRate', formatPercent(ai.failureRate)],
              [
                'aiDuration',
                ai.averageDurationMs === null
                  ? '—'
                  : `${Math.round(ai.averageDurationMs)} ${t('admin.statisticsPage.millisecondsShort')}`
              ],
              ['aiCost', formatMinor(ai.costMinor)]
            ]"
            :key="metric[0]"
            :data-statistic="metric[0]"
            class="bg-white p-5 dark:bg-zinc-900">
            <p class="font-sans text-xs uppercase tracking-wide text-zinc-500">
              {{ t(`admin.statisticsPage.metrics.${metric[0]}`) }}
            </p>
            <p class="mt-4 font-mono text-3xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
              {{ metric[1] }}
            </p>
          </article>
        </div>
        <div class="mt-8 grid gap-8 xl:grid-cols-2">
          <section data-statistics-breakdown="ai-kind">
            <h2 class="mb-4 font-serif text-2xl text-zinc-950 dark:text-zinc-50">
              {{ t("admin.statisticsPage.aiByKind") }}
            </h2>
            <dl class="border border-zinc-300 dark:border-zinc-700">
              <div
                v-for="bucket in ai.byKind"
                :key="bucket.key"
                class="flex justify-between border-b border-zinc-200 p-3 last:border-b-0 dark:border-zinc-800">
                <dt class="font-mono text-zinc-600 dark:text-zinc-300">{{ bucket.key }}</dt>
                <dd class="font-mono font-semibold">{{ bucket.count }}</dd>
              </div>
            </dl>
          </section>
          <section data-statistics-breakdown="ai-status">
            <h2 class="mb-4 font-serif text-2xl text-zinc-950 dark:text-zinc-50">
              {{ t("admin.statisticsPage.aiByStatus") }}
            </h2>
            <dl class="border border-zinc-300 dark:border-zinc-700">
              <div
                v-for="bucket in ai.byStatus"
                :key="bucket.key"
                class="flex justify-between border-b border-zinc-200 p-3 last:border-b-0 dark:border-zinc-800">
                <dt class="font-mono text-zinc-600 dark:text-zinc-300">{{ bucket.key }}</dt>
                <dd class="font-mono font-semibold">{{ bucket.count }}</dd>
              </div>
            </dl>
          </section>
        </div>
      </template>
    </template>
  </section>
</template>
