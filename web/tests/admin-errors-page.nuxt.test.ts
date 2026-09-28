// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AdminErrorsPage from "../app/pages/admin/errors/index.vue"

const items = ref<Record<string, unknown>[]>([])
const pagination = ref<Record<string, unknown> | null>(null)
const stats = ref<Record<string, unknown> | null>(null)
const health = ref<Record<string, unknown>[]>([])
const pending = ref(false)
const failed = ref(false)
const requestId = ref<string | null>(null)
const errorCode = ref<string | null>(null)
const rateLimitRetryAfter = ref<number | null>(null)
const load = vi.fn()
const loadStats = vi.fn()
const loadHealth = vi.fn()
const resolveMany = vi.fn()
const exportCsv = vi.fn()
let routeQuery: Record<string, string> = {}

beforeEach(() => {
  items.value = []
  pagination.value = null
  stats.value = null
  health.value = []
  pending.value = false
  failed.value = false
  requestId.value = null
  errorCode.value = null
  rateLimitRetryAfter.value = null
  routeQuery = {}
  vi.clearAllMocks()
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useRoute", () => ({ query: routeQuery }))
  vi.stubGlobal("useRouter", () => ({ replace: vi.fn() }))
  vi.stubGlobal("useState", (_key: string, init: () => string) => ref(init()))
  vi.stubGlobal("useI18n", () => ({ t: (key: string) => key }))
  vi.stubGlobal("useAsyncData", async (_key: string, handler: () => Promise<unknown>) => {
    await handler()
    return { status: ref("success"), refresh: vi.fn() }
  })
  vi.stubGlobal("useAdminErrors", () => ({
    items,
    pagination,
    stats,
    health,
    pending,
    failed,
    requestId,
    errorCode,
    rateLimitRetryAfter,
    load,
    loadStats,
    loadHealth,
    resolveMany,
    exportCsv
  }))
})

afterEach(() => vi.unstubAllGlobals())

const render = async () => {
  const wrapper = mount(
    { components: { AdminErrorsPage }, template: "<Suspense><AdminErrorsPage /></Suspense>" },
    { global: { stubs: { NuxtLink: { template: "<a><slot /></a>" }, Icons: true } } }
  )
  await flushPromises()
  return wrapper
}

describe("страница ошибок и состояния", () => {
  it("показывает загрузку, пустое состояние и ошибку с requestId", async () => {
    pending.value = true
    let wrapper = await render()
    expect(wrapper.find("[data-errors-loading]").attributes("aria-busy")).toBe("true")

    pending.value = false
    pagination.value = { totalItems: 0, totalPages: 0 }
    wrapper = await render()
    expect(wrapper.find("[data-errors-empty]").text()).toContain("admin.errors.empty")

    failed.value = true
    requestId.value = "req-t081"
    wrapper = await render()
    expect(wrapper.find("[data-errors-error]").text()).toContain("req-t081")
  })

  it("показывает деградировавшую зависимость в ленте здоровья", async () => {
    health.value = [
      {
        id: "health-1",
        status: "degraded",
        checkedAt: "2026-09-28T10:00:00.000Z",
        components: [{ name: "storage", status: "down", adapter: "local", latencyMs: null }],
        backups: []
      }
    ]
    pagination.value = { totalItems: 0, totalPages: 0 }

    const wrapper = await render()

    expect(wrapper.find("[data-health-pulse]").text()).toContain("storage")
    expect(wrapper.find("[data-health-degraded]").exists()).toBe(true)
  })

  it("не считает исправные и отключённые компоненты деградировавшими", async () => {
    health.value = [
      {
        id: "health-ok",
        status: "ok",
        checkedAt: "2026-09-28T10:00:00.000Z",
        components: [
          { name: "db", status: "up", adapter: "postgres", latencyMs: 3 },
          { name: "redis", status: "disabled", adapter: "disabled", latencyMs: null }
        ],
        backups: []
      }
    ]
    pagination.value = { totalItems: 0, totalPages: 0 }

    const wrapper = await render()

    expect(wrapper.find("[data-health-degraded]").exists()).toBe(false)
    expect(wrapper.find("[data-health-pulse]").text()).not.toContain("db ·")
    expect(wrapper.find("[data-health-pulse]").text()).not.toContain("redis ·")
  })

  it("показывает временной ряд и разрез по кодам", async () => {
    routeQuery = { tab: "charts" }
    stats.value = {
      currentTotal: 3,
      previousTotal: 1,
      timeline: [{ bucket: "2026-09-28T10:00:00.000Z", count: 2 }],
      byService: [{ key: "api", count: 3 }],
      byCode: [{ key: "INTERNAL_ERROR", count: 2 }]
    }

    const wrapper = await render()

    expect(wrapper.find("[data-errors-charts]").text()).toContain("INTERNAL_ERROR")
    expect(wrapper.find("[data-errors-charts]").text()).toContain("2")
  })

  it("показывает конфликт и превышение лимита экспорта", async () => {
    errorCode.value = "CONFLICT"
    rateLimitRetryAfter.value = 120
    pagination.value = { totalItems: 0, totalPages: 0 }

    const wrapper = await render()

    expect(wrapper.find("[data-errors-conflict]").text()).toContain("CONFLICT")
    expect(wrapper.find("[data-errors-rate-limited]").text()).toContain("RATE_LIMITED")
  })
})
