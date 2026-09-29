// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { computed, nextTick, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import StatisticsPage from "../app/pages/admin/statistics/index.vue"
import {
  defaultStatisticsQueryState,
  parseStatisticsQueryState,
  statisticsQueryToRoute
} from "../app/composables/useAdminStatistics"
import ru from "../i18n/locales/ru.json"

const messages = ru as unknown as Record<string, unknown>
const translate = (key: string, values: Record<string, unknown> = {}) => {
  const resolved = key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object") return (node as Record<string, unknown>)[part]
    return undefined
  }, messages)
  const text = typeof resolved === "string" ? resolved : key
  return text.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? ""))
}

const growth = ref<Record<string, unknown> | null>(null)
const content = ref<Record<string, unknown> | null>(null)
const ai = ref<Record<string, unknown> | null>(null)
const loading = ref(false)
const failure = ref<{ code: string | null; requestId: string | null } | null>(null)
const retryAfter = ref<number | null>(null)
const routeQuery = ref<Record<string, unknown>>({})
const load = vi.fn()
const exportCsv = vi.fn()

const mountPage = () =>
  mount(StatisticsPage, {
    global: {
      stubs: {
        NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' }
      }
    }
  })

beforeEach(() => {
  growth.value = {
    range: { from: "2026-08-31T12:00:00.000Z", to: "2026-09-29T12:00:00.000Z" },
    registrations: 12,
    activeAccounts: 8,
    enabledAuthors: 5,
    authorsWithPublications: 3,
    daily: [{ date: "2026-09-12", registrations: 2, publications: 1 }]
  }
  content.value = {
    range: { from: "2026-08-31T12:00:00.000Z", to: "2026-09-29T12:00:00.000Z" },
    publications: 4,
    drafts: 6,
    queueSize: 2,
    oldestQueueAgeHours: 18,
    medianDecisionHours: 9.5,
    rejectionRate: 0.25,
    manualOverrideRate: 0.5,
    byLocale: [
      { key: "en", count: 1 },
      { key: "ru", count: 3 }
    ],
    bySection: [{ key: "culture", label: "Культура", count: 4 }],
    topAuthors: [
      { id: "author-1", name: "Анна Автор", handle: "anna", publications: 4, qualifiedReads: null, saves: 2 }
    ],
    topArticles: [
      {
        id: "article-1",
        slug: "first",
        title: "Первый материал",
        authorId: "author-1",
        authorName: "Анна Автор",
        publications: 1,
        qualifiedReads: null,
        saves: 2,
        totalScore: null
      }
    ]
  }
  ai.value = {
    range: { from: "2026-08-31T12:00:00.000Z", to: "2026-09-29T12:00:00.000Z" },
    total: 9,
    failed: 2,
    failureRate: 2 / 9,
    averageDurationMs: 2_500,
    costMinor: "840",
    byKind: [{ key: "check", count: 9 }],
    byStatus: [
      { key: "completed", count: 7 },
      { key: "failed", count: 2 }
    ]
  }
  loading.value = false
  failure.value = null
  retryAfter.value = null
  routeQuery.value = {}
  load.mockReset()
  exportCsv.mockReset()
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useI18n", () => ({ t: translate }))
  vi.stubGlobal("useRoute", () => ({
    get query() {
      return routeQuery.value
    }
  }))
  vi.stubGlobal("navigateTo", vi.fn())
  vi.stubGlobal("useAdminStatistics", () => ({
    growth,
    content,
    ai,
    loading,
    failure,
    retryAfter,
    load,
    exportCsv
  }))
  vi.stubGlobal("computed", computed)
  vi.stubGlobal("ref", ref)
})

afterEach(() => vi.unstubAllGlobals())

describe("адрес раздела статистики", () => {
  it("по умолчанию открывает рост за 30 дней", () => {
    expect(parseStatisticsQueryState({})).toEqual(defaultStatisticsQueryState())
  })

  it("сохраняет вкладку, период, даты и фильтры в адресе", () => {
    const state = parseStatisticsQueryState({
      tab: "content",
      period: "custom",
      from: "2026-09-01",
      to: "2026-09-28",
      section: "culture",
      locale: "ru"
    })

    expect(statisticsQueryToRoute(state)).toEqual({
      tab: "content",
      period: "custom",
      from: "2026-09-01",
      to: "2026-09-28",
      section: "culture",
      locale: "ru"
    })
  })
})

describe("состояния раздела статистики", () => {
  it("загружает начальное состояние и повторяет запрос после изменения URL", async () => {
    mountPage()

    expect(load).toHaveBeenCalledWith(defaultStatisticsQueryState())
    routeQuery.value = { tab: "ai", period: "7d" }
    await nextTick()

    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ tab: "ai", period: "7d" }))
  })

  it("показывает скелеты при загрузке", () => {
    loading.value = true
    const wrapper = mountPage()

    expect(wrapper.find("[data-statistics-loading]").exists()).toBe(true)
  })

  it("показывает точные числа роста и дневную ленту", () => {
    const wrapper = mountPage()

    expect(wrapper.get('[data-statistic="registrations"]').text()).toContain("12")
    expect(wrapper.get('[data-statistics-day="2026-09-12"]').text()).toContain("2")
  })

  it("показывает фильтры рубрики и языка на вкладке контента", () => {
    routeQuery.value = { tab: "content" }
    const wrapper = mountPage()

    expect(wrapper.get('[data-statistics-filter="section"]').text()).toContain("Культура")
    expect(wrapper.get('[data-statistics-filter="locale"]').findAll("option")).toHaveLength(3)
  })

  it("показывает нули и пояснение для пустого периода", () => {
    growth.value = {
      ...(growth.value ?? {}),
      registrations: 0,
      activeAccounts: 0,
      enabledAuthors: 0,
      authorsWithPublications: 0,
      daily: []
    }
    const wrapper = mountPage()

    expect(wrapper.find("[data-statistics-empty]").exists()).toBe(true)
    expect(wrapper.get('[data-statistic="registrations"]').text()).toContain("0")
  })

  it("показывает ErrorState с requestId", () => {
    failure.value = { code: "INTERNAL_ERROR", requestId: "req-stats" }
    const wrapper = mountPage()

    expect(wrapper.get("[data-statistics-error]").text()).toContain("requestId: req-stats")
  })

  it.each(["engagement", "finance", "ranking"])("показывает пояснение будущего этапа для %s", (tab) => {
    routeQuery.value = { tab }
    const wrapper = mountPage()

    expect(wrapper.get("[data-statistics-placeholder]").exists()).toBe(true)
  })

  it("показывает таймер лимита экспорта", () => {
    retryAfter.value = 1800
    const wrapper = mountPage()

    expect(wrapper.get("[data-statistics-rate-limit]").text()).toContain("30")
  })
})
