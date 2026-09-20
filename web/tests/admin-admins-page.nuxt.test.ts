// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { computed, ref, watch, type Ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AdminsPage from "../app/pages/admin/admins/index.vue"
import { readStaffFilters, staffFiltersToQuery } from "../app/utils/adminStaffFilters"

// Строки состояний раздела «Администраторы» (`docs/spec/40-admin/admins.md` §9).

const messages: Record<string, string> = {
  "admin.staff.title": "Администраторы",
  "admin.staff.description": "Служебные записи и роли",
  "admin.staff.create": "Создать служебную запись",
  "admin.staff.adminLimited": "Изменения ролей и архив служебных записей — только владелец.",
  "admin.staff.conflict": "Запись изменена другим администратором — список обновлён.",
  "admin.staff.loading": "Загрузка списка",
  "admin.staff.empty": "По фильтру ничего не найдено",
  "admin.staff.emptyHint": "Измените фильтр или создайте служебную запись.",
  "admin.staff.errorTitle": "Не удалось выполнить запрос",
  "admin.staff.changeRole": "Сменить роль",
  "admin.staff.revokeRole": "Снять роль",
  "admin.staff.assignOwner": "Назначить владельцем",
  "admin.staff.archive": "Архивировать запись",
  "admin.staff.assignStepOneTitle": "Шаг 1 из 2: подтвердите запись",
  "admin.staff.assignStepTwoTitle": "Шаг 2 из 2: введите e-mail записи",
  "admin.staff.assignContinue": "Продолжить",
  "admin.staff.assignConfirm": "Назначить владельцем",
  "admin.staff.owners": "Владельцы",
  "admin.staff.never": "—",
  "admin.staff.requestCode": "Код запроса: {requestId}"
}

const row = {
  id: "staff-editor",
  name: "Редактор журнала",
  email: "r***р@altera.test",
  emailMasked: true,
  role: "editor" as const,
  status: "active" as const,
  createdAt: "2026-09-01T00:00:00.000Z",
  createdByName: "Администратор",
  lastActiveAt: "2026-09-19T10:00:00.000Z",
  activeExceptionCount: 1,
  archivedAt: null,
  archiveReason: null
}

const card = {
  ...row,
  email: "redaktor@altera.test",
  emailMasked: false,
  sessionCount: 2,
  roleHistory: [],
  exceptions: []
}

const stubs = {
  Button: {
    props: ["disabled"],
    emits: ["click"],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  },
  AppDialog: { props: ["modelValue"], template: '<div v-if="modelValue"><slot /></div>' }
}

interface StaffState {
  staff?: unknown[]
  pending?: boolean
  failed?: boolean
  failure?: { code: string | null; requestId: string | null } | null
  card?: typeof card | null
  role?: "admin" | "owner"
  query?: Record<string, string>
}

const assignOwner = vi.fn().mockResolvedValue(true)
const changeRole = vi.fn().mockResolvedValue(false)
let openCard: ReturnType<typeof vi.fn>
let cardRef: Ref<typeof card | null>
let filtersRef: Ref<Record<string, unknown>>
let routerReplace: ReturnType<typeof vi.fn>

function setup(state: StaffState = {}) {
  cardRef = ref(state.card ?? null)
  openCard = vi.fn(async (id: string) => {
    cardRef.value = { ...card, id }
    return cardRef.value
  })

  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useI18n", () => ({
    t: (key: string, params?: Record<string, string>) =>
      (messages[key] ?? key).replace(/\{(\w+)\}/g, (_match, name) => params?.[name] ?? "")
  }))
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("computed", computed)
  vi.stubGlobal("watch", watch)
  filtersRef = ref(readStaffFilters(state.query ?? {}))
  routerReplace = vi.fn()
  vi.stubGlobal("useRouter", () => ({ replace: routerReplace }))
  vi.stubGlobal("staffFiltersToQuery", staffFiltersToQuery)
  vi.stubGlobal("useAdminDashboard", () => ({ summary: ref({ role: state.role ?? "owner", cards: [] }) }))
  vi.stubGlobal("useAdminStaff", () => ({
    staff: ref(state.staff ?? [row]),
    owners: ref([]),
    card: cardRef,
    filters: filtersRef,
    failure: ref(state.failure ?? null),
    pending: ref(state.pending ?? false),
    failed: ref(state.failed ?? false),
    refresh: vi.fn(),
    openCard,
    closeCard: vi.fn(() => {
      cardRef.value = null
    }),
    createStaff: vi.fn(),
    changeRole,
    revokeRole: vi.fn(),
    assignOwner,
    revokeOwner: vi.fn(),
    deactivateOwner: vi.fn(),
    archiveAccount: vi.fn(),
    restoreAccount: vi.fn()
  }))
}

beforeEach(() => {
  assignOwner.mockClear()
  changeRole.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("страница «Администраторы»", () => {
  it("показывает скелеты во время загрузки", () => {
    setup({ pending: true })
    const wrapper = mount(AdminsPage, { global: { stubs } })

    expect(wrapper.find('[role="status"]').text()).toContain("Загрузка списка")
    expect(wrapper.find("tbody").exists()).toBe(false)
  })

  it("показывает пустое состояние по фильтру", () => {
    setup({ staff: [] })
    const wrapper = mount(AdminsPage, { global: { stubs } })

    expect(wrapper.text()).toContain("По фильтру ничего не найдено")
  })

  it("показывает ошибку с кодом запроса", () => {
    setup({ failed: true, failure: { code: "INTERNAL_ERROR", requestId: "req-staff-42" } })
    const wrapper = mount(AdminsPage, { global: { stubs } })

    const alert = wrapper.find('[role="alert"]')
    expect(alert.text()).toContain("Не удалось выполнить запрос")
    expect(alert.text()).toContain("req-staff-42")
  })

  it("маскирует адрес в списке", () => {
    setup()
    const wrapper = mount(AdminsPage, { global: { stubs } })

    expect(wrapper.find("tbody").text()).toContain("r***р@altera.test")
    expect(wrapper.find("tbody").text()).not.toContain("redaktor@altera.test")
  })

  it("оставляет администратору только чтение и создание", () => {
    setup({ role: "admin", card })
    const wrapper = mount(AdminsPage, { global: { stubs } })

    expect(wrapper.text()).toContain("Изменения ролей и архив служебных записей — только владелец.")
    const labels = wrapper.findAll("button").map((button) => button.text())
    expect(labels).toContain("Создать служебную запись")
    expect(labels).not.toContain("Сменить роль")
    expect(labels).not.toContain("Архивировать запись")
  })

  it("показывает владельцу действия над ролью и архивом", () => {
    setup({ card })
    const wrapper = mount(AdminsPage, { global: { stubs } })

    const labels = wrapper.findAll("button").map((button) => button.text())
    expect(labels).toContain("Сменить роль")
    expect(labels).toContain("Архивировать запись")
  })

  it("сообщает о конфликте", () => {
    setup({ failure: { code: "CONFLICT", requestId: null } })
    const wrapper = mount(AdminsPage, { global: { stubs } })

    expect(wrapper.text()).toContain("Запись изменена другим администратором")
  })

  // AC-2: владелец назначается только вторым шагом.
  it("не вызывает назначение на первом шаге и требует точный e-mail на втором", async () => {
    setup({ card })
    const wrapper = mount(AdminsPage, { global: { stubs } })

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Назначить владельцем")!
      .trigger("click")
    expect(wrapper.text()).toContain("Шаг 1 из 2")
    expect(assignOwner).not.toHaveBeenCalled()

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Продолжить")!
      .trigger("click")
    expect(wrapper.text()).toContain("Шаг 2 из 2")

    // Первая кнопка с этим текстом — действие в карточке, последняя — подтверждение второго шага.
    const confirm = () =>
      wrapper
        .findAll("button")
        .filter((button) => button.text() === "Назначить владельцем")
        .pop()!
    await wrapper.get("#assign-owner-email").setValue("wrong@altera.test")
    expect(confirm().attributes("disabled")).toBeDefined()
    expect(assignOwner).not.toHaveBeenCalled()

    await wrapper.get("#assign-owner-email").setValue("redaktor@altera.test")
    expect(confirm().attributes("disabled")).toBeUndefined()
    await confirm().trigger("click")

    expect(assignOwner).toHaveBeenCalledWith({ id: "staff-editor" })
  })

  it("переносит выбранный фильтр обратно в адрес", async () => {
    setup()
    const wrapper = mount(AdminsPage, { global: { stubs } })

    const statusSelect = wrapper.findAll("select")[1]!
    await statusSelect.setValue("archived")
    await Promise.resolve()

    expect(routerReplace).toHaveBeenCalledWith({ query: { status: "archived" } })
  })

  it("открывает карточку по клику в списке", async () => {
    setup()
    const wrapper = mount(AdminsPage, { global: { stubs } })

    await wrapper.get("tbody tr").trigger("click")

    expect(openCard).toHaveBeenCalledWith("staff-editor")
  })
})
