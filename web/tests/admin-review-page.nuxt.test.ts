// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { computed, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AdminReviewListPage from "../app/pages/admin/review/index.vue"
import AdminReviewCardPage from "../app/pages/admin/review/[id].vue"

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key

const items = ref<Record<string, unknown>[]>([])
const profiles = ref<Record<string, unknown>[]>([])
const pending = ref(false)
const failed = ref(false)
const item = ref<Record<string, unknown> | null>(null)
const cardPending = ref(false)
const errorCode = ref<string | null>(null)
const requestId = ref<string | null>(null)
const actionPending = ref(false)
const actionResult = ref(true)
const viewerRole = ref("moderator")
const query = ref<Record<string, string>>({})
const refresh = vi.fn()
const runAction = vi.fn(async () => actionResult.value)

const reviewRow = (overrides: Record<string, unknown> = {}) => ({
  id: "translation-1",
  articleId: "article-1",
  title: "Как устроен свет",
  slug: "light",
  locale: "ru",
  status: "review",
  state: "queued",
  rejected: false,
  publishedAt: null,
  readCount: 37,
  createdAt: "2026-09-28T10:00:00.000Z",
  updatedAt: "2026-09-29T10:00:00.000Z",
  author: { id: "author-1", name: "Вера Орлова", handle: "vera" },
  section: { slug: "science", name: "Наука" },
  editorial: false,
  reviewer: null,
  ...overrides
})

const reviewCard = (overrides: Record<string, unknown> = {}) => ({
  ...reviewRow({ status: "in_review", state: "in_review", reviewer: { role: "moderator", mine: true } }),
  body: { type: "doc" },
  revisions: [],
  decisions: [],
  aiDecision: { verdict: "rework", reasons: [{ text: "Нужна ссылка" }], finishedAt: "2026-09-29T09:00:00Z" },
  ...overrides
})

beforeEach(() => {
  items.value = [reviewRow()]
  profiles.value = []
  pending.value = false
  failed.value = false
  item.value = reviewCard()
  cardPending.value = false
  errorCode.value = null
  requestId.value = null
  actionPending.value = false
  actionResult.value = true
  viewerRole.value = "moderator"
  query.value = {}
  refresh.mockReset()
  runAction.mockClear()

  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useI18n", () => ({ t }))
  vi.stubGlobal("useRoute", () => ({ query: query.value, params: { id: "translation-1" } }))
  vi.stubGlobal("useRouter", () => ({ replace: vi.fn() }))
  vi.stubGlobal("useAdminReviewList", () => ({
    items: computed(() => items.value),
    profiles: computed(() => profiles.value),
    pagination: computed(() => null),
    pending: computed(() => pending.value),
    failed: computed(() => failed.value),
    requestId,
    refresh
  }))
  vi.stubGlobal("useAdminReviewCard", () => ({
    item: computed(() => item.value),
    pending: computed(() => cardPending.value),
    failed: computed(() => failed.value),
    viewerRole: computed(() => viewerRole.value),
    canDecide: computed(() => viewerRole.value === "moderator" || viewerRole.value === "owner"),
    errorCode,
    requestId,
    actionPending,
    refresh,
    runAction
  }))
})

afterEach(() => vi.unstubAllGlobals())

const nuxtLink = { props: ["to"], template: '<a :href="to"><slot /></a>' }
const mountList = () => mount(AdminReviewListPage, { global: { stubs: { NuxtLink: nuxtLink } } })
const mountCard = () => mount(AdminReviewCardPage, { global: { stubs: { NuxtLink: nuxtLink } } })

describe("очередь ревью", () => {
  it("показывает loading, empty и error как отдельные состояния", async () => {
    pending.value = true
    expect(mountList().find('[data-review-state="loading"]').exists()).toBe(true)

    pending.value = false
    items.value = []
    expect(mountList().find('[data-review-state="empty"]').exists()).toBe(true)

    failed.value = true
    requestId.value = "req-review-1"
    expect(mountList().get('[data-review-state="error"]').text()).toContain("req-review-1")
  })

  it("показывает все три состояния строк и точное число прочтений", () => {
    items.value = [
      reviewRow(),
      reviewRow({ id: "translation-2", state: "in_review", reviewer: { role: "owner", mine: false } }),
      reviewRow({ id: "translation-3", state: "rework" })
    ]

    const wrapper = mountList()
    expect(wrapper.findAll("[data-review-row]")).toHaveLength(3)
    expect(wrapper.text()).toContain("admin.review.state.queued")
    expect(wrapper.text()).toContain("admin.review.state.in_review")
    expect(wrapper.text()).toContain("admin.review.state.rework")
    expect(wrapper.get("[data-review-reads]").text()).toBe("37")
  })

  it("показывает имя и хэндл автора без e-mail", () => {
    const wrapper = mountList()
    expect(wrapper.get("[data-review-author]").text()).toContain("Вера Орлова")
    expect(wrapper.get("[data-review-author]").text()).toContain("@vera")
    expect(wrapper.html()).not.toContain("email")
  })

  it("переключает вкладку проверок профиля через URL", () => {
    query.value = { tab: "profiles" }
    profiles.value = [
      {
        userId: "user-1",
        name: "Новая подпись",
        handle: "profile-one",
        fields: ["name", "avatar"],
        updatedAt: "2026-09-29T10:00:00Z"
      }
    ]

    const wrapper = mountList()
    expect(wrapper.get("[data-review-profile-row]").text()).toContain("@profile-one")
    expect(wrapper.find("[data-review-table]").exists()).toBe(false)
  })
})

describe("карточка ревью", () => {
  it("оставляет admin только чтение и скрывает решения", () => {
    viewerRole.value = "admin"
    const wrapper = mountCard()

    expect(wrapper.find("[data-review-readonly]").exists()).toBe(true)
    expect(wrapper.find("[data-review-actions]").exists()).toBe(false)
  })

  it("проверяет обязательный текст доработки до вызова мутации", async () => {
    const wrapper = mountCard()
    await wrapper.get('[data-review-open-action="rework"]').trigger("click")
    await wrapper.get("[data-review-submit]").trigger("click")

    expect(wrapper.find("[data-review-validation]").exists()).toBe(true)
    expect(runAction).not.toHaveBeenCalled()
  })

  it("сохраняет введённый текст после ошибки мутации", async () => {
    actionResult.value = false
    const wrapper = mountCard()
    await wrapper.get('[data-review-open-action="rework"]').trigger("click")
    await wrapper.get("[data-review-action-text]").setValue("Добавьте источник")
    await wrapper.get("[data-review-submit]").trigger("click")

    expect((wrapper.get("[data-review-action-text]").element as HTMLTextAreaElement).value).toBe("Добавьте источник")
    expect(wrapper.find("[data-review-action-error]").exists()).toBe(true)
  })

  it("при конфликте предлагает обновить карточку", async () => {
    errorCode.value = "CONFLICT"
    const wrapper = mountCard()
    await wrapper.get("[data-review-conflict-refresh]").trigger("click")

    expect(refresh).toHaveBeenCalled()
  })
})
