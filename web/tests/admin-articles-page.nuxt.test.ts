// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { computed, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AdminArticlesListPage from "../app/pages/admin/articles/index.vue"
import AdminArticleCardPage from "../app/pages/admin/articles/[slug].vue"
import { adminArticleLoadStatus, parseAdminArticleFilters } from "../app/composables/useAdminArticles"

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key

const items = ref<Record<string, unknown>[]>([])
const pending = ref(false)
const failed = ref(false)
const requestId = ref<string | null>(null)
const pagination = ref<Record<string, unknown> | null>(null)
const item = ref<Record<string, unknown> | null>(null)
const viewerRole = ref("admin")
const actionPending = ref(false)
const actionErrorCode = ref<string | null>(null)
const actionResult = ref(true)
const query = ref<Record<string, string>>({})
const replace = vi.fn()
const refresh = vi.fn()
const runAction = vi.fn(async () => actionResult.value)

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "translation-1",
  articleId: "article-1",
  title: "Как устроен свет",
  slug: "light",
  locale: "ru",
  status: "published",
  rejected: false,
  readCount: 137,
  publishedAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-29T10:00:00.000Z",
  editorial: false,
  author: { id: "author-1", name: "Вера Орлова", handle: "vera" },
  section: { id: "section-1", name: "Наука", slug: "science" },
  format: { id: "format-1", name: "Статья", slug: "article" },
  tags: [{ id: "tag-1", name: "Физика", slug: "physics" }],
  archive: null,
  ...overrides
})

const card = (overrides: Record<string, unknown> = {}) => ({
  ...row(),
  dek: "Лид",
  excerpt: "Кратко",
  body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Текст статьи" }] }] },
  cover: { id: "cover-1", alt: "Свет", variants: [] },
  siblings: [{ id: "translation-2", locale: "en", title: "Light", slug: "light-en", status: "draft" }],
  revisions: [
    {
      id: "revision-1",
      title: "Как устроен свет",
      kind: "manual",
      size: 42,
      createdAt: "2026-09-29T09:00:00.000Z",
      author: { id: "author-1", name: "Вера Орлова", handle: "vera", role: "author" }
    }
  ],
  decisions: [
    {
      id: "decision-1",
      kind: "manual_publish",
      text: "Проверено",
      recommendations: null,
      byRole: "moderator",
      createdAt: "2026-09-29T09:30:00.000Z",
      replies: []
    }
  ],
  ...overrides
})

beforeEach(() => {
  items.value = [row()]
  pending.value = false
  failed.value = false
  requestId.value = null
  pagination.value = { currentPage: 1, totalPages: 1 }
  item.value = card()
  viewerRole.value = "admin"
  actionPending.value = false
  actionErrorCode.value = null
  actionResult.value = true
  query.value = {}
  replace.mockReset()
  refresh.mockReset()
  runAction.mockClear()

  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useI18n", () => ({ t }))
  vi.stubGlobal("useRoute", () => ({ query: query.value, params: { slug: "translation-1" } }))
  vi.stubGlobal("useRouter", () => ({ replace }))
  vi.stubGlobal("useAdminDashboard", () => ({ summary: computed(() => ({ role: viewerRole.value })) }))
  vi.stubGlobal("useAdminArticlesList", () => ({
    items: computed(() => items.value),
    pagination: computed(() => pagination.value),
    pending: computed(() => pending.value),
    failed: computed(() => failed.value),
    requestId,
    refresh
  }))
  vi.stubGlobal("useAdminArticleFilterOptions", () => ({
    sections: computed(() => [{ id: "section-1", name: "Наука", slug: "science" }]),
    formats: computed(() => [{ id: "format-1", name: "Статья", slug: "article" }]),
    tags: computed(() => [{ id: "tag-1", name: "Физика", slug: "physics" }])
  }))
  vi.stubGlobal("useAdminArticleCard", () => ({
    item: computed(() => item.value),
    pending: computed(() => pending.value),
    failed: computed(() => failed.value),
    viewerRole: computed(() => viewerRole.value),
    canArchive: computed(() => ["moderator", "admin", "owner"].includes(viewerRole.value)),
    canRestore: computed(() => viewerRole.value === "owner"),
    canReject: computed(() => ["moderator", "owner"].includes(viewerRole.value)),
    requestId,
    actionPending,
    actionErrorCode,
    refresh,
    runAction
  }))
})

afterEach(() => vi.unstubAllGlobals())

const nuxtLink = { props: ["to"], template: '<a :href="to"><slot /></a>' }
const mountList = () => mount(AdminArticlesListPage, { global: { stubs: { NuxtLink: nuxtLink } } })
const mountCard = () => mount(AdminArticleCardPage, { global: { stubs: { NuxtLink: nuxtLink } } })

describe("admin articles list", () => {
  it("renders loading, empty and request error as separate states", () => {
    pending.value = true
    expect(mountList().find('[data-articles-state="loading"]').exists()).toBe(true)

    pending.value = false
    items.value = []
    expect(mountList().find('[data-articles-state="empty"]').exists()).toBe(true)

    failed.value = true
    requestId.value = "req-articles-1"
    expect(mountList().get('[data-articles-state="error"]').text()).toContain("req-articles-1")
  })

  it("shows every state row with the exact read count and no e-mail", () => {
    items.value = [
      row({ status: "draft" }),
      row({ id: "translation-2", status: "review" }),
      row({ id: "translation-3", status: "published" }),
      row({ id: "translation-4", status: "rejected", rejected: true }),
      row({ id: "translation-5", status: "archived", archive: { role: "admin", reason: "Причина" } })
    ]

    const wrapper = mountList()
    expect(wrapper.findAll("[data-article-row]")).toHaveLength(5)
    expect(wrapper.get("[data-article-reads]").text()).toBe("137")
    expect(wrapper.text()).toContain("@vera")
    expect(wrapper.html()).not.toContain("email")
  })

  it("writes search and archive tab into the URL", async () => {
    const wrapper = mountList()
    await wrapper.get("[data-article-search]").setValue("light")
    await wrapper.get("[data-article-search]").trigger("change")
    await wrapper.get('[data-article-tab="archived"]').trigger("click")

    expect(replace).toHaveBeenCalledWith({ query: { q: "light" } })
    expect(replace).toHaveBeenCalledWith({ query: { status: "archived" } })
  })

  it("keeps every canonical filter in the URL and GraphQL input", async () => {
    const wrapper = mountList()
    for (const [selector, value] of [
      ["[data-article-section]", "section-1"],
      ["[data-article-format]", "format-1"],
      ["[data-article-tag]", "tag-1"],
      ["[data-article-archive-role]", "admin"],
      ["[data-article-published-from]", "2026-09-01"],
      ["[data-article-published-to]", "2026-09-30"]
    ]) {
      await wrapper.get(selector).setValue(value)
      await wrapper.get(selector).trigger("change")
    }

    expect(replace).toHaveBeenCalledWith({ query: { section: "section-1" } })
    expect(replace).toHaveBeenCalledWith({ query: { format: "format-1" } })
    expect(replace).toHaveBeenCalledWith({ query: { tag: "tag-1" } })
    expect(replace).toHaveBeenCalledWith({ query: { archiveRole: "admin" } })
    expect(replace).toHaveBeenCalledWith({ query: { publishedFrom: "2026-09-01" } })
    expect(replace).toHaveBeenCalledWith({ query: { publishedTo: "2026-09-30" } })

    expect(
      parseAdminArticleFilters({
        section: "section-1",
        format: "format-1",
        tag: "tag-1",
        archiveRole: "owner",
        publishedFrom: "2026-09-01",
        publishedTo: "2026-09-30"
      })
    ).toMatchObject({
      sectionId: "section-1",
      formatId: "format-1",
      tagId: "tag-1",
      archiveRole: "owner",
      publishedFrom: "2026-09-01",
      publishedTo: "2026-09-30"
    })
  })
})

describe("admin article card", () => {
  it("shows lead, cover, read-only body, revisions, decisions and archive actor", () => {
    item.value = card({
      status: "archived",
      archive: { at: "2026-09-29T10:00:00.000Z", actorId: "admin-1", role: "admin", reason: "Причина" }
    })

    const wrapper = mountCard()
    expect(wrapper.get("[data-article-lead]").text()).toContain("Лид")
    expect(wrapper.get("[data-article-cover]").text()).toContain("Свет")
    expect(wrapper.get("[data-article-body]").text()).toContain("Текст статьи")
    expect(wrapper.findAll("[data-article-revision]")).toHaveLength(1)
    expect(wrapper.findAll("[data-article-decision]")).toHaveLength(1)
    expect(wrapper.get("[data-article-archive]").text()).toContain("admin")
    expect(wrapper.find("textarea[data-article-body]").exists()).toBe(false)
  })

  it("hides restore and final rejection from admin", () => {
    item.value = card({ status: "archived", archive: { role: "moderator", reason: "Причина" } })
    viewerRole.value = "admin"

    const wrapper = mountCard()
    expect(wrapper.find('[data-article-action="restore"]').exists()).toBe(false)
    expect(wrapper.find('[data-article-action="reject"]').exists()).toBe(false)
  })

  it("lets owner restore an archived article", () => {
    item.value = card({ status: "archived", archive: { role: "admin", reason: "Причина" } })
    viewerRole.value = "owner"

    expect(mountCard().find('[data-article-action="restore"]').exists()).toBe(true)
  })

  it("keeps final rejection with moderator and owner, not admin", () => {
    item.value = card({ status: "in_review" })
    viewerRole.value = "moderator"

    expect(mountCard().find('[data-article-action="reject"]').exists()).toBe(true)
  })

  it("keeps archive reason after a failed mutation", async () => {
    viewerRole.value = "moderator"
    actionResult.value = false
    const wrapper = mountCard()
    await wrapper.get('[data-article-open-action="archive"]').trigger("click")
    await wrapper.get("[data-article-action-reason]").setValue("Нарушение правил")
    await wrapper.get("[data-article-submit]").trigger("click")

    expect((wrapper.get("[data-article-action-reason]").element as HTMLTextAreaElement).value).toBe("Нарушение правил")
    expect(wrapper.find("[data-article-action-error]").exists()).toBe(true)
  })

  it("maps direct card errors to HTTP statuses", () => {
    expect(adminArticleLoadStatus("NOT_FOUND")).toBe(404)
    expect(adminArticleLoadStatus("FORBIDDEN")).toBe(403)
    expect(adminArticleLoadStatus("INTERNAL_ERROR")).toBe(500)
  })
})
