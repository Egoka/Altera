<script setup lang="ts">
  import type { IColumn } from "#fishtvue/table"
  import type { Panel } from "#fishtvue/split"
  import type { AdminGrantRow } from "@/composables/useAdminGrants"

  const { t } = useI18n()

  type GrantStatus = AdminGrantRow["status"]
  type PlanTier = AdminGrantRow["tier"]

  const tierOptions: Array<{ id: PlanTier; value: string }> = [
    { id: "standard", value: "Standard" },
    { id: "pro", value: "Pro" }
  ]

  const statusOptions: Array<{ id: GrantStatus; value: string }> = [
    { id: "queued", value: "В очереди" },
    { id: "active", value: "Активна" },
    { id: "ended", value: "Завершена" },
    { id: "revoked", value: "Отозвана" }
  ]

  definePageMeta({
    i18n: false,
    layout: "admin",
    middleware: ["admin"]
  })

  const { isSm, isMd } = useBreakpoint()
  const tableHeight = ref(47)
  const { grants: data, pending: isListLoading, failed: loadError } = useAdminGrants()

  watch(
    isSm,
    (value) => {
      tableHeight.value = value ? 102 : 82
    },
    { immediate: true }
  )
  watch(
    isMd,
    (value) => {
      tableHeight.value = value ? 47 : 102
    },
    { immediate: true }
  )

  const panels = ref<Panel[]>([
    { name: "table", minSize: 10 },
    { name: "item", minSize: 10, size: 40, hidden: true }
  ])

  const columns = shallowRef<Array<IColumn>>([
    {
      dataField: "userName",
      name: "userName",
      type: "string",
      caption: "Пользователь",
      visible: true,
      width: 200,
      minWidth: 160,
      isFilter: true,
      isSort: true,
      class: { td: "cursor-pointer" }
    },
    {
      dataField: "userHandle",
      name: "userHandle",
      type: "string",
      caption: "Хэндл",
      visible: true,
      width: 160,
      minWidth: 120,
      isFilter: true,
      isSort: true
    },
    {
      dataField: "tier",
      name: "tier",
      type: "select",
      caption: "План",
      visible: true,
      width: 120,
      minWidth: 100,
      isFilter: true,
      isSort: true,
      cellTemplate: "tier",
      paramsFilter: { dataSelect: tierOptions }
    },
    {
      dataField: "status",
      name: "status",
      type: "select",
      caption: "Состояние",
      visible: true,
      width: 140,
      minWidth: 120,
      isFilter: true,
      isSort: true,
      cellTemplate: "status",
      paramsFilter: { dataSelect: statusOptions }
    },
    {
      dataField: "startsAt",
      name: "startsAt",
      type: "date",
      caption: "Начало",
      visible: true,
      width: 130,
      minWidth: 110,
      isFilter: true,
      isSort: true
    },
    {
      dataField: "endsAt",
      name: "endsAt",
      type: "date",
      caption: "Конец",
      visible: true,
      width: 130,
      minWidth: 110,
      isFilter: true,
      isSort: true,
      cellTemplate: "endsAt"
    }
  ])

  const statusColors: Record<GrantStatus, string> = {
    active: "bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950 dark:text-green-300 dark:ring-green-400/20",
    queued:
      "bg-yellow-50 text-yellow-700 ring-yellow-600/10 dark:bg-yellow-950 dark:text-yellow-300 dark:ring-yellow-400/10",
    ended: "bg-zinc-50 text-zinc-600 ring-zinc-500/10 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-400/10",
    revoked: "bg-red-50 text-red-700 ring-red-600/10 dark:bg-red-950 dark:text-red-300 dark:ring-red-400/10"
  }

  const tierColors: Record<PlanTier, string> = {
    pro: "bg-purple-50 text-purple-700 ring-purple-600/10 dark:bg-purple-950 dark:text-purple-300 dark:ring-purple-400/10",
    standard: "bg-blue-50 text-blue-700 ring-blue-600/10 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-400/10"
  }

  const selectedGrant = ref<AdminGrantRow | null>(null)

  function openDetail(row: AdminGrantRow) {
    selectedGrant.value = row
    panels.value = panels.value.map((p) => (p.name === "item" ? { ...p, hidden: false } : p))
  }

  function closeDetail() {
    selectedGrant.value = null
    panels.value = panels.value.map((p) => (p.name === "item" ? { ...p, hidden: true } : p))
  }

  function formatDate(iso: string | null): string {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
  }
</script>

<template>
  <div class="h-[calc(100vh-56px)] sm:h-[calc(100vh-80px)] md:h-full flex flex-col">
    <div class="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
      <h1 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{{ t("admin.subscriptionsTitle") }}</h1>
      <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{{ t("admin.subscriptionsDescription") }}</p>
    </div>

    <div class="px-4 py-3 shrink-0">
      <div
        class="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-950">
        <Icons type="lucide:info" class="mt-0.5 h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <p class="text-sm text-blue-700 dark:text-blue-300">
          {{ t("admin.firstLaunchSubscriptionsNote") }}
        </p>
      </div>
    </div>

    <Split :panels="panels" direction="horizontal" class="flex-1 min-h-0">
      <template #table>
        <Table
          v-if="!isListLoading"
          :data-source="data"
          :columns="columns"
          :height="tableHeight"
          :is-loading="isListLoading"
          :load-error="loadError"
          class="h-full"
          @click-row="openDetail($event.data)">
          <template #tier="{ value }">
            <span
              class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
              :class="tierColors[value as PlanTier]">
              {{ value === "pro" ? "Pro" : "Standard" }}
            </span>
          </template>
          <template #status="{ value }">
            <span
              class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
              :class="statusColors[value as GrantStatus]">
              {{ t(`admin.grantStatus.${value}`) }}
            </span>
          </template>
          <template #endsAt="{ value }">
            <span :class="value ? '' : 'text-zinc-400 italic'">
              {{ value ? formatDate(value) : t("admin.indefinite") }}
            </span>
          </template>
        </Table>
        <div v-else role="status" class="flex h-full items-center justify-center text-sm text-zinc-500">
          {{ t("common.loading") }}
        </div>
      </template>

      <template #item>
        <div v-if="selectedGrant" class="h-full overflow-y-auto p-4 flex flex-col gap-4">
          <div class="flex items-start justify-between">
            <div>
              <h2 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {{ selectedGrant.userName }}
              </h2>
              <p class="text-sm text-zinc-500 dark:text-zinc-400">@{{ selectedGrant.userHandle }}</p>
            </div>
            <Button mode="ghost" icon="lucide:x" class="h-8 w-8 p-1" @click="closeDetail" />
          </div>

          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p class="text-zinc-400 dark:text-zinc-500 mb-0.5">{{ t("admin.fieldPlan") }}</p>
              <span
                class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
                :class="tierColors[selectedGrant.tier]">
                {{ selectedGrant.tier === "pro" ? "Pro" : "Standard" }}
              </span>
            </div>
            <div>
              <p class="text-zinc-400 dark:text-zinc-500 mb-0.5">{{ t("admin.fieldStatus") }}</p>
              <span
                class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
                :class="statusColors[selectedGrant.status]">
                {{ t(`admin.grantStatus.${selectedGrant.status}`) }}
              </span>
            </div>
            <div>
              <p class="text-zinc-400 dark:text-zinc-500 mb-0.5">{{ t("admin.fieldStartsAt") }}</p>
              <p class="text-zinc-900 dark:text-zinc-100">{{ formatDate(selectedGrant.startsAt) }}</p>
            </div>
            <div>
              <p class="text-zinc-400 dark:text-zinc-500 mb-0.5">{{ t("admin.fieldEndsAt") }}</p>
              <p :class="selectedGrant.endsAt ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 italic'">
                {{ selectedGrant.endsAt ? formatDate(selectedGrant.endsAt) : t("admin.indefinite") }}
              </p>
            </div>
            <div class="col-span-2">
              <p class="text-zinc-400 dark:text-zinc-500 mb-0.5">{{ t("admin.fieldReason") }}</p>
              <p class="text-zinc-900 dark:text-zinc-100">{{ selectedGrant.reason }}</p>
            </div>
          </div>

          <div class="mt-auto pt-4 border-t border-zinc-200 dark:border-zinc-700">
            <NuxtLink to="/admin/grants" class="text-sm text-blue-600 dark:text-blue-400 hover:underline">
              {{ t("admin.manageGrantsLink") }}
            </NuxtLink>
          </div>
        </div>
        <div v-else class="h-full flex items-center justify-center text-zinc-400 dark:text-zinc-600 text-sm">
          {{ t("admin.selectFromList") }}
        </div>
      </template>
    </Split>
  </div>
</template>
