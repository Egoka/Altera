// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { computed, defineComponent, ref } from "vue"
import { Kind, type DocumentNode } from "graphql"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AccountAppealPage from "../app/pages/auth/appeal.vue"

const operationName = (document: DocumentNode): string => {
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) return definition.name?.value ?? ""
  }
  return ""
}

const view = (status: "none" | "submitted" | "restored" | "confirmed" = "none") => ({
  locale: "ru",
  archivedAt: "2026-09-20T12:00:00.000Z",
  reasonCategory: "spam_and_manipulation",
  explanation: "Массовая рассылка и накрутка.",
  staffMessage: "Обнаружена массовая рассылка ссылок.",
  plan: { tier: "standard", until: "2026-12-01T00:00:00.000Z" },
  appeal: {
    id: status === "none" ? null : "appeal-1",
    status,
    submittedAt: status === "none" ? null : "2026-09-21T12:00:00.000Z",
    decidedAt: status === "restored" || status === "confirmed" ? "2026-09-22T12:00:00.000Z" : null
  },
  canSubmit: status === "none"
})

let envelope: Record<string, unknown>
let asyncPending = false
const statuses: number[] = []
const graphQLRequest = vi.fn(async (document: DocumentNode) => {
  if (operationName(document) === "SubmitAccountAppeal") return envelope
  return envelope
})

const render = async () => {
  const host = defineComponent({
    components: { Page: AccountAppealPage },
    template: "<Suspense><Page /></Suspense>"
  })
  const wrapper = mount(host, {
    global: {
      stubs: {
        NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' }
      }
    }
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  envelope = { data: { accountAppeal: view() } }
  asyncPending = false
  statuses.length = 0
  graphQLRequest.mockClear()

  vi.stubGlobal("computed", computed)
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useSeoMeta", vi.fn())
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useRoute", () => ({ query: { token: "appeal-token" } }))
  vi.stubGlobal("useRequestEvent", () => ({}))
  vi.stubGlobal("useI18n", () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${Object.values(params).join(",")}` : key),
    setLocale: vi.fn()
  }))
  vi.stubGlobal("useGraphQL", graphQLRequest)
  vi.stubGlobal("setResponseStatus", (_event: unknown, status: number) => statuses.push(status))
  vi.stubGlobal("useAsyncData", (_key: unknown, handler: () => Promise<unknown>) => {
    const data = ref<unknown>(null)
    const status = ref("pending")
    const refresh = async () => {
      if (asyncPending) return
      data.value = await handler()
      status.value = "success"
    }
    void refresh()
    return { data, status, refresh }
  })
})

afterEach(() => vi.unstubAllGlobals())

describe("blocked account appeal page", () => {
  it("shows a loading skeleton while the token state is read", async () => {
    asyncPending = true

    const wrapper = await render()

    expect(wrapper.get("[data-appeal-state]").attributes("data-appeal-state")).toBe("loading")
  })

  it("shows the blocking reason, paid-plan warning and one-time form", async () => {
    const wrapper = await render()

    expect(wrapper.get("[data-appeal-state]").attributes("data-appeal-state")).toBe("none")
    expect(wrapper.text()).toContain("auth.appeal.reasonCategory.spam_and_manipulation")
    expect(wrapper.text()).toContain("Массовая рассылка и накрутка.")
    expect(wrapper.text()).toContain("Обнаружена массовая рассылка ссылок.")
    expect(wrapper.find("[data-appeal-plan]").exists()).toBe(true)
    expect(wrapper.find("[data-appeal-form]").exists()).toBe(true)
  })

  it.each([
    ["submitted", "auth.appeal.submitted.title"],
    ["restored", "auth.appeal.restored.title"],
    ["confirmed", "auth.appeal.confirmed.title"]
  ] as const)("renders the %s state instead of the form", async (state, expectedKey) => {
    envelope = { data: { accountAppeal: view(state) } }

    const wrapper = await render()

    expect(wrapper.get("[data-appeal-state]").attributes("data-appeal-state")).toBe(state)
    expect(wrapper.text()).toContain(expectedKey)
    expect(wrapper.find("[data-appeal-form]").exists()).toBe(false)
  })

  it.each([
    ["NOT_FOUND", "not_found", 404],
    ["FORBIDDEN", "forbidden", 403],
    ["RATE_LIMITED", "rate_limited", 200],
    ["INTERNAL_ERROR", "error", 500]
  ] as const)("maps %s to the %s page state", async (code, state, httpStatus) => {
    envelope = { errors: [{ extensions: { code, requestId: "req-1", retryAfter: 90 } }] }

    const wrapper = await render()

    expect(wrapper.get("[data-appeal-state]").attributes("data-appeal-state")).toBe(state)
    expect(statuses).toContain(httpStatus)
  })

  it("validates the message length and turns a successful submit into the submitted state", async () => {
    const wrapper = await render()
    const form = wrapper.get("[data-appeal-form]")

    await form.get("textarea").setValue("коротко")
    await form.trigger("submit")
    expect(wrapper.get("[data-appeal-validation]").exists()).toBe(true)

    envelope = {
      data: {
        submitAccountAppeal: {
          id: "appeal-1",
          status: "submitted",
          submittedAt: "2026-09-21T12:00:00.000Z",
          decidedAt: null
        }
      }
    }
    await form.get("textarea").setValue("Прошу повторно проверить обстоятельства блокировки аккаунта.")
    await form.trigger("submit")
    await flushPromises()

    expect(wrapper.get("[data-appeal-state]").attributes("data-appeal-state")).toBe("submitted")
  })
})
