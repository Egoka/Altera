<script setup lang="ts">
  import type { AdminStaffCard, AdminStaffRow } from "@/composables/useAdminStaff"
  import type { AdminStaffExceptionTerm, AssignableStaffRole, Role } from "~/graphql/generated/graphql"
  import { staffFiltersToQuery } from "~/utils/adminStaffFilters"

  const { t } = useI18n()

  definePageMeta({
    i18n: false,
    layout: "admin",
    middleware: ["admin"]
  })

  const { summary } = useAdminDashboard()
  const {
    staff,
    owners,
    card,
    filters,
    failure,
    pending,
    failed,
    refresh,
    openCard,
    closeCard,
    createStaff,
    changeRole,
    revokeRole,
    assignOwner,
    revokeOwner,
    deactivateOwner,
    archiveAccount,
    restoreAccount
  } = useAdminStaff()

  // Раздел доступен `admin` и `owner`, но роли, исключения и архив меняет только владелец (§26.7).
  const isOwner = computed(() => summary.value?.role === "owner")

  const assignableRoles: AssignableStaffRole[] = ["editor", "moderator", "analyst", "admin"]

  // Фильтры живут в адресе страницы (`admins.md` п. 4); начальное значение читает composable.
  const router = useRouter()

  const search = ref(filters.value.search ?? "")
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  watch(search, (value) => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      filters.value = { ...filters.value, search: value.trim() || null }
    }, 200)
  })

  watch(filters, (value) => {
    router.replace({ query: staffFiltersToQuery(value) })
  })

  const setFilter = <K extends keyof typeof filters.value>(key: K, value: (typeof filters.value)[K]) => {
    filters.value = { ...filters.value, [key]: value }
  }

  const isEmpty = computed(() => !pending.value && !failed.value && (staff.value?.length ?? 0) === 0)
  const conflict = computed(() => failure.value?.code === "CONFLICT")

  const isCreateOpen = ref(false)
  const createForm = ref<{ email: string; name: string; role: AssignableStaffRole }>({
    email: "",
    name: "",
    role: "editor"
  })

  function openCreate() {
    createForm.value = { email: "", name: "", role: "editor" }
    isCreateOpen.value = true
  }

  async function submitCreate() {
    const created = await createStaff({
      email: createForm.value.email.trim(),
      name: createForm.value.name.trim(),
      role: createForm.value.role
    })
    if (created) isCreateOpen.value = false
  }

  type ReasonAction = "changeRole" | "revokeRole" | "revokeOwner" | "deactivateOwner" | "archive" | "restore"

  const reasonAction = ref<ReasonAction | null>(null)
  const reason = ref("")
  const nextRole = ref<AssignableStaffRole>("editor")

  const reasonTitles: Record<ReasonAction, string> = {
    changeRole: "changeRole",
    revokeRole: "revokeRole",
    revokeOwner: "revokeOwner",
    deactivateOwner: "deactivateOwner",
    archive: "archive",
    restore: "restore"
  }

  function openReason(action: ReasonAction) {
    reasonAction.value = action
    reason.value = ""
    nextRole.value = "editor"
  }

  function closeReason() {
    reasonAction.value = null
    reason.value = ""
  }

  async function submitReason() {
    const target = card.value
    const action = reasonAction.value
    if (!target || !action) return
    const input = { id: target.id, reason: reason.value.trim() }
    const done =
      action === "changeRole"
        ? await changeRole({ ...input, role: nextRole.value })
        : action === "revokeRole"
          ? await revokeRole(input)
          : action === "revokeOwner"
            ? await revokeOwner(input)
            : action === "deactivateOwner"
              ? await deactivateOwner(input)
              : action === "archive"
                ? await archiveAccount(input)
                : await restoreAccount(input)
    if (done) closeReason()
  }

  // Назначение владельца — два шага: подтверждение записи, затем точный e-mail (`admins.md` §7).
  const assignStep = ref<0 | 1 | 2>(0)
  const assignEmail = ref("")

  function openAssign() {
    assignStep.value = 1
    assignEmail.value = ""
  }

  function closeAssign() {
    assignStep.value = 0
    assignEmail.value = ""
  }

  const assignMatches = computed(
    () => card.value !== null && assignEmail.value.trim().toLowerCase() === card.value.email.toLowerCase()
  )

  async function confirmAssign() {
    if (!card.value || !assignMatches.value) return
    const done = await assignOwner({ id: card.value.id })
    if (done) closeAssign()
  }

  function formatDate(iso: string | null | undefined): string {
    if (!iso) return t("admin.staff.never")
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
  }

  function roleLabel(role: Role | null | undefined): string {
    if (!role) return t("admin.staff.never")
    return role === "reader" || role === "author" ? role : t(`admin.roles.${role}`)
  }

  function statusLabel(status: AdminStaffRow["status"]): string {
    return status === "archived" ? t("admin.staff.statusArchived") : t("admin.staff.statusActive")
  }

  const roleColors: Record<string, string> = {
    owner: "bg-purple-50 text-purple-700 ring-purple-600/10 dark:bg-purple-950 dark:text-purple-300",
    admin: "bg-blue-50 text-blue-700 ring-blue-600/10 dark:bg-blue-950 dark:text-blue-300",
    analyst: "bg-teal-50 text-teal-700 ring-teal-600/10 dark:bg-teal-950 dark:text-teal-300",
    moderator: "bg-amber-50 text-amber-700 ring-amber-600/10 dark:bg-amber-950 dark:text-amber-300",
    editor: "bg-green-50 text-green-700 ring-green-600/10 dark:bg-green-950 dark:text-green-300"
  }

  const detail = computed<AdminStaffCard | null>(() => card.value)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex shrink-0 items-start justify-between gap-4 px-4 py-3">
      <div>
        <h1 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{{ t("admin.staff.title") }}</h1>
        <p class="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{{ t("admin.staff.description") }}</p>
      </div>
      <Button mode="outline" icon="lucide:plus" class="shrink-0" @click="openCreate">
        {{ t("admin.staff.create") }}
      </Button>
    </div>

    <p
      v-if="!isOwner"
      class="mx-4 mb-3 rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
      {{ t("admin.staff.adminLimited") }}
    </p>

    <p
      v-if="conflict"
      role="status"
      class="mx-4 mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {{ t("admin.staff.conflict") }}
    </p>

    <div class="flex flex-wrap items-center gap-3 px-4 pb-3">
      <label class="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
        <span>{{ t("admin.staff.filterRole") }}</span>
        <select
          class="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          :value="filters.role ?? ''"
          @change="setFilter('role', (($event.target as HTMLSelectElement).value || null) as Role | null)">
          <option value="">{{ t("admin.staff.filterAllRoles") }}</option>
          <option v-for="role in assignableRoles" :key="role" :value="role">{{ t(`admin.roles.${role}`) }}</option>
          <option value="owner">{{ t("admin.roles.owner") }}</option>
        </select>
      </label>

      <label class="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
        <span>{{ t("admin.staff.filterStatus") }}</span>
        <select
          class="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          :value="filters.status ?? 'active'"
          @change="setFilter('status', ($event.target as HTMLSelectElement).value as AdminStaffRow['status'])">
          <option value="active">{{ t("admin.staff.statusActive") }}</option>
          <option value="archived">{{ t("admin.staff.statusArchived") }}</option>
        </select>
      </label>

      <label class="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
        <input
          type="checkbox"
          :checked="filters.hasExceptions === true"
          @change="setFilter('hasExceptions', ($event.target as HTMLInputElement).checked || null)" />
        <span>{{ t("admin.staff.filterHasExceptions") }}</span>
      </label>

      <label class="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
        <span>{{ t("admin.staff.filterTerm") }}</span>
        <select
          class="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          :value="filters.term ?? ''"
          @change="
            setFilter('term', (($event.target as HTMLSelectElement).value || null) as AdminStaffExceptionTerm | null)
          ">
          <option value="">{{ t("admin.staff.filterTermAny") }}</option>
          <option value="indefinite">{{ t("admin.staff.filterTermIndefinite") }}</option>
          <option value="expiring">{{ t("admin.staff.filterTermExpiring") }}</option>
        </select>
      </label>

      <input
        v-model="search"
        type="search"
        :placeholder="t('admin.staff.search')"
        :aria-label="t('admin.staff.search')"
        class="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900" />
    </div>

    <div class="flex min-h-0 flex-1 gap-4 px-4 pb-4">
      <div class="min-w-0 flex-1 overflow-y-auto">
        <div v-if="pending" role="status" class="space-y-2" :aria-label="t('admin.staff.loading')">
          <span class="sr-only">{{ t("admin.staff.loading") }}</span>
          <div
            v-for="row in 4"
            :key="row"
            class="h-10 animate-pulse rounded bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800"></div>
        </div>

        <div
          v-else-if="failed"
          role="alert"
          class="rounded-md bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          <p class="font-semibold">{{ t("admin.staff.errorTitle") }}</p>
          <p v-if="failure?.requestId" class="mt-1 font-mono text-xs">
            {{ t("admin.staff.requestCode", { requestId: failure.requestId }) }}
          </p>
          <Button mode="ghost" class="mt-2" @click="refresh()">{{ t("admin.summary.refresh") }}</Button>
        </div>

        <div v-else-if="isEmpty" class="rounded-md bg-zinc-50 p-8 text-center dark:bg-zinc-900/60">
          <p class="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{{ t("admin.staff.empty") }}</p>
          <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{{ t("admin.staff.emptyHint") }}</p>
        </div>

        <table v-else class="w-full text-left text-sm">
          <thead class="text-xs uppercase text-zinc-500 dark:text-zinc-400">
            <tr>
              <th scope="col" class="px-2 py-2">{{ t("admin.staff.fieldName") }}</th>
              <th scope="col" class="px-2 py-2">{{ t("admin.staff.fieldEmail") }}</th>
              <th scope="col" class="px-2 py-2">{{ t("admin.staff.fieldRole") }}</th>
              <th scope="col" class="px-2 py-2">{{ t("admin.staff.fieldStatus") }}</th>
              <th scope="col" class="px-2 py-2">{{ t("admin.staff.fieldCreatedBy") }}</th>
              <th scope="col" class="px-2 py-2">{{ t("admin.staff.fieldLastActive") }}</th>
              <th scope="col" class="px-2 py-2">{{ t("admin.staff.fieldExceptions") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="member in staff"
              :key="member.id"
              class="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              @click="openCard(member.id)">
              <td class="px-2 py-2 text-zinc-900 dark:text-zinc-100">{{ member.name }}</td>
              <td class="px-2 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">{{ member.email }}</td>
              <td class="px-2 py-2">
                <span
                  class="inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
                  :class="roleColors[member.role]">
                  {{ roleLabel(member.role) }}
                </span>
              </td>
              <td class="px-2 py-2 text-zinc-600 dark:text-zinc-300">{{ statusLabel(member.status) }}</td>
              <td class="px-2 py-2 text-zinc-600 dark:text-zinc-300">
                {{ member.createdByName ?? t("admin.staff.never") }}
              </td>
              <td class="px-2 py-2 text-zinc-600 dark:text-zinc-300">{{ formatDate(member.lastActiveAt) }}</td>
              <td class="px-2 py-2 text-zinc-600 dark:text-zinc-300">{{ member.activeExceptionCount }}</td>
            </tr>
          </tbody>
        </table>

        <section v-if="isOwner" class="mt-6">
          <h2 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ t("admin.staff.owners") }}</h2>
          <p v-if="(owners?.length ?? 0) === 0" class="mt-1 text-sm text-zinc-500">
            {{ t("admin.staff.ownersEmpty") }}
          </p>
          <ul v-else class="mt-2 space-y-1 text-sm">
            <li v-for="owner in owners" :key="owner.id" class="flex flex-wrap gap-x-3 text-zinc-600 dark:text-zinc-300">
              <span class="text-zinc-900 dark:text-zinc-100">{{ owner.name }}</span>
              <span class="font-mono text-xs">{{ owner.email }}</span>
              <span>{{ t("admin.staff.ownerAssignedAt") }}: {{ formatDate(owner.assignedAt) }}</span>
            </li>
          </ul>
        </section>
      </div>

      <aside v-if="detail" class="w-80 shrink-0 overflow-y-auto rounded-md bg-zinc-50 p-4 dark:bg-zinc-900/60">
        <div class="flex items-start justify-between">
          <div>
            <h2 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">{{ detail.name }}</h2>
            <p class="font-mono text-xs text-zinc-500 dark:text-zinc-400">{{ detail.email }}</p>
          </div>
          <Button
            mode="ghost"
            icon="lucide:x"
            class="h-8 w-8 p-1"
            :aria-label="t('common.cancel')"
            @click="closeCard" />
        </div>

        <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt class="text-zinc-400 dark:text-zinc-500">{{ t("admin.staff.fieldRole") }}</dt>
            <dd class="text-zinc-900 dark:text-zinc-100">{{ roleLabel(detail.role) }}</dd>
          </div>
          <div>
            <dt class="text-zinc-400 dark:text-zinc-500">{{ t("admin.staff.fieldStatus") }}</dt>
            <dd class="text-zinc-900 dark:text-zinc-100">{{ statusLabel(detail.status) }}</dd>
          </div>
          <div>
            <dt class="text-zinc-400 dark:text-zinc-500">{{ t("admin.staff.fieldCreatedAt") }}</dt>
            <dd class="text-zinc-900 dark:text-zinc-100">{{ formatDate(detail.createdAt) }}</dd>
          </div>
          <div>
            <dt class="text-zinc-400 dark:text-zinc-500">{{ t("admin.staff.fieldSessions") }}</dt>
            <dd class="text-zinc-900 dark:text-zinc-100">{{ detail.sessionCount }}</dd>
          </div>
          <div v-if="detail.archiveReason" class="col-span-2">
            <dt class="text-zinc-400 dark:text-zinc-500">{{ t("admin.staff.fieldArchiveReason") }}</dt>
            <dd class="text-zinc-900 dark:text-zinc-100">{{ detail.archiveReason }}</dd>
          </div>
        </dl>

        <section class="mt-4">
          <h3 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ t("admin.staff.roleHistory") }}</h3>
          <p v-if="detail.roleHistory.length === 0" class="mt-1 text-sm text-zinc-500">
            {{ t("admin.staff.roleHistoryEmpty") }}
          </p>
          <ul v-else class="mt-1 space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
            <li v-for="change in detail.roleHistory" :key="change.id">
              {{ roleLabel(change.before) }} → {{ roleLabel(change.after) }} ·
              {{ change.actorName ?? t("admin.staff.never") }} ·
              {{ formatDate(change.createdAt) }}
            </li>
          </ul>
        </section>

        <section class="mt-4">
          <h3 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ t("admin.staff.exceptions") }}</h3>
          <p v-if="detail.exceptions.length === 0" class="mt-1 text-sm text-zinc-500">
            {{ t("admin.staff.exceptionsEmpty") }}
          </p>
          <ul v-else class="mt-1 space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
            <li v-for="exception in detail.exceptions" :key="exception.id">
              {{ exception.permission }} ·
              {{ exception.kind === "grant" ? t("admin.staff.exceptionGrant") : t("admin.staff.exceptionDeny") }} ·
              {{ formatDate(exception.endsAt) }}
            </li>
          </ul>
        </section>

        <div v-if="isOwner" class="mt-5 flex flex-col gap-2">
          <template v-if="detail.role === 'owner'">
            <Button mode="outline" @click="openReason('revokeOwner')">{{ t("admin.staff.revokeOwner") }}</Button>
            <Button mode="outline" @click="openReason('deactivateOwner')">{{
              t("admin.staff.deactivateOwner")
            }}</Button>
          </template>
          <template v-else>
            <Button mode="outline" @click="openReason('changeRole')">{{ t("admin.staff.changeRole") }}</Button>
            <Button mode="outline" @click="openReason('revokeRole')">{{ t("admin.staff.revokeRole") }}</Button>
            <Button v-if="detail.status === 'active'" mode="outline" @click="openAssign">
              {{ t("admin.staff.assignOwner") }}
            </Button>
            <Button v-if="detail.status === 'active'" mode="outline" @click="openReason('archive')">
              {{ t("admin.staff.archive") }}
            </Button>
            <Button v-else mode="outline" @click="openReason('restore')">{{ t("admin.staff.restore") }}</Button>
          </template>
        </div>
      </aside>

      <aside v-else class="hidden w-80 shrink-0 items-center justify-center text-sm text-zinc-400 md:flex">
        {{ t("admin.staff.selectFromList") }}
      </aside>
    </div>

    <AppDialog v-model="isCreateOpen" close-button class="max-w-md">
      <h2 class="px-4 pt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">{{ t("admin.staff.create") }}</h2>
      <div class="flex flex-col gap-4 p-4">
        <p class="text-sm text-zinc-500 dark:text-zinc-400">{{ t("admin.staff.createHint") }}</p>
        <div>
          <label for="staff-email" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {{ t("admin.staff.fieldEmail") }}
          </label>
          <input
            id="staff-email"
            v-model="createForm.email"
            type="email"
            class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900" />
        </div>
        <div>
          <label for="staff-name" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {{ t("admin.staff.fieldName") }}
          </label>
          <input
            id="staff-name"
            v-model="createForm.name"
            type="text"
            class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900" />
        </div>
        <div>
          <label for="staff-role" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {{ t("admin.staff.fieldRole") }}
          </label>
          <select
            id="staff-role"
            v-model="createForm.role"
            class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900">
            <option v-for="role in assignableRoles" :key="role" :value="role">{{ t(`admin.roles.${role}`) }}</option>
          </select>
        </div>
        <div class="flex gap-2 pt-2">
          <Button mode="ghost" class="flex-1" @click="isCreateOpen = false">{{ t("common.cancel") }}</Button>
          <Button
            mode="outline"
            class="flex-1"
            :disabled="!createForm.email.trim() || !createForm.name.trim() || pending"
            @click="submitCreate">
            {{ t("admin.staff.create") }}
          </Button>
        </div>
      </div>
    </AppDialog>

    <AppDialog :model-value="reasonAction !== null" close-button class="max-w-md" @update:model-value="closeReason">
      <h2 class="px-4 pt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {{ reasonAction ? t(`admin.staff.${reasonTitles[reasonAction]}`) : "" }}
      </h2>
      <div class="flex flex-col gap-4 p-4">
        <div v-if="reasonAction === 'changeRole'">
          <label for="staff-next-role" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {{ t("admin.staff.fieldRole") }}
          </label>
          <select
            id="staff-next-role"
            v-model="nextRole"
            class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900">
            <option v-for="role in assignableRoles" :key="role" :value="role">{{ t(`admin.roles.${role}`) }}</option>
          </select>
        </div>
        <div>
          <label for="staff-reason" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {{ t("admin.staff.reason") }}
          </label>
          <input
            id="staff-reason"
            v-model="reason"
            type="text"
            :placeholder="t('admin.staff.reasonPlaceholder')"
            class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900" />
        </div>
        <p v-if="conflict" role="status" class="text-sm text-amber-700 dark:text-amber-300">
          {{ t("admin.staff.conflict") }}
        </p>
        <div class="flex gap-2 pt-2">
          <Button mode="ghost" class="flex-1" @click="closeReason">{{ t("common.cancel") }}</Button>
          <Button mode="outline" class="flex-1" :disabled="!reason.trim() || pending" @click="submitReason">
            {{ t("common.confirm") }}
          </Button>
        </div>
      </div>
    </AppDialog>

    <AppDialog :model-value="assignStep !== 0" close-button class="max-w-md" @update:model-value="closeAssign">
      <h2 class="px-4 pt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {{ assignStep === 1 ? t("admin.staff.assignStepOneTitle") : t("admin.staff.assignStepTwoTitle") }}
      </h2>
      <div class="flex flex-col gap-4 p-4">
        <template v-if="assignStep === 1">
          <p class="text-sm text-zinc-600 dark:text-zinc-300">{{ t("admin.staff.assignStepOneHint") }}</p>
          <p class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ detail?.name }}</p>
          <div class="flex gap-2 pt-2">
            <Button mode="ghost" class="flex-1" @click="closeAssign">{{ t("common.cancel") }}</Button>
            <Button mode="outline" class="flex-1" @click="assignStep = 2">{{ t("admin.staff.assignContinue") }}</Button>
          </div>
        </template>
        <template v-else>
          <p class="text-sm text-zinc-600 dark:text-zinc-300">{{ t("admin.staff.assignStepTwoHint") }}</p>
          <div>
            <label for="assign-owner-email" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {{ t("admin.staff.assignEmailLabel") }}
            </label>
            <input
              id="assign-owner-email"
              v-model="assignEmail"
              type="email"
              class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900" />
          </div>
          <div class="flex gap-2 pt-2">
            <Button mode="ghost" class="flex-1" @click="closeAssign">{{ t("common.cancel") }}</Button>
            <Button mode="outline" class="flex-1" :disabled="!assignMatches || pending" @click="confirmAssign">
              {{ t("admin.staff.assignConfirm") }}
            </Button>
          </div>
        </template>
      </div>
    </AppDialog>
  </div>
</template>
