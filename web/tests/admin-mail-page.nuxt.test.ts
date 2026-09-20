// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { computed, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AdminMailListPage from "../app/pages/admin/mail/index.vue"
import AdminMailCardPage from "../app/pages/admin/mail/[id].vue"

// T-080: состояния раздела «Письма» из docs/spec/40-admin/mail.md §9 и §5.
const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key

const summary = ref<{ role: string } | null>(null)
const items = ref<Record<string, unknown>[]>([])
const providerWaiting = ref(false)
const pagination = ref<Record<string, unknown> | null>(null)
const pending = ref(false)
const failed = ref(false)
const requestId = ref<string | null>(null)
const errorCode = ref<string | null>(null)
const actionPending = ref(false)
const card = ref<Record<string, unknown> | null>(null)
const cardLoading = ref(false)
const cardError = ref<unknown>(null)
const resend = vi.fn()
const resendMany = vi.fn()

const nuxtLink = { props: ["to"], template: '<a :href="to"><slot /></a>' }

const mailRow = (overrides: Record<string, unknown> = {}) => ({
  id: "mail-1",
  template: "article_decision",
  recipientEmail: "reader@example.test",
  recipientHandle: null,
  subject: "Решение по статье",
  status: "failed",
  provider: "smtp",
  messageId: null,
  deliveryErrorClass: "SMTPConnectionError",
  objectType: "Article",
  objectId: "article-1",
  createdAt: "2026-09-20T10:00:00.000Z",
  sentAt: null,
  canResend: true,
  ...overrides
})

beforeEach(() => {
  summary.value = { role: "owner" }
  items.value = [mailRow()]
  providerWaiting.value = false
  pagination.value = null
  pending.value = false
  failed.value = false
  requestId.value = null
  errorCode.value = null
  actionPending.value = false
  card.value = null
  cardLoading.value = false
  cardError.value = null
  resend.mockReset()
  resendMany.mockReset()

  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useI18n", () => ({ t }))
  vi.stubGlobal("useRoute", () => ({ query: {}, params: { id: "mail-1" } }))
  vi.stubGlobal("useRouter", () => ({ replace: vi.fn() }))
  vi.stubGlobal("useAdminDashboard", () => ({ summary }))
  vi.stubGlobal("useAdminMail", () => ({
    requestId,
    errorCode,
    actionPending,
    loadCard: vi.fn(),
    resend,
    resendMany
  }))
  vi.stubGlobal("useAdminMailList", () => ({
    items: computed(() => items.value),
    access: computed(() => "full"),
    providerWaiting: computed(() => providerWaiting.value),
    pagination: computed(() => pagination.value),
    pending: computed(() => pending.value),
    failed: computed(() => failed.value),
    requestId,
    errorCode,
    period: computed(() => "7d"),
    page: computed(() => 1),
    refresh: vi.fn(),
    resend,
    resendMany
  }))
  vi.stubGlobal("useAsyncData", () => ({
    data: card,
    pending: cardLoading,
    error: cardError,
    refresh: vi.fn()
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const mountList = () => mount(AdminMailListPage, { global: { stubs: { NuxtLink: nuxtLink } } })
const mountCard = () => mount(AdminMailCardPage, { global: { stubs: { NuxtLink: nuxtLink } } })

describe("список писем", () => {
  it("показывает скелеты, пока история читается", () => {
    pending.value = true

    const wrapper = mountList()

    expect(wrapper.get('[data-mail-state="loading"]').attributes("aria-busy")).toBe("true")
    expect(wrapper.find("[data-mail-table]").exists()).toBe(false)
  })

  it("показывает пустое состояние, когда по фильтру писем нет", () => {
    items.value = []

    const wrapper = mountList()

    expect(wrapper.find('[data-mail-state="empty"]').exists()).toBe(true)
  })

  it("показывает ошибку с requestId", () => {
    failed.value = true
    requestId.value = "req-mail"

    const wrapper = mountList()

    const error = wrapper.get('[data-mail-state="error"]')
    expect(error.attributes("role")).toBe("alert")
    expect(error.text()).toContain("req-mail")
  })

  it("предупреждает, что письма ждут недоступного провайдера", () => {
    providerWaiting.value = true

    const wrapper = mountList()

    expect(wrapper.find("[data-mail-provider-waiting]").exists()).toBe(true)
  })

  it("не показывает повтор и выбор строк никому, кроме владельца", () => {
    summary.value = { role: "admin" }

    const wrapper = mountList()

    expect(wrapper.find("[data-mail-bulk-resend]").exists()).toBe(false)
    expect(wrapper.find('[data-mail-select="mail-1"]').exists()).toBe(false)
  })

  it("сообщает о превышении лимита массового повтора", async () => {
    resendMany.mockResolvedValue(null)
    const wrapper = mountList()

    await wrapper.get('[data-mail-select="mail-1"]').setValue(true)
    await wrapper.get("[data-mail-bulk-resend]").trigger("click")
    await wrapper.get("[data-mail-confirm-submit]").trigger("click")
    errorCode.value = "VALIDATION_ERROR"
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-mail-state="limit"]').exists()).toBe(true)
  })

  it("подтверждает массовый повтор числом писем и шаблонами", async () => {
    const wrapper = mountList()

    await wrapper.get('[data-mail-select="mail-1"]').setValue(true)
    await wrapper.get("[data-mail-bulk-resend]").trigger("click")

    expect(wrapper.get("[data-mail-confirm]").text()).toContain("article_decision")
  })
})

describe("карточка письма", () => {
  it("показывает копию письма и повтор владельцу", () => {
    card.value = {
      ...mailRow(),
      body: "Статья опубликована.",
      queuedAt: "2026-09-20T10:00:00.000Z",
      jobId: null,
      deliveryEvents: []
    }

    const wrapper = mountCard()

    expect(wrapper.get("[data-mail-body]").text()).toContain("Статья опубликована.")
    expect(wrapper.find("[data-mail-resend]").exists()).toBe(true)
  })

  it("скрывает адрес и содержание от редактора и модератора", () => {
    summary.value = { role: "editor" }
    card.value = {
      ...mailRow({ recipientEmail: null, canResend: false }),
      body: null,
      queuedAt: "2026-09-20T10:00:00.000Z",
      jobId: null,
      deliveryEvents: []
    }

    const wrapper = mountCard()

    expect(wrapper.find("[data-mail-body]").exists()).toBe(false)
    expect(wrapper.find("[data-mail-body-hidden]").exists()).toBe(true)
    expect(wrapper.get("[data-mail-recipient]").text()).toBe("admin.mail.recipientHidden")
  })

  it("не предлагает повтор для письма с секретом", () => {
    card.value = {
      ...mailRow({ template: "magic_link", canResend: false }),
      body: "Войти в Altera: [секрет не показывается]",
      queuedAt: "2026-09-20T10:00:00.000Z",
      jobId: null,
      deliveryEvents: []
    }

    const wrapper = mountCard()

    expect(wrapper.get("[data-mail-body]").text()).not.toContain("token=")
    expect(wrapper.find("[data-mail-resend]").exists()).toBe(false)
  })

  it("сообщает о конфликте, когда письмо уже отправлено повторно", async () => {
    resend.mockResolvedValue(null)
    card.value = {
      ...mailRow(),
      body: "Статья опубликована.",
      queuedAt: "2026-09-20T10:00:00.000Z",
      jobId: null,
      deliveryEvents: []
    }
    const wrapper = mountCard()

    await wrapper.get("[data-mail-resend]").trigger("click")
    errorCode.value = "CONFLICT"
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-mail-state="conflict"]').exists()).toBe(true)
  })
})
