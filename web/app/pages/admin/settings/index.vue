<script setup lang="ts">
  import { onMounted, ref } from "vue"
  import { SYSTEM_SETTINGS_GROUPS, parseSystemSettingsGroup } from "~/utils/admin"

  const { t } = useI18n()
  const route = useRoute()
  const { summary } = useAdminDashboard()
  const { settings, loading, failed, requestId, load } = useAdminSettings()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-settings"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  type Group = (typeof SYSTEM_SETTINGS_GROUPS)[number]

  const group = ref<Group>(parseSystemSettingsGroup(route.query.group))

  const setGroup = async (value: Group) => {
    group.value = value
    await navigateTo({ path: "/admin/settings", query: { group: value } })
    await load(value)
  }

  onMounted(() => load(group.value))
</script>

<template>
  <section
    class="h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="settings-title">
    <header class="mb-7 pb-5">
      <p class="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-orange-700 dark:text-orange-400">
        {{ t("admin.systemSettings.eyebrow") }}
      </p>
      <h1 id="settings-title" class="font-serif text-3xl text-zinc-950 dark:text-zinc-50 sm:text-4xl">
        {{ t("admin.systemSettings.title") }}
      </h1>
      <p class="mt-2 max-w-2xl font-sans text-sm text-zinc-600 dark:text-zinc-300">
        {{ t("admin.systemSettings.description") }}
      </p>
    </header>

    <div
      data-settings-readonly
      class="mb-6 max-w-3xl bg-white p-4 font-sans text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
      <p>{{ t("admin.systemSettings.readOnly") }}</p>
      <p data-settings-permission class="mt-1 text-zinc-500 dark:text-zinc-400">
        {{ summary?.role === "owner" ? t("admin.systemSettings.ownerNote") : t("admin.systemSettings.adminNote") }}
      </p>
    </div>

    <div class="mb-6 flex flex-wrap gap-1 overflow-x-auto" role="tablist">
      <button
        v-for="value in SYSTEM_SETTINGS_GROUPS"
        :key="value"
        type="button"
        role="tab"
        :aria-selected="group === value"
        :data-settings-group="value"
        class="min-h-11 border-b-2 px-4 font-sans text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
        :class="
          group === value ? 'border-orange-600 text-zinc-950 dark:text-white' : 'border-transparent text-zinc-500'
        "
        @click="setGroup(value)">
        {{ t(`admin.systemSettings.groups.${value}`) }}
      </button>
    </div>

    <div
      v-if="failed"
      role="alert"
      data-settings-error
      class="mb-5 max-w-3xl bg-red-50 p-4 font-sans text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
      <p>
        {{ t("admin.systemSettings.error") }}
        <span v-if="requestId" class="font-mono">requestId: {{ requestId }}</span>
      </p>
      <button type="button" class="mt-3 min-h-10 font-semibold underline" @click="load(group)">
        {{ t("admin.systemSettings.retry") }}
      </button>
    </div>

    <div v-if="loading" aria-busy="true" data-settings-loading class="grid max-w-3xl gap-3">
      <div v-for="index in 4" :key="index" class="h-14 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>

    <div v-else-if="settings && !failed" class="max-w-3xl" :data-settings-panel="settings.group">
      <p class="mb-4 font-sans text-sm text-zinc-600 dark:text-zinc-300">
        <template v-if="settings.adapter">
          {{ t("admin.systemSettings.adapter") }}:
          <span data-settings-adapter class="font-mono text-zinc-950 dark:text-zinc-50">{{ settings.adapter }}</span>
        </template>
        <template v-else>{{ t("admin.systemSettings.adapterMissing") }}</template>
      </p>

      <dl v-if="settings.settings.length" class="grid gap-2">
        <div
          v-for="item in settings.settings"
          :key="item.key"
          :data-setting="item.key"
          class="grid gap-1 bg-white p-4 dark:bg-zinc-900 sm:grid-cols-[minmax(12rem,1fr)_2fr] sm:gap-4">
          <dt>
            <span class="font-mono text-sm text-zinc-950 dark:text-zinc-50">{{ item.key }}</span>
            <span class="mt-1 block font-sans text-xs text-zinc-500">
              {{ t(`admin.systemSettings.source.${item.source}`) }}
              <template v-if="item.secret"> · {{ t("admin.systemSettings.secret") }}</template>
            </span>
          </dt>
          <dd class="break-all font-mono text-sm text-zinc-700 dark:text-zinc-200">
            <template v-if="!item.configured">
              <span class="font-sans text-zinc-500">{{ t("admin.systemSettings.notSet") }}</span>
            </template>
            <template v-else-if="item.secret">{{ item.mask }}</template>
            <template v-else>{{ item.value }}</template>
          </dd>
        </div>
      </dl>
      <p
        v-else
        data-settings-none
        class="bg-white p-6 font-sans text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
        {{ t(`admin.systemSettings.none.${settings.group}`) }}
      </p>
    </div>
  </section>
</template>
