<script setup lang="ts">
  import type { IColumn } from "#fishtvue/table"
  import type { Panel } from "#fishtvue/split"

  const { t } = useI18n()

  type GrantStatus = "queued" | "active" | "ended" | "revoked"
  type PlanTier = "standard" | "pro"

  interface GrantRow {
    id: string
    userId: string
    userName: string
    userHandle: string
    tier: PlanTier
    startsAt: string
    endsAt: string | null
    grantedByName: string | null
    reason: string
    status: GrantStatus
    revokedAt: string | null
    createdAt: string
  }

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
  const isLoading = ref(false)
  const isListLoading = ref(false)
  const loadError = ref(false)

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

  const data = shallowRef<GrantRow[]>([
    {
      id: "g-001",
      userId: "u-001",
      userName: "Александр Иванов",
      userHandle: "alex-ivanov",
      tier: "pro",
      startsAt: "2024-01-15T00:00:00Z",
      endsAt: "2024-07-15T00:00:00Z",
      grantedByName: "Сергей Морозов",
      reason: "Тестирование Pro-функций для партнёрской программы",
      status: "active",
      revokedAt: null,
      createdAt: "2024-01-14T18:30:00Z"
    },
    {
      id: "g-002",
      userId: "u-002",
      userName: "Мария Петрова",
      userHandle: "maria-petrova",
      tier: "standard",
      startsAt: "2024-02-01T00:00:00Z",
      endsAt: null,
      grantedByName: "Сергей Морозов",
      reason: "Базовое авторство первого запуска",
      status: "active",
      revokedAt: null,
      createdAt: "2024-01-30T10:00:00Z"
    },
    {
      id: "g-003",
      userId: "u-003",
      userName: "Дмитрий Сидоров",
      userHandle: "dmitry-sidorov",
      tier: "pro",
      startsAt: "2024-03-01T00:00:00Z",
      endsAt: "2024-04-01T00:00:00Z",
      grantedByName: "Сергей Морозов",
      reason: "Контрибьютор открытого исходного кода",
      status: "ended",
      revokedAt: null,
      createdAt: "2024-02-28T09:15:00Z"
    },
    {
      id: "g-004",
      userId: "u-004",
      userName: "Елена Козлова",
      userHandle: "elena-kozlova",
      tier: "standard",
      startsAt: "2024-01-20T00:00:00Z",
      endsAt: "2024-06-20T00:00:00Z",
      grantedByName: "Сергей Морозов",
      reason: "Участник бета-тестирования",
      status: "revoked",
      revokedAt: "2024-02-10T14:00:00Z",
      createdAt: "2024-01-19T11:00:00Z"
    },
    {
      id: "g-005",
      userId: "u-005",
      userName: "Анна Смирнова",
      userHandle: "anna-smirnova",
      tier: "pro",
      startsAt: "2024-04-01T00:00:00Z",
      endsAt: "2024-10-01T00:00:00Z",
      grantedByName: "Сергей Морозов",
      reason: "Редакционное партнёрство",
      status: "queued",
      revokedAt: null,
      createdAt: "2024-03-28T16:00:00Z"
    }
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
    },
    {
      dataField: "grantedByName",
      name: "grantedByName",
      type: "string",
      caption: "Выдал",
      visible: true,
      width: 180,
      minWidth: 140,
      isFilter: true,
      isSort: true
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

  const selectedGrant = ref<GrantRow | null>(null)
  const isGrantFormOpen = ref(false)

  const grantForm = ref({
    userId: "",
    userHandle: "",
    tier: "standard" as PlanTier,
    startsAt: new Date().toISOString().slice(0, 10),
    endsAt: "",
    reason: ""
  })

  function openDetail(row: GrantRow) {
    selectedGrant.value = row
    panels.value = panels.value.map((p) => (p.name === "item" ? { ...p, hidden: false } : p))
  }

  function closeDetail() {
    selectedGrant.value = null
    panels.value = panels.value.map((p) => (p.name === "item" ? { ...p, hidden: true } : p))
  }

  function openGrantForm() {
    grantForm.value = {
      userId: "",
      userHandle: "",
      tier: "standard",
      startsAt: new Date().toISOString().slice(0, 10),
      endsAt: "",
      reason: ""
    }
    isGrantFormOpen.value = true
  }

  function submitGrant() {
    isLoading.value = true
    setTimeout(() => {
      const newGrant: GrantRow = {
        id: `g-${Date.now()}`,
        userId: `u-new`,
        userName: grantForm.value.userHandle,
        userHandle: grantForm.value.userHandle,
        tier: grantForm.value.tier,
        startsAt: new Date(grantForm.value.startsAt).toISOString(),
        endsAt: grantForm.value.endsAt ? new Date(grantForm.value.endsAt).toISOString() : null,
        grantedByName: "Текущий администратор",
        reason: grantForm.value.reason,
        status: "queued",
        revokedAt: null,
        createdAt: new Date().toISOString()
      }
      data.value = [newGrant, ...data.value]
      isLoading.value = false
      isGrantFormOpen.value = false
    }, 400)
  }

  function revokeGrant(grant: GrantRow) {
    data.value = data.value.map((g) =>
      g.id === grant.id ? { ...g, status: "revoked" as GrantStatus, revokedAt: new Date().toISOString() } : g
    )
    selectedGrant.value = data.value.find((g) => g.id === grant.id) ?? null
  }

  const revokeReason = ref("")
  const isRevokeConfirmOpen = ref(false)

  function formatDate(iso: string | null): string {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
  }
</script>

<template>
  <div class="h-[calc(100vh-56px)] sm:h-[calc(100vh-80px)] md:h-full flex flex-col">
    <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
      <div>
        <h1 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{{ t("admin.grantsTitle") }}</h1>
        <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{{ t("admin.grantsDescription") }}</p>
      </div>
      <Button mode="outline" icon="lucide:plus" class="shrink-0" @click="openGrantForm">
        {{ t("admin.grantPlan") }}
      </Button>
    </div>

    <Split :panels="panels" direction="horizontal" class="flex-1 min-h-0">
      <template #table>
        <Table
          :data="data"
          :columns="columns"
          :height="tableHeight"
          :is-loading="isListLoading"
          :load-error="loadError"
          class="h-full"
          @rowClick="openDetail">
          <template #cell-tier="{ value }">
            <span
              class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
              :class="tierColors[value as PlanTier]">
              {{ value === "pro" ? "Pro" : "Standard" }}
            </span>
          </template>
          <template #cell-status="{ value }">
            <span
              class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
              :class="statusColors[value as GrantStatus]">
              {{ t(`admin.grantStatus.${value}`) }}
            </span>
          </template>
          <template #cell-endsAt="{ value }">
            <span :class="value ? '' : 'text-zinc-400 italic'">
              {{ value ? formatDate(value) : t("admin.indefinite") }}
            </span>
          </template>
        </Table>
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
            <div v-if="selectedGrant.grantedByName" class="col-span-2">
              <p class="text-zinc-400 dark:text-zinc-500 mb-0.5">{{ t("admin.fieldGrantedBy") }}</p>
              <p class="text-zinc-900 dark:text-zinc-100">{{ selectedGrant.grantedByName }}</p>
            </div>
            <div v-if="selectedGrant.revokedAt" class="col-span-2">
              <p class="text-zinc-400 dark:text-zinc-500 mb-0.5">{{ t("admin.fieldRevokedAt") }}</p>
              <p class="text-zinc-900 dark:text-zinc-100">{{ formatDate(selectedGrant.revokedAt) }}</p>
            </div>
          </div>

          <div
            v-if="selectedGrant.status === 'active' || selectedGrant.status === 'queued'"
            class="mt-auto pt-4 border-t border-zinc-200 dark:border-zinc-700">
            <Button
              v-if="!isRevokeConfirmOpen"
              mode="outline"
              icon="lucide:x-circle"
              class="w-full text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
              @click="isRevokeConfirmOpen = true">
              {{ t("admin.revokePlan") }}
            </Button>
            <div v-else class="flex flex-col gap-2">
              <Input v-model="revokeReason" :placeholder="t('admin.revokeReasonPlaceholder')" class="w-full" />
              <div class="flex gap-2">
                <Button
                  mode="ghost"
                  class="flex-1"
                  @click="
                    isRevokeConfirmOpen = false
                    revokeReason = ''
                  ">
                  {{ t("common.cancel") }}
                </Button>
                <Button
                  mode="outline"
                  class="flex-1 text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800"
                  :disabled="!revokeReason.trim()"
                  @click="
                    revokeGrant(selectedGrant!)
                    isRevokeConfirmOpen = false
                    revokeReason = ''
                  ">
                  {{ t("common.confirm") }}
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="h-full flex items-center justify-center text-zinc-400 dark:text-zinc-600 text-sm">
          {{ t("admin.selectFromList") }}
        </div>
      </template>
    </Split>

    <Modal v-model="isGrantFormOpen" :title="t('admin.grantPlan')" class="max-w-md">
      <div class="flex flex-col gap-4 p-4">
        <div>
          <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{{
            t("admin.userHandleLabel")
          }}</label>
          <Input v-model="grantForm.userHandle" placeholder="user-handle" class="w-full" />
        </div>
        <div>
          <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{{
            t("admin.fieldPlan")
          }}</label>
          <Select v-model="grantForm.tier" :data="tierOptions" :styles="{ width: '100%' }" />
        </div>
        <div>
          <label for="grant-starts-at" class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{{
            t("admin.fieldStartsAt")
          }}</label>
          <input
            id="grant-starts-at"
            v-model="grantForm.startsAt"
            type="date"
            class="w-full rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-500" />
        </div>
        <div>
          <label for="grant-ends-at" class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {{ t("admin.fieldEndsAt") }}
            <span class="text-zinc-400 font-normal">{{ t("admin.endsAtHint") }}</span>
          </label>
          <input
            id="grant-ends-at"
            v-model="grantForm.endsAt"
            type="date"
            class="w-full rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-500" />
        </div>
        <div>
          <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{{
            t("admin.fieldReason")
          }}</label>
          <Input v-model="grantForm.reason" :placeholder="t('admin.reasonPlaceholder')" class="w-full" />
        </div>
        <div class="flex gap-2 pt-2">
          <Button mode="ghost" class="flex-1" @click="isGrantFormOpen = false">{{ t("common.cancel") }}</Button>
          <Button
            mode="outline"
            class="flex-1"
            :disabled="!grantForm.userHandle.trim() || !grantForm.reason.trim() || isLoading"
            @click="submitGrant">
            {{ t("admin.grantPlan") }}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
