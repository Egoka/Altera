<script setup lang="ts">
  import type { AttentionItem } from "~/utils/accountDashboard"

  /**
   * Зона 4 сводки (`dashboard.md` §5): материалы на проверке, отклонённые с непрочитанным
   * объяснением (журнал §24.3) и окно «перередактировать» с обратным отсчётом (журнал #9).
   * Мутации перередактирования в API ещё нет, поэтому строка ведёт на страницу материала.
   */
  const props = defineProps<{ items: AttentionItem[]; now: number }>()
  const { t } = useI18n()

  const minutesLeft = (until: string) => Math.max(1, Math.ceil((new Date(until).getTime() - props.now) / 60_000))

  const detail = (item: AttentionItem) => {
    const { translation } = item
    if (item.reason === "rejected") return t("account.dashboard.attention.rejected")
    if (item.reason === "reedit" && translation.reeditUntil) {
      return t("account.dashboard.attention.reedit", { minutes: minutesLeft(translation.reeditUntil) })
    }
    return t("account.dashboard.attention.checking")
  }

  const actionLabel = (item: AttentionItem) =>
    item.reason === "rejected"
      ? t("account.dashboard.attention.openExplanation")
      : t("account.dashboard.attention.open")
</script>

<template>
  <section data-testid="dashboard-attention" class="flex flex-col gap-3">
    <h2 class="font-sans text-sm font-semibold text-zinc-800 dark:text-zinc-200">
      {{ t("account.dashboard.attention.title") }}
    </h2>
    <ul class="flex flex-col gap-2">
      <li
        v-for="item in items"
        :key="item.translation.id"
        :data-attention-reason="item.reason"
        class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-orange-50 px-4 py-3 dark:bg-orange-950/40">
        <div class="flex min-w-0 flex-col">
          <span class="truncate font-sans text-base font-medium text-zinc-950 dark:text-zinc-50">
            {{ item.translation.title }}
          </span>
          <span class="font-sans text-sm text-zinc-700 dark:text-zinc-300">{{ detail(item) }}</span>
        </div>
        <NuxtLink
          :to="`/me/articles/${item.translation.slug}`"
          class="inline-flex min-h-11 items-center border-b border-orange-600 font-sans text-sm font-semibold text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-50">
          {{ actionLabel(item) }}
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
