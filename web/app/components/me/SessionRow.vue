<script setup lang="ts">
  import { computed } from "vue"

  /**
   * Строка устройства (`docs/spec/30-account/reader/sessions.md` §6): класс устройства и
   * браузера, время и одно действие. Аналогов в системе нет — списки статей и закладок
   * показывают материалы, а не сессии.
   * Варианты: `current` — текущая сессия с кнопкой «выйти»; `other` — чужое устройство с
   * «отозвать». Состояние «отзыв в процессе» — `busy`; отозванной строки у компонента нет:
   * по §8 она убирается со страницы, а не остаётся отдельным видом.
   */
  interface AccountSession {
    id: string
    deviceClass: string
    browserClass: string
    createdAt: string
    lastActiveAt: string
    isCurrent: boolean
  }

  const props = defineProps<{ session: AccountSession; busy?: boolean }>()
  const emit = defineEmits<{ revoke: [string]; logout: [] }>()

  const { t, locale } = useI18n()

  const formatMoment = (value: string): string => {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return "—"

    return new Intl.DateTimeFormat(locale.value === "en" ? "en-GB" : "ru-RU", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit"
    }).format(parsed)
  }

  const deviceLabel = computed(() => t(`account.sessions.device.${props.session.deviceClass}`))
  const browserLabel = computed(() => t(`account.sessions.browser.${props.session.browserClass}`))
  // Текущая сессия активна прямо сейчас: показывать её минуты активности незачем (§5 зона 3).
  const activityLabel = computed(() =>
    props.session.isCurrent
      ? t("account.sessions.now")
      : t("account.sessions.lastActiveAt", { date: formatMoment(props.session.lastActiveAt) })
  )
</script>

<template>
  <li
    class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 py-4"
    :data-testid="`session-row-${props.session.id}`"
    :data-session-current="props.session.isCurrent ? 'true' : 'false'"
    :data-session-state="props.busy ? 'revoking' : 'active'">
    <div class="flex min-w-0 flex-col gap-1">
      <p class="font-sans text-base text-zinc-900 dark:text-zinc-100" data-testid="session-device">
        {{ deviceLabel }} · {{ browserLabel }}
      </p>
      <p class="font-sans text-sm text-zinc-600 dark:text-zinc-400" data-testid="session-activity">
        {{ activityLabel }} · {{ t("account.sessions.createdAt", { date: formatMoment(props.session.createdAt) }) }}
      </p>
    </div>

    <button
      v-if="props.session.isCurrent"
      type="button"
      data-testid="session-logout"
      :disabled="props.busy"
      class="shrink-0 border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 transition-colors hover:border-orange-600 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none dark:text-zinc-400 dark:hover:text-orange-400"
      @click="emit('logout')">
      {{ t("account.sessions.logout") }}
    </button>
    <button
      v-else
      type="button"
      data-testid="session-revoke"
      :disabled="props.busy"
      class="shrink-0 border-b border-zinc-400 pb-0.5 font-sans text-sm text-zinc-600 transition-colors hover:border-orange-600 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none dark:text-zinc-400 dark:hover:text-orange-400"
      @click="emit('revoke', props.session.id)">
      {{ props.busy ? t("account.sessions.revoking") : t("account.sessions.revoke") }}
    </button>
  </li>
</template>
