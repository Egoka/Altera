// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AdminAuditPage from "../app/pages/admin/audit/index.vue"

interface AuditRowFixture {
  id: string
  action: string
  createdAt: string
  actor: { id: string | null; role: string | null; name: string | null; isSystem: boolean }
  entityType: string
  entityId: string
  requestId: string | null
  zones: string[]
  changedFields: string[]
}

const row = (overrides: Partial<AuditRowFixture> = {}): AuditRowFixture => ({
  id: "audit-1",
  action: "translation.unpublish",
  createdAt: "2026-09-20T10:00:00.000Z",
  actor: { id: "moderator-1", role: "moderator", name: "Мод", isSystem: false },
  entityType: "articleTranslation",
  entityId: "translation-1",
  requestId: "req-1",
  zones: ["moderation"],
  changedFields: ["reason"],
  ...overrides
})

const entries = ref<AuditRowFixture[]>([])
const page = ref<Record<string, unknown> | null>(null)
const summary = ref<Record<string, unknown> | null>(null)
const pending = ref(false)
const failed = ref(false)
const requestId = ref<string | null>(null)
const rateLimitRetryAfter = ref<number | null>(null)
const detailEntry = ref<Record<string, unknown> | null>(null)
const load = vi.fn()
const loadMore = vi.fn()
const openEntry = vi.fn()
const exportCsv = vi.fn()

const fullJournalPage = {
  nextCursor: null,
  zone: null,
  canExport: true,
  availableActions: ["stats.export", "translation.unpublish"]
}

beforeEach(() => {
  entries.value = []
  page.value = null
  summary.value = null
  pending.value = false
  failed.value = false
  requestId.value = null
  rateLimitRetryAfter.value = null
  detailEntry.value = null
  vi.clearAllMocks()
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useRoute", () => ({ query: {} }))
  vi.stubGlobal("navigateTo", vi.fn())
  vi.stubGlobal("createError", (options: unknown) => Object.assign(new Error("nuxt-error"), options))
  vi.stubGlobal("useI18n", () => ({ t: (key: string) => key }))
  vi.stubGlobal("useAsyncData", () => ({ data: detailEntry, error: ref(null) }))
  vi.stubGlobal("useAdminAudit", () => ({
    entries,
    page,
    summary,
    pending,
    failed,
    requestId,
    rateLimitRetryAfter,
    load,
    loadMore,
    openEntry,
    exportCsv
  }))
})

afterEach(() => vi.unstubAllGlobals())

// Страница асинхронна (запись читается на сервере), поэтому монтируется внутри Suspense.
const render = async () => {
  const wrapper = mount(
    { components: { AdminAuditPage }, template: "<Suspense><AdminAuditPage /></Suspense>" },
    { global: { stubs: { NuxtLink: { template: "<a><slot /></a>" } } } }
  )
  await flushPromises()
  return wrapper
}

describe("страница аудита", () => {
  it("показывает скелеты, пока список загружается", async () => {
    pending.value = true

    const wrapper = await render()

    expect(wrapper.find("[data-audit-loading]").exists()).toBe(true)
    expect(wrapper.find("[data-audit-loading]").attributes("aria-busy")).toBe("true")
  })

  it("показывает пустое состояние, когда записей по фильтру нет", async () => {
    page.value = { ...fullJournalPage }

    const wrapper = await render()

    expect(wrapper.find("[data-audit-empty]").text()).toContain("admin.audit.empty")
  })

  it("показывает ошибку с requestId", async () => {
    failed.value = true
    requestId.value = "req-broken"

    const wrapper = await render()

    const error = wrapper.find("[data-audit-error]")
    expect(error.attributes("role")).toBe("alert")
    expect(error.text()).toContain("req-broken")
  })

  it("у служебной роли своей зоны нет ни кнопки экспорта, ни выбора зоны", async () => {
    page.value = { ...fullJournalPage, zone: "moderation", canExport: false }
    entries.value = [row()]

    const wrapper = await render()

    expect(wrapper.find("[data-audit-export]").exists()).toBe(false)
    expect(wrapper.find("[data-audit-filter-zone]").exists()).toBe(false)
    expect(wrapper.find("[data-audit-scope]").text()).toContain("admin.audit.scope.moderation")
  })

  it("admin видит полный журнал, выбор зоны и экспорт с подтверждением про ПД", async () => {
    page.value = { ...fullJournalPage }
    entries.value = [row()]

    const wrapper = await render()

    expect(wrapper.find("[data-audit-scope]").text()).toContain("admin.audit.scopeFull")
    expect(wrapper.find("[data-audit-filter-zone]").exists()).toBe(true)
    await wrapper.find("[data-audit-export]").trigger("click")
    expect(wrapper.find("[data-audit-export-confirm]").text()).toContain("admin.audit.exportConfirmText")

    await wrapper.find("[data-audit-export-confirm-button]").trigger("click")
    expect(exportCsv).toHaveBeenCalledOnce()
  })

  it("сообщает о превышении лимита экспорта кодом RATE_LIMITED", async () => {
    page.value = { ...fullJournalPage }
    entries.value = [row()]
    rateLimitRetryAfter.value = 1800

    const wrapper = await render()

    const alert = wrapper.find("[data-audit-rate-limited]")
    expect(alert.attributes("role")).toBe("alert")
    expect(alert.text()).toContain("RATE_LIMITED")
  })

  it("показывает автоматическую запись как «система» и предлагает следующую страницу", async () => {
    page.value = { ...fullJournalPage, nextCursor: "2026-09-20T10:00:00.000Z|audit-1" }
    entries.value = [row({ actor: { id: null, role: null, name: null, isSystem: true }, action: "ai.decision" })]

    const wrapper = await render()

    expect(wrapper.find('[data-audit-row="audit-1"]').text()).toContain("admin.audit.systemActor")
    await wrapper.find("[data-audit-more]").trigger("click")
    expect(loadMore).toHaveBeenCalledOnce()
  })

  it("в карточке записи показывает субъект, контекст, цель и поля diff", async () => {
    page.value = { ...fullJournalPage }
    entries.value = [row()]
    detailEntry.value = {
      ...row({ action: "admin.read.personal", actor: { id: "a-1", role: "analyst", name: "Ана", isSystem: false } }),
      entityType: "user",
      entityId: "user-42",
      subject: "user-42",
      context: "/admin/users/user-42",
      purpose: "user.card.open",
      diff: { before: "reader", after: "author" }
    }

    const wrapper = await render()

    const detail = wrapper.find("[data-audit-detail]")
    expect(detail.text()).toContain("user-42")
    expect(detail.text()).toContain("user.card.open")
    expect(wrapper.find("[data-audit-detail-diff]").text()).toContain("before: reader")
    expect(wrapper.find("[data-audit-entity-link]").exists()).toBe(true)
  })
})
