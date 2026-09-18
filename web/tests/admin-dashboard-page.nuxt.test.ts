// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AdminDashboardPage from "../app/pages/admin/index.vue"

const messages: Record<string, string> = {
  "admin.summary.title": "Сводка",
  "admin.summary.empty": "Данных пока нет",
  "admin.summary.refresh": "Обновить",
  "admin.summary.cardError": "Не удалось загрузить",
  "admin.cards.growth.title": "Рост",
  "admin.cards.health.title": "Здоровье",
  "admin.metrics.registrations": "Регистрации",
  "admin.metrics.errors": "Ошибки"
}

const t = (key: string) => messages[key] ?? key
const summary = ref<unknown>(null)
const loading = ref(false)
const failed = ref(false)
const requestId = ref<string | null>(null)
const refresh = vi.fn()
const panelStub = {
  props: ["loading", "error"],
  template: '<div data-panel :data-error="error"><slot /></div>'
}

beforeEach(() => {
  summary.value = null
  loading.value = false
  failed.value = false
  requestId.value = null
  refresh.mockReset()
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useI18n", () => ({ t }))
  vi.stubGlobal("useRoute", () => ({ query: {} }))
  vi.stubGlobal("useAdminDashboard", () => ({ summary, loading, failed, requestId, refresh }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("admin dashboard page", () => {
  it("renders only the cards returned by the role-filtered server response", () => {
    summary.value = {
      role: "analyst",
      cards: [
        {
          id: "growth",
          href: "/admin/statistics",
          status: "READY",
          requestId: null,
          metrics: [{ id: "registrations", value: 12 }]
        }
      ]
    }

    const wrapper = mount(AdminDashboardPage, {
      global: {
        stubs: {
          AppListPanel: panelStub,
          NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' }
        }
      }
    })

    expect(wrapper.get('[data-admin-card="growth"]').text()).toContain("Регистрации")
    expect(wrapper.get('[data-admin-card="growth"]').text()).toContain("12")
    expect(wrapper.find('[data-admin-card="health"]').exists()).toBe(false)
  })

  it("shows the role empty state when the server returns no non-zero cards", () => {
    summary.value = { role: "editor", cards: [] }

    const wrapper = mount(AdminDashboardPage, { global: { stubs: { AppListPanel: panelStub, NuxtLink: true } } })

    expect(wrapper.get("[data-admin-empty]").text()).toContain("Данных пока нет")
  })

  it("keeps ready cards visible beside a failed card and its requestId", () => {
    summary.value = {
      role: "admin",
      cards: [
        {
          id: "growth",
          href: "/admin/statistics",
          status: "READY",
          requestId: null,
          metrics: [{ id: "registrations", value: 3 }]
        },
        {
          id: "health",
          href: "/admin/errors",
          status: "ERROR",
          requestId: "req-safe",
          metrics: []
        }
      ]
    }

    const wrapper = mount(AdminDashboardPage, {
      global: {
        stubs: {
          AppListPanel: panelStub,
          NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' }
        }
      }
    })

    expect(wrapper.get('[data-admin-card="growth"]').text()).toContain("3")
    expect(wrapper.get('[data-admin-card="health"]').text()).toContain("Не удалось загрузить")
    expect(wrapper.get('[data-admin-card="health"]').text()).toContain("req-safe")
  })

  it("shows the error state when the whole request fails without a requestId", () => {
    summary.value = { role: "admin", cards: [] }
    failed.value = true

    const wrapper = mount(AdminDashboardPage, { global: { stubs: { AppListPanel: panelStub, NuxtLink: true } } })

    expect(wrapper.get("[data-panel]").attributes("data-error")).toBe("true")
  })
})
