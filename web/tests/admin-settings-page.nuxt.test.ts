// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AdminSettingsPage from "../app/pages/admin/settings/index.vue"
import { canReadSystemSettings, parseSystemSettingsGroup } from "../app/utils/admin"

const mail = {
  group: "mail",
  adapter: "smtp",
  canChange: false,
  settings: [
    { key: "SMTP_HOST", source: "ENV", secret: false, configured: true, value: "smtp.altera.example", mask: null },
    { key: "SMTP_PORT", source: "ENV", secret: false, configured: false, value: null, mask: null },
    { key: "SMTP_PASSWORD", source: "ENV", secret: true, configured: true, value: null, mask: "••••••••" }
  ]
}

const settings = ref<Record<string, unknown> | null>(null)
const loading = ref(false)
const failed = ref(false)
const requestId = ref<string | null>(null)
const summary = ref({ role: "admin" })
const load = vi.fn()
const navigate = vi.fn()
let query: Record<string, string> = {}

beforeEach(() => {
  settings.value = mail
  loading.value = false
  failed.value = false
  requestId.value = null
  summary.value = { role: "admin" }
  query = {}
  vi.clearAllMocks()
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useRoute", () => ({ query }))
  vi.stubGlobal("navigateTo", navigate)
  vi.stubGlobal("useI18n", () => ({ t: (key: string) => key }))
  vi.stubGlobal("useAdminDashboard", () => ({ summary }))
  vi.stubGlobal("useAdminSettings", () => ({ settings, loading, failed, requestId, load }))
})

afterEach(() => vi.unstubAllGlobals())

describe("admin settings page", () => {
  it("loads the group from the URL and switches groups through the URL", async () => {
    query = { group: "mail" }
    const wrapper = mount(AdminSettingsPage)
    await flushPromises()

    expect(load).toHaveBeenCalledWith("mail")
    expect(wrapper.get('[data-settings-group="mail"]').attributes("aria-selected")).toBe("true")

    await wrapper.get('[data-settings-group="domains"]').trigger("click")
    await flushPromises()

    expect(navigate).toHaveBeenCalledWith({ path: "/admin/settings", query: { group: "domains" } })
    expect(load).toHaveBeenLastCalledWith("domains")
  })

  it("shows secrets only as a mask and marks missing values", () => {
    const wrapper = mount(AdminSettingsPage)

    expect(wrapper.get('[data-setting="SMTP_HOST"]').text()).toContain("smtp.altera.example")
    expect(wrapper.get('[data-setting="SMTP_PASSWORD"]').text()).toContain("••••••••")
    expect(wrapper.get('[data-setting="SMTP_PORT"]').text()).toContain("admin.systemSettings.notSet")
    expect(wrapper.get("[data-settings-adapter]").text()).toBe("smtp")
  })

  it.each([
    ["admin", "admin.systemSettings.adminNote"],
    ["owner", "admin.systemSettings.ownerNote"]
  ])("explains to %s that changes are unavailable", (role, note) => {
    summary.value = { role }
    const wrapper = mount(AdminSettingsPage)

    expect(wrapper.get("[data-settings-readonly]").text()).toContain("admin.systemSettings.readOnly")
    expect(wrapper.get("[data-settings-permission]").text()).toBe(note)
  })

  it("shows the skeleton while loading", () => {
    loading.value = true
    const wrapper = mount(AdminSettingsPage)

    expect(wrapper.find("[data-settings-loading]").exists()).toBe(true)
    expect(wrapper.find("[data-setting]").exists()).toBe(false)
  })

  it("shows the error with requestId and retries the current group", async () => {
    failed.value = true
    requestId.value = "req-safe"
    const wrapper = mount(AdminSettingsPage)

    expect(wrapper.get("[data-settings-error]").text()).toContain("req-safe")
    await wrapper.get("[data-settings-error] button").trigger("click")
    expect(load).toHaveBeenLastCalledWith("ai")
  })

  it("explains groups whose provider is not connected yet", () => {
    settings.value = { group: "storage", adapter: null, canChange: false, settings: [] }
    const wrapper = mount(AdminSettingsPage)

    expect(wrapper.text()).toContain("admin.systemSettings.adapterMissing")
    expect(wrapper.get("[data-settings-none]").text()).toBe("admin.systemSettings.none.storage")
  })
})

describe("system settings access helpers", () => {
  it.each([
    ["reader", false],
    ["author", false],
    ["editor", false],
    ["moderator", false],
    ["analyst", false],
    ["admin", true],
    ["owner", true]
  ] as const)("lets %s read settings: %s", (role, expected) => {
    expect(canReadSystemSettings(role)).toBe(expected)
  })

  it("falls back to the AI group for an unknown group", () => {
    expect(parseSystemSettingsGroup("limits")).toBe("limits")
    expect(parseSystemSettingsGroup("secrets")).toBe("ai")
    expect(parseSystemSettingsGroup(undefined)).toBe("ai")
  })
})
