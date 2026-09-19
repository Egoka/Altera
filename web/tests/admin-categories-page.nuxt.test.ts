// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { ref } from "vue"
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
    _count: { articles: 4 }
  },
  {
    id: "science",
    name: "Наука",
    nameEn: "Science",
    slug: "science",
    order: 2,
    status: "active",
    _count: { articles: 2 }
  }
])
const formats = ref([{ id: "essay", name: "Эссе", slug: "essay", status: "active", _count: { articles: 3 } }])
const loading = ref(false)
const failed = ref(false)
const requestId = ref<string | null>(null)
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
  requestId.value = null
  vi.clearAllMocks()
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useRoute", () => ({ query: {} }))
  vi.stubGlobal("navigateTo", vi.fn())
  vi.stubGlobal("useI18n", () => ({ t: (key: string) => key }))
  vi.stubGlobal("useAdminCategories", () => ({
    sections,
    formats,
    loading,
    failed,
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

  it("keeps a safe requestId visible when loading fails", () => {
    failed.value = true
    requestId.value = "req-safe"

    const wrapper = mount(AdminCategoriesPage)

    expect(wrapper.get('[role="alert"]').text()).toContain("req-safe")
  })
})
