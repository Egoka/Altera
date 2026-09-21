// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AdminLegalIndex from "../app/pages/admin/legal/index.vue"
import AdminLegalKind from "../app/pages/admin/legal/[kind]/index.vue"
import AdminLegalVersion from "../app/pages/admin/legal/[kind]/[version].vue"
import { canPublishLegalTexts, canReadLegalTexts } from "../app/utils/admin"
import {
  diffLegalLines,
  parseLegalKind,
  parseLegalLocale,
  parseLegalVersion,
  splitLegalLines
} from "../app/utils/legalTexts"

// T-083: раздел `/admin/legal` (`docs/spec/40-admin/legal-texts.md` §1, §4, §7, §9).

const kindsFixture = [
  {
    kind: "terms",
    requiresConsent: true,
    locales: [
      {
        locale: "ru",
        currentVersion: 2,
        publishedAt: "2026-09-20T00:00:00.000Z",
        draftVersion: 3,
        usersTotal: 10,
        usersWithCurrentConsent: 7
      },
      {
        locale: "en",
        currentVersion: null,
        publishedAt: null,
        draftVersion: null,
        usersTotal: null,
        usersWithCurrentConsent: null
      }
    ]
  },
  {
    kind: "about",
    requiresConsent: false,
    locales: [
      {
        locale: "ru",
        currentVersion: null,
        publishedAt: null,
        draftVersion: null,
        usersTotal: null,
        usersWithCurrentConsent: null
      },
      {
        locale: "en",
        currentVersion: null,
        publishedAt: null,
        draftVersion: null,
        usersTotal: null,
        usersWithCurrentConsent: null
      }
    ]
  }
]

const versionRow = (overrides: Record<string, unknown> = {}) => ({
  id: "text-3",
  kind: "terms",
  locale: "ru",
  version: 3,
  status: "draft",
  isMaterial: false,
  summaryOfChanges: "Новый раздел",
  publishedAt: null,
  publishedByRole: null,
  updatedAt: "2026-09-21T10:00:00.000Z",
  consentCount: 0,
  ...overrides
})

const detailFixture = (overrides: Record<string, unknown> = {}) => ({
  ...versionRow(),
  body: '<h2 id="a">Раздел</h2><p>Новый текст</p>',
  anchors: [{ id: "a", title: "Раздел" }],
  current: { version: 2, body: '<h2 id="a">Раздел</h2><p>Старый текст</p>' },
  requiresConsent: true,
  affectedUsers: 10,
  pendingConsentCount: null,
  ...overrides
})

const summary = ref({ role: "admin" })
const loading = ref(false)
const failed = ref(false)
const requestId = ref<string | null>(null)
const saving = ref(false)
const failure = ref<Record<string, unknown> | null>(null)
const legal = {
  loadIndex: vi.fn(),
  loadVersions: vi.fn(),
  loadVersion: vi.fn(),
  saveDraft: vi.fn(),
  publish: vi.fn()
}
const navigate = vi.fn()
let route: { query: Record<string, string>; params: Record<string, string> } = { query: {}, params: {} }

const stubs = { NuxtLink: { props: ["to"], template: "<a><slot /></a>" } }

beforeEach(() => {
  summary.value = { role: "admin" }
  loading.value = false
  failed.value = false
  requestId.value = null
  failure.value = null
  route = { query: {}, params: {} }
  vi.clearAllMocks()
  legal.loadIndex.mockResolvedValue({ adminLegalKinds: kindsFixture, adminLegalVersions: [versionRow()] })
  legal.loadVersions.mockResolvedValue([versionRow(), versionRow({ id: "text-2", version: 2, status: "published" })])
  legal.loadVersion.mockResolvedValue(detailFixture())
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useRoute", () => route)
  vi.stubGlobal("navigateTo", navigate)
  vi.stubGlobal("createError", (input: { statusCode: number }) => Object.assign(new Error("error"), input))
  vi.stubGlobal("useI18n", () => ({ t: (key: string) => key }))
  vi.stubGlobal("useAdminDashboard", () => ({ summary }))
  vi.stubGlobal("useAdminLegal", () => ({ loading, failed, requestId, saving, failure, ...legal }))
})

afterEach(() => vi.unstubAllGlobals())

describe("права и разбор адреса", () => {
  it("читают admin и owner, публикует только owner", () => {
    expect(
      ["editor", "moderator", "analyst", "admin", "owner"].filter((role) => canReadLegalTexts(role as never))
    ).toEqual(["admin", "owner"])
    expect(canPublishLegalTexts("admin")).toBe(false)
    expect(canPublishLegalTexts("owner")).toBe(true)
  })

  it("разбирает вид, локаль и номер версии из URL", () => {
    expect(parseLegalKind("content_rules")).toBe("content_rules")
    expect(parseLegalKind("rules")).toBeNull()
    expect(parseLegalLocale("en")).toBe("en")
    expect(parseLegalLocale("de")).toBe("ru")
    expect(parseLegalVersion("12")).toBe(12)
    expect(parseLegalVersion("0")).toBeNull()
    expect(parseLegalVersion("1e3")).toBeNull()
  })
})

describe("сравнение версий", () => {
  it("режет HTML по блокам и показывает добавленные и удалённые строки", () => {
    expect(splitLegalLines("<h2>A</h2><p>B</p>\n<p>C</p>")).toEqual(["<h2>A</h2>", "<p>B</p>", "<p>C</p>"])
    expect(diffLegalLines("<p>A</p><p>B</p><p>C</p>", "<p>A</p><p>X</p><p>C</p><p>D</p>")).toEqual([
      { kind: "same", text: "<p>A</p>" },
      { kind: "removed", text: "<p>B</p>" },
      { kind: "added", text: "<p>X</p>" },
      { kind: "same", text: "<p>C</p>" },
      { kind: "added", text: "<p>D</p>" }
    ])
  })
})

describe("список /admin/legal", () => {
  it("берёт фильтры из URL и показывает действующую версию, черновик и долю согласий", async () => {
    route.query = { kind: "terms", locale: "ru", status: "draft" }
    const wrapper = mount(AdminLegalIndex, { global: { stubs } })
    await flushPromises()

    expect(legal.loadIndex).toHaveBeenCalledWith({ kind: "terms", locale: "ru", status: "draft" })
    expect(wrapper.findAll("[data-legal-kind]")).toHaveLength(1)
    const card = wrapper.get('[data-legal-kind="terms"]')
    expect(card.find("[data-legal-current]").exists()).toBe(true)
    expect(card.find("[data-legal-consent]").exists()).toBe(true)
    expect(card.find("[data-legal-draft]").exists()).toBe(true)
    expect(wrapper.get("[data-legal-permission]").text()).toBe("admin.legalTexts.adminNote")
  })

  it("«Пусто»: вид без версий — «текст ещё не опубликован»", async () => {
    const wrapper = mount(AdminLegalIndex, { global: { stubs } })
    await flushPromises()
    expect(wrapper.get('[data-legal-kind="about"]').find("[data-legal-empty]").exists()).toBe(true)
  })

  it("меняет фильтр через URL", async () => {
    const wrapper = mount(AdminLegalIndex, { global: { stubs } })
    await flushPromises()
    await wrapper.get('[data-legal-filter="locale"]').setValue("en")
    await flushPromises()
    expect(navigate).toHaveBeenCalledWith({ path: "/admin/legal", query: { locale: "en" } })
  })

  it("«Загрузка» и «Ошибка» с requestId", async () => {
    loading.value = true
    expect(mount(AdminLegalIndex, { global: { stubs } }).find("[data-legal-loading]").exists()).toBe(true)
    loading.value = false
    failed.value = true
    requestId.value = "req-legal"
    const wrapper = mount(AdminLegalIndex, { global: { stubs } })
    expect(wrapper.get("[data-legal-error]").text()).toContain("req-legal")
  })
})

describe("страница вида", () => {
  it("admin читает версии без формы черновика; owner получает форму с текстом черновика", async () => {
    route.params = { kind: "terms" }
    const reader = mount(AdminLegalKind, { global: { stubs } })
    await flushPromises()
    expect(reader.findAll("[data-legal-version]")).toHaveLength(2)
    expect(reader.find("[data-legal-draft-form]").exists()).toBe(false)
    expect(legal.loadVersion).not.toHaveBeenCalled()

    summary.value = { role: "owner" }
    const owner = mount(AdminLegalKind, { global: { stubs } })
    await flushPromises()
    expect(legal.loadVersion).toHaveBeenCalledWith("terms", "ru", 3)
    expect((owner.get("[data-legal-body]").element as HTMLTextAreaElement).value).toContain("Новый текст")

    legal.saveDraft.mockResolvedValue(versionRow())
    await owner.get("[data-legal-draft-form]").trigger("submit")
    await flushPromises()
    expect(legal.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "terms", locale: "ru", draftUpdatedAt: "2026-09-21T10:00:00.000Z" })
    )
    expect(navigate).toHaveBeenCalledWith({ path: "/admin/legal/terms/3", query: { locale: "ru" } })
  })

  it("«Конфликт»: сохранение чужого черновика предлагает обновить", async () => {
    route.params = { kind: "terms" }
    summary.value = { role: "owner" }
    failure.value = { code: "CONFLICT", field: null, requestId: null }
    const wrapper = mount(AdminLegalKind, { global: { stubs } })
    await flushPromises()
    expect(wrapper.get("[data-legal-save-error]").attributes("data-legal-failure")).toBe("CONFLICT")
    expect(wrapper.get("[data-legal-save-error]").text()).toContain("admin.legalTexts.reload")
  })

  it("плашка «пока не предоставляются» у условий платных услуг; неизвестный вид — 404", async () => {
    route.params = { kind: "paid_services" }
    const wrapper = mount(AdminLegalKind, { global: { stubs } })
    await flushPromises()
    expect(wrapper.find("[data-legal-paid-notice]").exists()).toBe(true)

    route.params = { kind: "unknown" }
    expect(() => mount(AdminLegalKind, { global: { stubs } })).toThrow()
  })
})

describe("карточка версии и публикация", () => {
  it("admin видит предпросмотр и сравнение, но не кнопку публикации", async () => {
    route.params = { kind: "terms", version: "3" }
    const wrapper = mount(AdminLegalVersion, { global: { stubs } })
    await flushPromises()

    expect(wrapper.get("[data-legal-preview]").html()).toContain("Новый текст")
    expect(wrapper.find("[data-legal-publish]").exists()).toBe(false)
    expect(wrapper.get("[data-legal-permission]").text()).toBe("admin.legalTexts.adminNote")

    await wrapper.get('[data-legal-tab="compare"]').trigger("click")
    expect(wrapper.findAll('[data-diff="added"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-diff="removed"]')).toHaveLength(1)
  })

  it("несущественная версия публикуется из одного окна", async () => {
    route.params = { kind: "terms", version: "3" }
    summary.value = { role: "owner" }
    legal.publish.mockResolvedValue({ ...versionRow({ status: "published" }) })
    const wrapper = mount(AdminLegalVersion, { global: { stubs } })
    await flushPromises()

    await wrapper.get("[data-legal-publish]").trigger("click")
    expect(wrapper.get("[data-legal-dialog]").attributes("data-legal-dialog")).toBe("options")
    await wrapper.get("[data-legal-confirm]").trigger("click")
    await flushPromises()

    expect(legal.publish).toHaveBeenCalledWith({
      kind: "terms",
      locale: "ru",
      version: 3,
      isMaterial: false,
      draftUpdatedAt: "2026-09-21T10:00:00.000Z"
    })
  })

  it("существенная версия требует второго шага с числом затронутых пользователей", async () => {
    route.params = { kind: "terms", version: "3" }
    summary.value = { role: "owner" }
    legal.publish.mockResolvedValue({ ...versionRow({ status: "published", isMaterial: true }) })
    const wrapper = mount(AdminLegalVersion, { global: { stubs } })
    await flushPromises()

    await wrapper.get("[data-legal-publish]").trigger("click")
    await wrapper.get("[data-legal-material]").setValue(true)
    await wrapper.get("[data-legal-confirm]").trigger("click")
    expect(legal.publish).not.toHaveBeenCalled()
    expect(wrapper.get("[data-legal-dialog]").attributes("data-legal-dialog")).toBe("material")
    expect(wrapper.get("[data-legal-affected]").text()).toBe("admin.legalTexts.materialAffected")

    await wrapper.get("[data-legal-confirm]").trigger("click")
    await flushPromises()
    expect(legal.publish).toHaveBeenCalledWith(expect.objectContaining({ isMaterial: true }))
  })

  it("неизвестная версия — «такой версии нет»", async () => {
    route.params = { kind: "terms", version: "9" }
    legal.loadVersion.mockResolvedValue(null)
    const wrapper = mount(AdminLegalVersion, { global: { stubs } })
    await flushPromises()
    expect(wrapper.find("[data-legal-missing]").exists()).toBe(true)
  })
})
