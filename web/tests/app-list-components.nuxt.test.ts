// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AppListPanel from "../app/components/AppListPanel.vue"
import AppTable from "../app/components/AppTable.vue"

vi.mock("fishtvue/table", () => ({
  default: { template: '<section data-fisht-table><slot name="empty" /></section>' }
}))

const messages: Record<string, string> = {
  "admin.table.empty": "No data",
  "admin.table.emptyDesc": "No records yet",
  "common.loadError": "Could not load data"
}

beforeEach(() => {
  vi.stubGlobal("useI18n", () => ({ t: (key: string) => messages[key] ?? key }))
})

describe("AppTable", () => {
  it("shows the localized empty state when the caller does not provide one", () => {
    const wrapper = mount(AppTable)

    expect(wrapper.get("[data-app-table-empty]").text()).toContain("No data")
    expect(wrapper.get("[data-app-table-empty]").text()).toContain("No records yet")
  })

  it("allows a caller to replace the default empty state", () => {
    const wrapper = mount(AppTable, {
      slots: { empty: "<p data-custom-empty>Nothing here</p>" }
    })

    expect(wrapper.get("[data-custom-empty]").text()).toBe("Nothing here")
    expect(wrapper.find("[data-app-table-empty]").exists()).toBe(false)
  })
})

describe("AppListPanel", () => {
  const Loading = { template: "<span data-loading-spinner />" }

  it("shows the themed error banner above list content", () => {
    const wrapper = mount(AppListPanel, {
      props: { error: true },
      slots: { default: "<div data-list-content />" },
      global: { stubs: { Loading } }
    })

    const banner = wrapper.get('[role="alert"]')
    expect(banner.text()).toBe("Could not load data")
    expect(banner.classes()).toEqual(
      expect.arrayContaining([
        "dark:border-[var(--color-error-800)]",
        "dark:bg-[var(--color-error-950)]",
        "dark:text-[var(--color-error-300)]"
      ])
    )
    expect(banner.element.compareDocumentPosition(wrapper.get("[data-list-content]").element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  it("covers list content with the shared loading overlay", () => {
    const wrapper = mount(AppListPanel, {
      props: { loading: true },
      slots: { default: "<div data-list-content />" },
      global: { stubs: { Loading } }
    })

    const overlay = wrapper.get("[data-list-loading]")
    expect(overlay.classes()).toEqual(expect.arrayContaining(["absolute", "inset-0", "backdrop-blur-2xl", "z-10"]))
    expect(overlay.get("[data-loading-spinner]").exists()).toBe(true)
  })
})
