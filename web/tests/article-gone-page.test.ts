// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { computed, defineComponent, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ArticlePage from "../app/pages/[slugTypeContent]/[slugArticle].vue"

const event = {}
const setResponseStatus = vi.fn()

beforeEach(() => {
  vi.stubGlobal("computed", computed)
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useRoute", () => ({ params: { slugArticle: "withdrawn-article" } }))
  vi.stubGlobal("useLocalePath", () => (path: string) => path)
  vi.stubGlobal("useI18n", () => ({
    t: (key: string) =>
      ({
        "article.goneTitle": "Материал снят с публикации",
        "article.goneDescription": "Этот материал больше недоступен публично.",
        "article.goneHome": "На главную"
      })[key] ?? key
  }))
  vi.stubGlobal(
    "useGraphQL",
    vi.fn().mockResolvedValue({
      data: { article: null },
      errors: [{ message: "Entity archived", extensions: { code: "ARCHIVED" } }]
    })
  )
  vi.stubGlobal("useAsyncData", async (_key: unknown, handler: () => Promise<unknown>) => ({
    data: ref(await handler()),
    error: ref(null)
  }))
  vi.stubGlobal("useRequestEvent", () => event)
  vi.stubGlobal("setResponseStatus", setResponseStatus)
  vi.stubGlobal("useSeoMeta", vi.fn())
  vi.stubGlobal("createError", (value: unknown) => value)
})

afterEach(() => {
  setResponseStatus.mockReset()
  vi.unstubAllGlobals()
})

describe("archived article page", () => {
  it("renders the neutral gone state and sets the SSR response to 410", async () => {
    const host = defineComponent({
      components: { ArticlePage },
      template: "<Suspense><ArticlePage /></Suspense>"
    })
    const wrapper = mount(host, {
      global: {
        stubs: {
          HeaderTag: true,
          NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' }
        }
      }
    })
    await flushPromises()

    expect(wrapper.text()).toContain("410")
    expect(wrapper.text()).toContain("Материал снят с публикации")
    expect(wrapper.text()).not.toContain("Entity archived")
    expect(setResponseStatus).toHaveBeenCalledWith(event, 410)
  })
})
