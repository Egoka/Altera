// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { computed, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AdminCategoriesPage from "../app/pages/admin/categories/index.vue"

const sections = ref([
  {
    id: "culture",
    name: "Культура",
    nameEn: "Culture",
    slug: "culture",
    order: 1,
    status: "active",
    updatedAt: "2026-09-26T12:00:00.000Z",
    _count: { articles: 4 }
  },
  {
    id: "science",
    name: "Наука",
    nameEn: "Science",
    slug: "science",
    order: 2,
    status: "active",
    updatedAt: "2026-09-26T12:00:00.000Z",
    _count: { articles: 2 }
  },
  {
    id: "owner-archive",
    name: "Архив владельца",
    nameEn: "Owner archive",
    slug: "owner-archive",
    order: 3,
    status: "archived",
    archivedByRole: "owner",
    updatedAt: "2026-09-26T12:00:00.000Z",
    _count: { articles: 0 }
  },
  {
    id: "admin-archive",
    name: "Архив админа",
    nameEn: "Admin archive",
    slug: "admin-archive",
    order: 4,
    status: "archived",
    archivedByRole: "admin",
    updatedAt: "2026-09-26T12:00:00.000Z",
    _count: { articles: 0 }
  }
])
const formats = ref([{ id: "essay", name: "Эссе", slug: "essay", status: "active", _count: { articles: 3 } }])
const loading = ref(false)
const failed = ref(false)
const conflict = ref(false)
const forbidden = ref(false)
const requestId = ref<string | null>(null)
const role = ref("admin")
const saveSection = vi.fn()
const archiveSection = vi.fn()
const restoreSection = vi.fn()
const moveSection = vi.fn()
const saveFormat = vi.fn()
const archiveFormat = vi.fn()
const restoreFormat = vi.fn()
const loadAudit = vi.fn().mockResolvedValue([])

beforeEach(() => {
  failed.value = false
  conflict.value = false
  forbidden.value = false
  requestId.value = null
  role.value = "admin"
  vi.clearAllMocks()
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useRoute", () => ({ query: {}, path: "/admin/sections" }))
  vi.stubGlobal("navigateTo", vi.fn())
  vi.stubGlobal("useI18n", () => ({ t: (key: string) => key }))
  vi.stubGlobal("useAdminDashboard", () => ({ summary: computed(() => ({ role: role.value })) }))
  vi.stubGlobal("useAdminCategories", () => ({
    sections,
    formats,
    loading,
    failed,
    conflict,
    forbidden,
    requestId,
    refresh: vi.fn(),
    saveSection,
    archiveSection,
    restoreSection,
    moveSection,
    saveFormat,
    archiveFormat,
    restoreFormat,
    loadAudit
  }))
})

afterEach(() => vi.unstubAllGlobals())

describe("admin categories page", () => {
  it("shows section and format workspaces with material counts", () => {
    const wrapper = mount(AdminCategoriesPage)

    expect(wrapper.get('[data-taxonomy-tab="sections"]').text()).toContain("categories.tabs.sections")
    expect(wrapper.get('[data-taxonomy-row="culture"]').text()).toContain("4")
    expect(wrapper.get('[data-taxonomy-tab="formats"]').exists()).toBe(true)
  })

  it("requires an active successor before archiving a section", async () => {
    const wrapper = mount(AdminCategoriesPage)

    await wrapper.get('[data-archive-section="culture"]').trigger("click")
    const confirm = wrapper.get("[data-confirm-archive-section]")
    expect(confirm.attributes("disabled")).toBeDefined()
    await wrapper.get("[data-successor-select]").setValue("science")
    await wrapper.get("[data-archive-reason]").setValue("Объединение рубрик")
    await confirm.trigger("click")

    expect(archiveSection).toHaveBeenCalledWith("culture", "science", "Объединение рубрик")
  })

  // T-132 §9 «Нет прав на часть действий»: архив владельца недоступен роли ниже.
  it("hides section restore from an admin when the owner archived it", () => {
    const wrapper = mount(AdminCategoriesPage)

    expect(wrapper.find('[data-restore-section="owner-archive"]').exists()).toBe(false)
    expect(wrapper.get('[data-no-restore-section="owner-archive"]').text()).toContain("categories.ownerArchiveNote")
    expect(wrapper.get('[data-restore-section="admin-archive"]').exists()).toBe(true)
  })

  it("lets the owner restore an archive made by the owner", () => {
    role.value = "owner"

    const wrapper = mount(AdminCategoriesPage)

    expect(wrapper.get('[data-restore-section="owner-archive"]').exists()).toBe(true)
    expect(wrapper.find('[data-no-restore-section="owner-archive"]').exists()).toBe(false)
  })

  // T-132 §9 «Конфликт»: правка поверх новой версии и архивированный преемник.
  it("sends the card version with a section edit and keeps the form after a conflict", async () => {
    saveSection.mockImplementation(async () => {
      conflict.value = true
      requestId.value = "req-conflict"
      throw new Error("CONFLICT")
    })
    const wrapper = mount(AdminCategoriesPage)

    await wrapper.get('[data-edit-section="culture"]').trigger("click")
    await wrapper.get("[data-taxonomy-editor] form").trigger("submit")

    expect(saveSection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "culture", name: "Культура", updatedAt: "2026-09-26T12:00:00.000Z" })
    )
    // Форма остаётся открытой с введённым текстом, рядом — пояснение конфликта.
    expect(wrapper.get("[data-taxonomy-editor]").attributes("open")).toBeDefined()
    expect(wrapper.get("[data-taxonomy-editor] input[required]").element).toHaveProperty("value", "Культура")
    expect(wrapper.get("[data-taxonomy-conflict]").text()).toContain("categories.conflict")
    expect(wrapper.get("[data-taxonomy-conflict]").text()).toContain("req-conflict")
  })

  it("asks for another successor when archiving hits a conflict", async () => {
    archiveSection.mockImplementation(async () => {
      conflict.value = true
      throw new Error("CONFLICT")
    })
    const wrapper = mount(AdminCategoriesPage)

    await wrapper.get('[data-archive-section="culture"]').trigger("click")
    await wrapper.get("[data-successor-select]").setValue("science")
    await wrapper.get("[data-archive-reason]").setValue("Объединение рубрик")
    await wrapper.get("[data-confirm-archive-section]").trigger("click")
    await wrapper.vm.$nextTick()

    expect(wrapper.get("[data-taxonomy-conflict]").text()).toContain("categories.conflictSuccessor")
    // Выбор преемника сброшен: подтверждение снова недоступно, пока не выбран другой.
    expect(wrapper.get("[data-confirm-archive-section]").attributes("disabled")).toBeDefined()
  })

  it("shows the forbidden state without dropping the catalogue", async () => {
    forbidden.value = true
    const wrapper = mount(AdminCategoriesPage)

    expect(wrapper.get("[data-taxonomy-forbidden]").text()).toContain("categories.forbidden")
    expect(wrapper.get('[data-taxonomy-row="culture"]').exists()).toBe(true)
  })

  it("keeps a safe requestId visible when loading fails", () => {
    failed.value = true
    requestId.value = "req-safe"

    const wrapper = mount(AdminCategoriesPage)

    expect(wrapper.get('[role="alert"]').text()).toContain("req-safe")
  })
})
