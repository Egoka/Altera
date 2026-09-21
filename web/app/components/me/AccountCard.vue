<script setup lang="ts">
  import type { AccountDashboard } from "~/middleware/account-dashboard"

  // Зона 2 сводки (`dashboard.md` §5–6): e-mail здесь не показывается — он в `/me/settings` (§4).
  const props = defineProps<{ account: Pick<AccountDashboard, "name" | "handle" | "photoUrl"> }>()
  const { t } = useI18n()

  const initials = computed(() =>
    props.account.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("")
  )
</script>

<template>
  <section data-testid="dashboard-account" class="flex items-center gap-4">
    <img
      v-if="account.photoUrl"
      :src="account.photoUrl"
      alt=""
      class="size-16 shrink-0 rounded-full object-cover"
      data-testid="dashboard-avatar" />
    <span
      v-else
      aria-hidden="true"
      data-testid="dashboard-initials"
      class="flex size-16 shrink-0 items-center justify-center rounded-full bg-zinc-200 font-sans text-lg font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
      {{ initials }}
    </span>
    <div class="flex min-w-0 flex-col gap-1">
      <p class="truncate font-serif text-2xl text-zinc-950 dark:text-zinc-50">{{ account.name }}</p>
      <p class="font-sans text-sm text-zinc-500 dark:text-zinc-400">@{{ account.handle }}</p>
      <NuxtLink
        to="/me/settings"
        data-testid="dashboard-profile-link"
        class="self-start border-b border-orange-600 font-sans text-sm text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
        {{ t("account.dashboard.profileLink") }}
      </NuxtLink>
    </div>
  </section>
</template>
