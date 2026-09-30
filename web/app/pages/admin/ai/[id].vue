<script setup lang="ts">
  import { watch } from "vue"

  const { t } = useI18n()
  const route = useRoute()
  const { card, loading, cardFailure, openCard } = useAdminAiProcesses()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-ai"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  watch(
    () => String(route.params.id),
    (id) => openCard(id),
    { immediate: true }
  )

  const formatDate = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "medium" }) : "—"
</script>

<template>
  <section class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8">
    <NuxtLink to="/admin/ai" class="font-sans text-sm underline underline-offset-4">{{
      t("admin.aiProcesses.back")
    }}</NuxtLink>

    <div v-if="loading" data-ai-card-state="loading" aria-busy="true" class="mt-6 space-y-3">
      <div
        v-for="row in 5"
        :key="row"
        class="h-12 animate-pulse bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800"></div>
    </div>

    <div
      v-else-if="cardFailure"
      data-ai-card-state="error"
      role="alert"
      class="mt-6 border border-red-300 bg-white px-5 py-8 text-center dark:border-red-900 dark:bg-zinc-900">
      <p>{{ t("admin.aiProcesses.loadError") }}</p>
      <p v-if="cardFailure.requestId" class="mt-2 font-mono text-xs text-zinc-500">
        requestId: {{ cardFailure.requestId }}
      </p>
    </div>

    <article v-else-if="card" :data-ai-card="card.id" class="mt-6">
      <header class="border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <p class="font-mono text-xs uppercase tracking-[0.22em] text-orange-700 dark:text-orange-400">
          {{ t(`admin.aiProcesses.kind.${card.kind}`) }}
        </p>
        <h1 class="mt-2 break-all font-serif text-3xl text-zinc-950 dark:text-zinc-50">{{ card.id }}</h1>
        <p data-ai-readonly-note class="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          {{ t("admin.aiProcesses.readOnly") }}
        </p>
      </header>

      <div class="mt-6 grid gap-px bg-zinc-300 dark:bg-zinc-700 sm:grid-cols-2 lg:grid-cols-3">
        <section class="bg-white p-5 dark:bg-zinc-900">
          <h2 class="text-xs uppercase tracking-wide text-zinc-500">{{ t("admin.aiProcesses.columns.status") }}</h2>
          <p class="mt-2">{{ t(`admin.aiProcesses.status.${card.status}`) }}</p>
        </section>
        <section class="bg-white p-5 dark:bg-zinc-900">
          <h2 class="text-xs uppercase tracking-wide text-zinc-500">{{ t("admin.aiProcesses.columns.verdict") }}</h2>
          <p class="mt-2">{{ card.verdict ?? "—" }}</p>
        </section>
        <section class="bg-white p-5 dark:bg-zinc-900">
          <h2 class="text-xs uppercase tracking-wide text-zinc-500">{{ t("admin.aiProcesses.card.providerError") }}</h2>
          <p class="mt-2 font-mono text-sm">{{ card.providerErrorClass ?? "—" }}</p>
        </section>
        <section class="bg-white p-5 dark:bg-zinc-900">
          <h2 class="text-xs uppercase tracking-wide text-zinc-500">{{ t("admin.aiProcesses.card.model") }}</h2>
          <p class="mt-2 font-mono text-sm">{{ card.model ?? "—" }}</p>
        </section>
        <section class="bg-white p-5 dark:bg-zinc-900">
          <h2 class="text-xs uppercase tracking-wide text-zinc-500">{{ t("admin.aiProcesses.card.prompt") }}</h2>
          <p class="mt-2 font-mono text-sm">{{ card.promptVersion ?? "—" }}</p>
        </section>
        <section class="bg-white p-5 dark:bg-zinc-900">
          <h2 class="text-xs uppercase tracking-wide text-zinc-500">{{ t("admin.aiProcesses.columns.duration") }}</h2>
          <p class="mt-2 font-mono text-sm">{{ card.durationMs == null ? "—" : `${card.durationMs} ms` }}</p>
        </section>
      </div>

      <section class="mt-6 bg-white p-5 dark:bg-zinc-900">
        <h2 class="font-serif text-xl">{{ t("admin.aiProcesses.card.object") }}</h2>
        <NuxtLink
          v-if="card.object.href"
          :to="card.object.href"
          class="mt-3 inline-block underline underline-offset-4"
          >{{ card.object.title }}</NuxtLink
        >
        <p v-else class="mt-3">{{ card.object.title }}</p>
        <p class="mt-1 font-mono text-xs text-zinc-500">{{ card.object.type }} · {{ card.object.id }}</p>
      </section>

      <section data-ai-card-reasons class="mt-6 bg-white p-5 dark:bg-zinc-900">
        <h2 class="font-serif text-xl">{{ t("admin.aiProcesses.card.reasons") }}</h2>
        <p v-if="card.reasons.length === 0" class="mt-3 text-sm text-zinc-500">
          {{ t("admin.aiProcesses.card.noReasons") }}
        </p>
        <ul v-else class="mt-3 space-y-3">
          <li
            v-for="reason in card.reasons"
            :key="`${reason.category}:${reason.text}`"
            class="border-l-2 border-orange-500 pl-3">
            <span class="font-mono text-xs">{{ reason.category }}</span>
            <p v-if="reason.text" class="mt-1 text-sm">{{ reason.text }}</p>
          </li>
        </ul>
      </section>

      <dl class="mt-6 grid gap-3 font-sans text-sm sm:grid-cols-3">
        <div>
          <dt class="text-xs text-zinc-500">{{ t("admin.aiProcesses.card.created") }}</dt>
          <dd>{{ formatDate(card.createdAt) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-zinc-500">{{ t("admin.aiProcesses.card.started") }}</dt>
          <dd>{{ formatDate(card.startedAt) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-zinc-500">{{ t("admin.aiProcesses.card.finished") }}</dt>
          <dd>{{ formatDate(card.finishedAt) }}</dd>
        </div>
      </dl>

      <NuxtLink
        v-if="card.jobHref"
        :to="card.jobHref"
        class="mt-6 inline-block min-h-11 border border-zinc-300 px-4 py-3 text-sm underline underline-offset-4 dark:border-zinc-700"
        >{{ t("admin.aiProcesses.card.openJob") }}</NuxtLink
      >
    </article>
  </section>
</template>
