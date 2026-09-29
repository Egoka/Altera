// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { computed, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AdminUsersListPage from "../app/pages/admin/users/index.vue"
import AdminUserCardPage from "../app/pages/admin/users/[id].vue"

/**
 * T-073: строки состояний раздела «Пользователи» (`docs/spec/40-admin/users.md` §9) и предупреждения
 * опасных действий (§7). Браузерный сценарий `73-admin-users.spec.ts` проходит те же строки на живой
 * базе; здесь проверяется разметка без сети.
 */
const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key

const items = ref<Record<string, unknown>[]>([])
const pagination = ref<Record<string, unknown> | null>(null)
const viewerCanManage = ref(true)
const pending = ref(false)
const failed = ref(false)
const requestId = ref<string | null>(null)
const errorCode = ref<string | null>(null)
const actionPending = ref(false)
const card = ref<Record<string, unknown> | null>(null)
const cardLoading = ref(false)
const cardError = ref<unknown>(null)
const archive = vi.fn()
const restore = vi.fn()
const revokeSessions = vi.fn()
const changeEmail = vi.fn()
const query = ref<Record<string, string>>({})

const nuxtLink = { props: ["to"], template: '<a :href="to"><slot /></a>' }

const userRow = (overrides: Record<string, unknown> = {}) => ({
  id: "reader-1",
  name: "Вера Орлова",
  handle: "vera",
  email: "v***a@example.test",
  emailMasked: true,
  role: "reader",
  status: "active",
  archiveMode: null,
  createdAt: "2026-09-01T10:00:00.000Z",
  lastActiveAt: "2026-09-25T10:00:00.000Z",
  articlesCount: 2,
  publishedCount: 1,
  plan: { state: "base", tier: "standard", until: null, endedAt: null },
  ...overrides
})

const userCard = (overrides: Record<string, unknown> = {}) => ({
  ...userRow(),
  email: "vera.orlova@example.test",
  emailMasked: false,
  locale: "ru",
  nameCheckStatus: "ok",
  avatarCheckStatus: "ok",
  archivedAt: null,
  archiveReasonCategory: null,
  archivePublicMessage: null,
  archiveInternalReason: null,
  archivedByName: null,
  archivedByRole: null,
  canArchive: true,
  canRestore: false,
  canRevokeSessions: true,
  canChangeEmail: true,
  baseAuthorship: { enabled: true, enabledAt: "2026-09-02T10:00:00.000Z" },
  articleStats: { total: 3, draft: 1, review: 0, published: 1, archived: 1 },
  articles: [
    {
      id: "art-1",
      slug: "first",
      title: "Первый материал",
      status: "published",
      locale: "ru",
      createdAt: "2026-09-03T10:00:00.000Z",
      publishedAt: "2026-09-04T10:00:00.000Z",
      archivedAt: null,
      archivedByStaff: false
    }
  ],
  consents: [{ kind: "terms", version: 3, locale: "ru", acceptedAt: "2026-09-01T10:00:00.000Z" }],
  sessions: [
    {
      id: "session-1",
      deviceClass: "desktop",
      browserClass: "chrome",
      createdAt: "2026-09-20T10:00:00.000Z",
      lastActiveAt: "2026-09-25T10:00:00.000Z"
    }
  ],
  ...overrides
})

beforeEach(() => {
  items.value = [userRow()]
  pagination.value = null
  viewerCanManage.value = true
  pending.value = false
  failed.value = false
  requestId.value = null
  errorCode.value = null
  actionPending.value = false
  card.value = userCard()
  cardLoading.value = false
  cardError.value = null
  query.value = {}
  archive.mockReset()
  restore.mockReset()
  revokeSessions.mockReset()
  changeEmail.mockReset()

  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useI18n", () => ({ t }))
  vi.stubGlobal("useRoute", () => ({ query: query.value, params: { id: "reader-1" } }))
  vi.stubGlobal("useRouter", () => ({ replace: vi.fn() }))
  vi.stubGlobal("useAdminDashboard", () => ({ summary: computed(() => ({ role: "admin" })) }))
  vi.stubGlobal("useAdminUser", () => ({
    requestId,
    errorCode,
    actionPending,
    loadCard: vi.fn(),
    loadAudit: vi.fn(),
    archive,
    restore,
    revokeSessions,
    changeEmail
  }))
  vi.stubGlobal("useAdminUsersList", () => ({
    items: computed(() => items.value),
    pagination: computed(() => pagination.value),
    viewerRole: computed(() => "admin"),
    viewerCanManage: computed(() => viewerCanManage.value),
    pending: computed(() => pending.value),
    failed: computed(() => failed.value),
    requestId,
    errorCode,
    filters: computed(() => ({})),
    page: computed(() => 1),
    refresh: vi.fn()
  }))
  vi.stubGlobal("useAsyncData", (key: string) =>
    key.startsWith("admin-user-audit")
      ? {
          data: ref([
            {
              id: "audit-1",
              action: "user.archive",
              createdAt: "2026-09-26T10:00:00.000Z",
              requestId: null,
              actor: { id: "admin-1", role: "admin", name: "Администратор", isSystem: false }
            }
          ]),
          pending: ref(false),
          error: ref(null),
          refresh: vi.fn()
        }
      : { data: card, pending: cardLoading, error: cardError, refresh: vi.fn() }
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const mountList = () => mount(AdminUsersListPage, { global: { stubs: { NuxtLink: nuxtLink } } })
const mountCard = () => mount(AdminUserCardPage, { global: { stubs: { NuxtLink: nuxtLink } } })

describe("список пользователей", () => {
  it("показывает скелеты, пока список читается", () => {
    pending.value = true

    const wrapper = mountList()

    expect(wrapper.get('[data-users-state="loading"]').attributes("aria-busy")).toBe("true")
    expect(wrapper.find("[data-users-table]").exists()).toBe(false)
  })

  it("показывает пустое состояние по фильтру", () => {
    items.value = []

    expect(mountList().find('[data-users-state="empty"]').exists()).toBe(true)
  })

  it("показывает ошибку с requestId и кнопкой повтора", () => {
    failed.value = true
    requestId.value = "req-users-1"

    const wrapper = mountList()

    expect(wrapper.get('[data-users-state="error"]').text()).toContain("req-users-1")
    expect(wrapper.find("[data-users-table]").exists()).toBe(false)
  })

  it("отдаёт адрес маской и ведёт на карточку по идентификатору", () => {
    const wrapper = mountList()

    expect(wrapper.get("[data-users-email]").text()).toBe("v***a@example.test")
    expect(wrapper.get("[data-users-masked-note]").exists()).toBe(true)
    expect(wrapper.get('a[href="/admin/users/reader-1"]').exists()).toBe(true)
  })

  it("пишет в строке режим архива, а не общий статус", () => {
    items.value = [userRow({ status: "archived", archiveMode: "emergency" })]

    expect(mountList().get("[data-users-status-label]").text()).toBe("admin.users.archiveMode.emergency")
  })

  it("аналитику показывает пометку «только чтение» и не показывает фильтр режима без архива", () => {
    viewerCanManage.value = false

    const wrapper = mountList()

    expect(wrapper.find("[data-users-readonly-note]").exists()).toBe(true)
    expect(wrapper.find('[data-users-filter="mode"]').exists()).toBe(false)
  })

  it("фильтр режима архива появляется только при выбранном архиве", () => {
    query.value = { status: "archived" }

    expect(mountList().find('[data-users-filter="mode"]').exists()).toBe(true)
  })
})

describe("карточка пользователя", () => {
  it("раскрывает полный адрес, базовое авторство, материалы и сессии", () => {
    const wrapper = mountCard()

    expect(wrapper.get("[data-users-card-email]").text()).toBe("vera.orlova@example.test")
    expect(wrapper.get("[data-users-card-authorship]").text()).toContain("admin.users.baseAuthorshipOn")
    expect(wrapper.get("[data-users-card-stats]").text()).toContain("admin.users.articleStats")
    expect(wrapper.get('[data-users-article="art-1"]').exists()).toBe(true)
    expect(wrapper.get('[data-users-session="session-1"]').exists()).toBe(true)
    expect(wrapper.get("[data-users-audit]").text()).toContain("user.archive")
  })

  it("аналитику не показывает ни кнопок, ни сессий, ни внутренней причины", () => {
    card.value = userCard({
      sessions: null,
      archiveInternalReason: null,
      canArchive: false,
      canRestore: false,
      canRevokeSessions: false,
      canChangeEmail: false
    })

    const wrapper = mountCard()

    expect(wrapper.find("[data-users-open-archive]").exists()).toBe(false)
    expect(wrapper.find("[data-users-open-emergency]").exists()).toBe(false)
    expect(wrapper.find("[data-users-open-sessions]").exists()).toBe(false)
    expect(wrapper.find("[data-users-session]").exists()).toBe(false)
    expect(wrapper.find("[data-users-card-internal-reason]").exists()).toBe(false)
    expect(wrapper.find("[data-users-readonly-note]").exists()).toBe(true)
  })

  it("диалог блокировки предупреждает о материалах и действующем плане", async () => {
    card.value = userCard({ plan: { state: "active", tier: "pro", until: "2026-12-01T00:00:00.000Z", endedAt: null } })
    const wrapper = mountCard()

    await wrapper.get("[data-users-open-archive]").trigger("click")

    expect(wrapper.get("[data-users-dialog-articles]").text()).toContain("admin.users.archiveArticlesWarning:2")
    expect(wrapper.get("[data-users-dialog-plan]").text()).toContain("admin.users.planWarning")
    expect(wrapper.find("[data-users-dialog-emergency]").exists()).toBe(false)
    // Четыре базовые категории причины (журнал §38 п. 1) — закрытый список.
    expect(wrapper.get("[data-users-reason-category]").findAll("option")).toHaveLength(4)
  })

  it("экстренная блокировка добавляет предупреждение о немедленном действии", async () => {
    const wrapper = mountCard()

    await wrapper.get("[data-users-open-emergency]").trigger("click")

    expect(wrapper.get("[data-users-dialog-emergency]").exists()).toBe(true)
    expect(wrapper.get('[data-users-dialog="emergency"]').attributes("aria-modal")).toBe("true")
  })

  it("подтверждение блокировки уходит с категорией, объяснением и режимом", async () => {
    archive.mockResolvedValue({ archiveAccount: userCard({ status: "archived" }) })
    const wrapper = mountCard()

    await wrapper.get("[data-users-open-archive]").trigger("click")
    await wrapper.get("[data-users-internal-reason]").setValue("Повторное нарушение")
    await wrapper.get("[data-users-public-message]").setValue("Материалы нарушают правила")
    await wrapper.get("[data-users-confirm-archive]").trigger("click")

    expect(archive).toHaveBeenCalledWith({
      id: "reader-1",
      reasonCategory: "rules_violation",
      internalReason: "Повторное нарушение",
      publicMessage: "Материалы нарушают правила",
      mode: "admin"
    })
  })

  it("диалог восстановления предупреждает, что материалы остаются в архиве", async () => {
    card.value = userCard({
      status: "archived",
      archiveMode: "admin",
      archivedAt: "2026-09-26T10:00:00.000Z",
      canArchive: false,
      canRestore: true
    })
    const wrapper = mountCard()

    await wrapper.get("[data-users-open-restore]").trigger("click")

    expect(wrapper.get("[data-users-dialog-articles-stay]").text()).toBe("admin.users.restoreArticlesNote")
  })

  it("показывает конфликт, когда аккаунт изменил другой администратор", async () => {
    archive.mockResolvedValue(null)
    errorCode.value = null
    const wrapper = mountCard()

    await wrapper.get("[data-users-open-archive]").trigger("click")
    errorCode.value = "CONFLICT"
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-users-state="conflict"]').exists()).toBe(true)
  })

  it("смена адреса уходит с новым адресом и причиной", async () => {
    changeEmail.mockResolvedValue({ adminChangeEmail: { emailMasked: "v***w@example.test", changedAt: "now" } })
    const wrapper = mountCard()

    await wrapper.get("[data-users-open-email]").trigger("click")
    await wrapper.get("[data-users-new-email]").setValue("vera.new@example.test")
    await wrapper.get("[data-users-email-reason]").setValue("Личность проверена по обращению")
    await wrapper.get("[data-users-confirm-email]").trigger("click")

    expect(changeEmail).toHaveBeenCalledWith({
      id: "reader-1",
      newEmail: "vera.new@example.test",
      reason: "Личность проверена по обращению"
    })
  })

  it("показывает ошибку карточки с requestId", () => {
    cardError.value = new Error("boom")
    requestId.value = "req-card-1"

    expect(mountCard().get('[data-users-state="error"]').text()).toContain("req-card-1")
  })
})
