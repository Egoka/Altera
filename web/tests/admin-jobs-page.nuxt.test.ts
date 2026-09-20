// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { computed, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import JobsPage from "../app/pages/admin/jobs/index.vue"
import {
  defaultJobsQueryState,
  jobsQueryToRoute,
  parseJobsQueryState,
  readFailure
} from "../app/composables/useAdminJobs"
import ru from "../i18n/locales/ru.json"

const messages = ru as unknown as Record<string, Record<string, unknown>>
const translate = (key: string, values: Record<string, unknown> = {}) => {
  const resolved = key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object") return (node as Record<string, unknown>)[part]
    return undefined
  }, messages)
  const text = typeof resolved === "string" ? resolved : key
  return text.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? ""))
}

const jobRow = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  kind: "ai.check",
  status: "failed",
  objectType: "Article",
  objectId: "article-1",
  createdAt: "2026-09-20T11:00:00.000Z",
  startedAt: "2026-09-20T11:00:10.000Z",
  finishedAt: "2026-09-20T11:00:25.000Z",
  cancelledAt: null,
  attemptCount: 3,
  maxAttempts: 3,
  durationMs: 15_000,
  manualRetryAllowed: true,
  retryable: true,
  cancellable: false,
  lastErrorClass: "ProviderError",
  lastErrorRequestId: "req-failed",
  ...overrides
})

const page = ref<Record<string, unknown> | null>(null)
const summary = ref<Record<string, unknown> | null>(null)
const card = ref<Record<string, unknown> | null>(null)
const loading = ref(false)
const listFailure = ref<{ code: string | null; requestId: string | null } | null>(null)
const summaryFailure = ref<{ code: string | null; requestId: string | null } | null>(null)
const actionFailure = ref<{ code: string | null; requestId: string | null } | null>(null)
const refresh = vi.fn()
const retry = vi.fn()
const cancel = vi.fn()
const retryMany = vi.fn()
const routeQuery = ref<Record<string, unknown>>({})

const listPage = (overrides: Record<string, unknown> = {}) => ({
  jobs: [jobRow()],
  pagination: {
    currentPage: 1,
    totalPages: 1,
    totalItems: 1,
    itemsPerPage: 20,
    hasNextPage: false,
    hasPreviousPage: false
  },
  kinds: ["ai.check", "mail"],
  viewer: { canRetry: true, canCancel: true },
  appliedFrom: "2026-09-19T12:00:00.000Z",
  appliedTo: "2026-09-20T12:00:00.000Z",
  ...overrides
})

const stubs = { NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' } }

const mountPage = () => mount(JobsPage, { global: { stubs } })

beforeEach(() => {
  page.value = listPage()
  summary.value = {
    depthByKind: [{ kind: "ai.check", depth: 2 }],
    oldestPendingAgeSec: 1_800,
    finishedInPeriod: 4,
    failedInPeriod: 1,
    failureRate: 0.25,
    periodFrom: "2026-09-19T12:00:00.000Z",
    periodTo: "2026-09-20T12:00:00.000Z"
  }
  card.value = null
  loading.value = false
  listFailure.value = null
  summaryFailure.value = null
  actionFailure.value = null
  routeQuery.value = {}
  refresh.mockReset()
  retry.mockReset()
  cancel.mockReset()
  retryMany.mockReset()
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("navigateTo", vi.fn())
  vi.stubGlobal("useI18n", () => ({ t: translate }))
  vi.stubGlobal("useRoute", () => ({ query: routeQuery.value }))
  vi.stubGlobal("useAdminJobs", () => ({
    page,
    summary,
    card,
    loading,
    acting: ref(false),
    listFailure,
    summaryFailure,
    actionFailure,
    refresh,
    openCard: vi.fn(),
    closeCard: vi.fn(),
    retry,
    cancel,
    retryMany
  }))
  vi.stubGlobal("computed", computed)
  vi.stubGlobal("ref", ref)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("состояние адреса раздела заданий", () => {
  it("по умолчанию читает ошибку и зависло за сутки", () => {
    expect(parseJobsQueryState({})).toEqual(defaultJobsQueryState())
  })

  it("восстанавливает фильтры из адреса и возвращает их обратно", () => {
    const state = parseJobsQueryState({ kind: "mail", status: "queued,running", period: "7d", stuck: "1", page: "3" })

    expect(state).toMatchObject({
      kind: "mail",
      statuses: ["queued", "running"],
      period: "7d",
      stuckOnly: true,
      page: 3
    })
    expect(jobsQueryToRoute(state)).toEqual({
      kind: "mail",
      status: "queued,running",
      period: "7d",
      stuck: "1",
      page: "3"
    })
  })

  it("отбрасывает неизвестный статус и нечисловую страницу", () => {
    expect(parseJobsQueryState({ status: "unknown", page: "abc" })).toMatchObject({
      statuses: ["failed", "stuck"],
      page: 1
    })
  })

  it("читает код и requestId из ответа сервера", () => {
    expect(readFailure([{ extensions: { code: "CONFLICT", requestId: "req-9" } }])).toEqual({
      code: "CONFLICT",
      requestId: "req-9"
    })
    expect(readFailure(undefined)).toEqual({ code: null, requestId: null })
  })
})

describe("состояния раздела фоновых заданий", () => {
  it("показывает скелет во время загрузки", () => {
    loading.value = true
    const wrapper = mountPage()

    expect(wrapper.find("[data-jobs-loading]").exists()).toBe(true)
    expect(wrapper.find("[data-jobs-empty]").exists()).toBe(false)
  })

  it("показывает список со статусом, попытками и последней ошибкой", () => {
    const wrapper = mountPage()

    expect(wrapper.find('[data-job-row="job-1"]').attributes("data-job-status")).toBe("failed")
    expect(wrapper.text()).toContain("ProviderError")
    expect(wrapper.text()).toContain("3/3")
  })

  it("показывает пустое состояние, когда ошибок и зависших нет", () => {
    page.value = listPage({ jobs: [] })
    const wrapper = mountPage()

    expect(wrapper.find("[data-jobs-empty]").text()).toBe("Ошибок и зависших нет")
  })

  it("показывает ошибку запроса вместе с requestId", () => {
    listFailure.value = { code: "INTERNAL_ERROR", requestId: "req-list" }
    const wrapper = mountPage()

    expect(wrapper.find("[data-jobs-error]").text()).toContain("requestId: req-list")
  })

  it("прячет повтор и отмену от роли без прав и объясняет почему", () => {
    page.value = listPage({ viewer: { canRetry: false, canCancel: false } })
    const wrapper = mountPage()

    expect(wrapper.find("[data-jobs-no-actions]").text()).toBe("Действия — владелец.")
    expect(wrapper.find('[data-job-retry="job-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-job-cancel="job-1"]').exists()).toBe(false)
  })

  it("не предлагает повтор для задания, которое нельзя повторить вручную", () => {
    page.value = listPage({ jobs: [jobRow({ kind: "ranking.recompute", retryable: false })] })
    const wrapper = mountPage()

    expect(wrapper.find('[data-job-retry="job-1"]').exists()).toBe(false)
  })

  it("сообщает о превышении лимита массового повтора", () => {
    actionFailure.value = { code: "LIMIT_EXCEEDED", requestId: null }
    const wrapper = mountPage()

    expect(wrapper.find("[data-jobs-limit]").text()).toContain("100")
  })

  it("показывает конфликт после устаревшего действия", () => {
    actionFailure.value = { code: "CONFLICT", requestId: "req-conflict" }
    const wrapper = mountPage()

    expect(wrapper.find("[data-jobs-conflict]").exists()).toBe(true)
  })

  it("отменяет задание только с указанной причиной", async () => {
    page.value = listPage({ jobs: [jobRow({ status: "running", retryable: false, cancellable: true })] })
    const wrapper = mountPage()

    await wrapper.get('[data-job-cancel="job-1"]').trigger("click")
    const confirm = wrapper.get("[data-jobs-cancel-confirm]")
    expect(confirm.attributes("disabled")).toBeDefined()

    await wrapper.get("[data-jobs-cancel-reason]").setValue("дубль")
    expect(wrapper.get("[data-jobs-cancel-confirm]").attributes("disabled")).toBeUndefined()

    await wrapper.get("[data-jobs-cancel-confirm]").trigger("click")
    expect(cancel).toHaveBeenCalledWith("job-1", "дубль")
  })

  it("подтверждает массовый повтор числом и видами", async () => {
    const wrapper = mountPage()

    await wrapper.get('[data-job-select="job-1"]').setValue(true)
    await wrapper.get("[data-jobs-bulk-open]").trigger("click")

    expect(wrapper.get("[data-jobs-bulk-modal]").text()).toContain("ai.check")
    await wrapper.get("[data-jobs-bulk-confirm]").trigger("click")
    expect(retryMany).toHaveBeenCalledWith(["job-1"])
  })

  it("показывает карточку с параметрами, попытками и автором действия", () => {
    card.value = {
      job: jobRow({ status: "cancelled" }),
      parameters: [{ key: "articleId", value: "article-1" }],
      attempts: [
        {
          number: 1,
          status: "failed",
          startedAt: null,
          finishedAt: null,
          errorClass: "ProviderError",
          errorRequestId: null
        }
      ],
      actions: [
        {
          action: "job.cancel",
          actorId: "owner-1",
          actorRole: "owner",
          actorName: "Владелец",
          reason: "дубль",
          createdAt: "2026-09-20T12:00:00.000Z"
        }
      ],
      objectHref: "/admin/articles/article-slug",
      viewer: { canRetry: true, canCancel: true }
    }
    const wrapper = mountPage()

    const detail = wrapper.get("[data-job-card]")
    expect(detail.text()).toContain("articleId")
    expect(detail.find('[data-job-attempt="1"]').exists()).toBe(true)
    expect(detail.text()).toContain("Владелец")
    expect(detail.get("[data-job-object]").attributes("href")).toBe("/admin/articles/article-slug")
  })
})
