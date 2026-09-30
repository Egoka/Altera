// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { computed, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AdminAiListPage from "../app/pages/admin/ai/index.vue"
import AdminAiCardPage from "../app/pages/admin/ai/[id].vue"

/**
 * T-078: all state rows from `docs/spec/40-admin/ai-processes.md` and the contract that process
 * rows/cards never expose cost. The browser test exercises the same access rules on a live API.
 */
const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key

const items = ref<Record<string, unknown>[]>([])
const pagination = ref<Record<string, unknown> | null>(null)
const viewerRole = ref("analyst")
const loading = ref(false)
const listFailure = ref<Record<string, string | null> | null>(null)
const statsFailure = ref<Record<string, string | null> | null>(null)
const cardFailure = ref<Record<string, string | null> | null>(null)
const stats = ref<Record<string, unknown> | null>(null)
const card = ref<Record<string, unknown> | null>(null)
const query = ref<Record<string, string>>({})

const nuxtLink = { props: ["to"], template: '<a :href="to"><slot /></a>' }

const processRow = (status: string, overrides: Record<string, unknown> = {}) => ({
  id: `process-${status}`,
  kind: "check",
  status,
  verdict: status === "completed" ? "pass" : null,
  object: {
    id: "translation-1",
    type: "ArticleTranslation",
    title: "Тестовый материал",
    subtitle: "ru",
    href: "/admin/articles/article-1"
  },
  reasons: [],
  providerErrorClass: status === "failed" ? "PROVIDER_UNAVAILABLE" : null,
  model: "test-model",
  promptVersion: "v3",
  createdAt: "2026-09-29T10:00:00.000Z",
  startedAt: status === "created" ? null : "2026-09-29T10:00:01.000Z",
  finishedAt: ["completed", "failed"].includes(status) ? "2026-09-29T10:00:03.000Z" : null,
  durationMs: ["completed", "failed"].includes(status) ? 2000 : null,
  jobHref: "/admin/jobs/job-1",
  ...overrides
})

beforeEach(() => {
  items.value = ["created", "started", "running", "completed", "failed"].map((status) => processRow(status))
  pagination.value = {
    currentPage: 1,
    totalPages: 1,
    totalItems: 5,
    itemsPerPage: 20,
    hasNextPage: false,
    hasPreviousPage: false
  }
  viewerRole.value = "analyst"
  loading.value = false
  listFailure.value = null
  statsFailure.value = null
  cardFailure.value = null
  stats.value = {
    processCount: 5,
    totalCostMinor: "1842",
    medianDurationMs: 2000,
    planSharePercent: null,
    kinds: [{ kind: "check", count: 5 }],
    statuses: [{ status: "completed", count: 1 }],
    rejectionReasons: [{ category: "spam", count: 1, share: 0.2 }],
    providerErrors: 1,
    periodFrom: "2026-09-22T10:00:00.000Z",
    periodTo: "2026-09-29T10:00:00.000Z"
  }
  card.value = processRow("failed", {
    reasons: [{ category: "provider", text: "Timeout" }]
  })
  query.value = {}

  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useI18n", () => ({ t }))
  vi.stubGlobal("useRoute", () => ({ query: query.value, params: { id: "process-failed" } }))
  vi.stubGlobal("useRouter", () => ({ replace: vi.fn() }))
  vi.stubGlobal("useAdminDashboard", () => ({ summary: ref({ role: viewerRole.value }) }))
  vi.stubGlobal("useAdminAiProcesses", () => ({
    items: computed(() => items.value),
    pagination: computed(() => pagination.value),
    viewerRole: computed(() => viewerRole.value),
    stats,
    card,
    loading,
    listFailure,
    statsFailure,
    cardFailure,
    refresh: vi.fn(),
    openCard: vi.fn()
  }))
})

afterEach(() => vi.unstubAllGlobals())

const mountList = () => mount(AdminAiListPage, { global: { stubs: { NuxtLink: nuxtLink } } })
const mountCard = () => mount(AdminAiCardPage, { global: { stubs: { NuxtLink: nuxtLink } } })

describe("AI process list", () => {
  it("renders all five process states without action controls", () => {
    const wrapper = mountList()

    for (const status of ["created", "started", "running", "completed", "failed"]) {
      expect(wrapper.get(`[data-ai-status="${status}"]`).exists()).toBe(true)
    }
    expect(wrapper.find("[data-ai-action]").exists()).toBe(false)
    expect(wrapper.find("[data-ai-readonly-note]").exists()).toBe(true)
  })

  it("renders loading, empty, and requestId error rows", () => {
    loading.value = true
    expect(mountList().get('[data-ai-state="loading"]').attributes("aria-busy")).toBe("true")

    loading.value = false
    items.value = []
    expect(mountList().find('[data-ai-state="empty"]').exists()).toBe(true)

    listFailure.value = { code: "INTERNAL_ERROR", requestId: "req-ai-1" }
    expect(mountList().get('[data-ai-state="error"]').text()).toContain("req-ai-1")
  })

  it("shows aggregate cost only on statistics and hides statistics from moderator", () => {
    query.value = { tab: "stats" }
    const analyst = mountList()

    expect(analyst.get("[data-ai-total-cost]").text()).toContain("1842")
    expect(analyst.find("[data-ai-row-cost]").exists()).toBe(false)

    viewerRole.value = "moderator"
    const moderator = mountList()
    expect(moderator.find('[data-ai-tab="stats"]').exists()).toBe(false)
    expect(moderator.find("[data-ai-total-cost]").exists()).toBe(false)
  })
})

describe("AI process card", () => {
  it("shows diagnostic fields but never an individual cost", () => {
    const wrapper = mountCard()

    expect(wrapper.get('[data-ai-card="process-failed"]').text()).toContain("PROVIDER_UNAVAILABLE")
    expect(wrapper.get("[data-ai-card-reasons]").text()).toContain("Timeout")
    expect(wrapper.find("[data-ai-card-cost]").exists()).toBe(false)
    expect(wrapper.find("[data-ai-action]").exists()).toBe(false)
  })

  it("renders card error with requestId", () => {
    cardFailure.value = { code: "INTERNAL_ERROR", requestId: "req-ai-card-1" }
    card.value = null

    expect(mountCard().get('[data-ai-card-state="error"]').text()).toContain("req-ai-card-1")
  })
})
