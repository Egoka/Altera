// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { computed, defineComponent, reactive, ref, watch } from "vue"
import { Kind, type DocumentNode } from "graphql"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ReviewHistoryPage from "../app/pages/me/articles/[id]/review.vue"

const operationName = (document: DocumentNode): string => {
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) return definition.name?.value ?? ""
  }
  return ""
}

const response = (overrides: Record<string, unknown> = {}) => ({
  translationId: "translation-1",
  title: "Как устроен свет",
  locale: "ru",
  status: "rework",
  rejected: false,
  readOnly: false,
  planLimited: false,
  reviewState: "rework",
  aiDecision: {
    decision: "reject",
    checkedAt: "2026-09-29T07:55:00.000Z",
    reasons: [{ category: "rights", anchor: "block-1", text: "Не указан источник изображения" }]
  },
  items: [
    {
      id: "decision-1",
      kind: "rework_request",
      text: "Нужна фактическая опора",
      recommendations: "Добавьте источник",
      byRole: "moderator",
      createdAt: "2026-09-29T08:00:00.000Z",
      readAt: null,
      canReply: true,
      thread: [
        {
          id: "reply-1",
          author: true,
          byRole: "author",
          text: "Источник добавлен",
          createdAt: "2026-09-29T08:30:00.000Z"
        }
      ]
    }
  ],
  notes: [
    {
      id: "note-1",
      blockId: "block-1",
      text: "Уточните источник даты",
      resolved: false,
      createdAt: "2026-09-29T08:05:00.000Z",
      updatedAt: null
    }
  ],
  ...overrides
})

const responses = new Map<string, unknown>()
const graphQLRequest = vi.fn(async (document: DocumentNode) => responses.get(operationName(document)))
const navigations: unknown[] = []
const createdErrors: unknown[] = []

const render = async () => {
  const host = defineComponent({
    components: { Page: ReviewHistoryPage },
    template: "<Suspense><Page /></Suspense>"
  })
  const wrapper = mount(host, {
    global: {
      stubs: {
        NuxtLink: { props: ["to"], template: "<a :href=\"typeof to === 'string' ? to : to.path\"><slot /></a>" }
      }
    }
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  responses.clear()
  navigations.length = 0
  createdErrors.length = 0
  graphQLRequest.mockClear()
  responses.set("GetTranslationReview", { data: { translationReview: response() } })
  responses.set("MarkReviewRead", { data: { markReviewRead: "2026-09-29T09:00:00.000Z" } })
  responses.set("ReplyToDecision", {
    data: {
      replyToDecision: {
        id: "reply-2",
        author: true,
        byRole: "author",
        text: "Исправление готово",
        createdAt: "2026-09-29T09:00:00.000Z"
      }
    }
  })
  responses.set("ResolveReviewNote", {
    data: {
      resolveReviewNote: {
        id: "note-1",
        blockId: "block-1",
        text: "Уточните источник даты",
        resolved: true,
        createdAt: "2026-09-29T08:05:00.000Z",
        updatedAt: "2026-09-29T09:00:00.000Z"
      }
    }
  })

  vi.stubGlobal("computed", computed)
  vi.stubGlobal("reactive", reactive)
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("onMounted", (callback: () => void) => callback())
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useRoute", () => ({ params: { id: "translation-1" }, fullPath: "/me/articles/translation-1/review" }))
  vi.stubGlobal("useI18n", () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${Object.values(params).join(",")}` : key),
    locale: ref("ru")
  }))
  vi.stubGlobal("useGraphQL", graphQLRequest)
  vi.stubGlobal("navigateTo", async (target: unknown) => navigations.push(target))
  vi.stubGlobal("createError", (input: unknown) => {
    createdErrors.push(input)
    return new Error(JSON.stringify(input))
  })
  vi.stubGlobal("useAsyncData", async (_key: string, handler: () => Promise<unknown>) => {
    const data = ref<unknown>(null)
    const error = ref<unknown>(null)
    const status = ref("pending")
    const refresh = async () => {
      try {
        data.value = await handler()
        status.value = "success"
      } catch (thrown) {
        error.value = thrown
        status.value = "error"
      }
    }
    await refresh()
    return { data, error, status, refresh }
  })
})

afterEach(() => vi.unstubAllGlobals())

describe("author review history page", () => {
  it("shows a loading skeleton while the history request is pending", async () => {
    vi.stubGlobal("useAsyncData", async () => ({
      data: ref(null),
      error: ref(null),
      status: ref("pending"),
      refresh: vi.fn()
    }))

    const wrapper = await render()

    expect(wrapper.get("[data-review-state]").attributes("data-review-state")).toBe("loading")
  })

  it("shows the decision, categorized reasons, thread and resolves block notes", async () => {
    const wrapper = await render()

    expect(wrapper.get("[data-review-state]").attributes("data-review-state")).toBe("rework")
    expect(wrapper.get("[data-testid='review-title']").text()).toContain("Как устроен свет")
    expect(wrapper.get("[data-testid='review-reasons']").text()).toContain("Не указан источник изображения")
    expect(wrapper.get("[data-testid='review-thread-decision-1']").text()).toContain("Источник добавлен")
    expect(wrapper.get("[data-testid='review-note-note-1']").text()).toContain("Уточните источник даты")

    await wrapper.get("[data-testid='review-note-resolve-note-1']").trigger("click")
    await flushPromises()
    expect(wrapper.get("[data-testid='review-note-note-1']").text()).toContain("review.notes.resolved")
  })

  it("adds the author's answer to the visible decision thread", async () => {
    const wrapper = await render()

    await wrapper.get("[data-testid='review-reply-input-decision-1']").setValue("Исправление готово")
    await wrapper.get("[data-testid='review-reply-form-decision-1']").trigger("submit")
    await flushPromises()

    expect(wrapper.get("[data-testid='review-thread-decision-1']").text()).toContain("Исправление готово")
    expect(graphQLRequest.mock.calls.map(([document]) => operationName(document))).toContain("ReplyToDecision")
  })

  it("renders the empty state when the version has never been submitted", async () => {
    responses.set("GetTranslationReview", {
      data: {
        translationReview: response({
          status: "draft",
          reviewState: null,
          aiDecision: { decision: "none", checkedAt: null, reasons: [] },
          items: [],
          notes: []
        })
      }
    })

    const wrapper = await render()

    expect(wrapper.get("[data-review-state]").attributes("data-review-state")).toBe("empty")
    expect(wrapper.text()).toContain("review.empty.title")
  })

  it("shows an in-flight automated check as pending rather than empty", async () => {
    responses.set("GetTranslationReview", {
      data: {
        translationReview: response({
          status: "ai_check",
          reviewState: null,
          aiDecision: { decision: "none", checkedAt: null, reasons: [] },
          items: [],
          notes: []
        })
      }
    })

    const wrapper = await render()

    expect(wrapper.get("[data-review-state]").attributes("data-review-state")).toBe("pending")
    expect(wrapper.text()).toContain("review.state.pending")
  })

  it("keeps a final rejection readable without an editor or reply action", async () => {
    responses.set("GetTranslationReview", {
      data: {
        translationReview: response({
          status: "review",
          rejected: true,
          readOnly: true,
          items: [
            {
              ...response().items[0],
              kind: "final_reject",
              canReply: false,
              text: "Редакционное решение окончательное"
            }
          ]
        })
      }
    })

    const wrapper = await render()

    expect(wrapper.get("[data-review-state]").attributes("data-review-state")).toBe("final_reject")
    expect(wrapper.text()).toContain("review.readOnly.finalReject")
    expect(wrapper.get("[data-testid='review-open-editor']").text()).toBe("review.openReadOnly")
    expect(wrapper.find("[data-testid='review-reply-form-decision-1']").exists()).toBe(false)
  })

  it("keeps history readable after the plan expires and links to plans", async () => {
    responses.set("GetTranslationReview", {
      data: { translationReview: response({ readOnly: true, planLimited: true }) }
    })

    const wrapper = await render()

    expect(wrapper.text()).toContain("review.readOnly.plan")
    expect(wrapper.get("a[href='/pricing']").text()).toBe("review.pricing")
    expect(wrapper.get("[data-testid='review-open-editor']").text()).toBe("review.openReadOnly")
    expect(wrapper.find("[data-testid='review-reply-form-decision-1']").exists()).toBe(false)
    expect(wrapper.find("[data-testid='review-note-resolve-note-1']").exists()).toBe(false)
  })

  it("shows a recoverable data error and maps an unknown translation to HTTP 404", async () => {
    responses.set("GetTranslationReview", {
      data: null,
      errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "req-1" } }]
    })
    const failed = await render()
    expect(failed.get("[data-review-state]").attributes("data-review-state")).toBe("error")
    expect(failed.text()).toContain("review.error.title")

    responses.set("GetTranslationReview", {
      data: null,
      errors: [{ extensions: { code: "NOT_FOUND", entity: "translation" } }]
    })
    await render()
    expect(createdErrors.at(-1)).toMatchObject({ statusCode: 404 })
  })

  it("redirects unauthenticated and archived sessions without exposing the translation", async () => {
    responses.set("GetTranslationReview", { data: null, errors: [{ extensions: { code: "UNAUTHENTICATED" } }] })
    await render()
    expect(navigations[0]).toBe("/login?next=%2Fme%2Farticles%2Ftranslation-1%2Freview")

    navigations.length = 0
    responses.set("GetTranslationReview", {
      data: null,
      errors: [{ extensions: { code: "FORBIDDEN", action: "translation.review.read" } }]
    })
    await render()
    expect(navigations[0]).toBe("/me/archived")
  })
})
