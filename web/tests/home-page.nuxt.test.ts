// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { computed, defineComponent, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import HomePage from "../app/pages/index.vue"

// Строки состояний `20-public/home.md` §8: готовая страница с подборками, «Пусто»,
// «Ошибка данных» и скелеты при клиентской навигации.

const messages: Record<string, string> = {
  "home.latest": "Новое",
  "home.popular": "Популярное за неделю",
  "home.captionByDate": "по дате публикации",
  "home.emptyTitle": "Здесь пока пусто",
  "home.emptyDescription": "Станьте первым автором Altera.",
  "home.emptyAction": "Стать автором",
  "reading.loading": "Материалы загружаются"
}

const t = (key: string) => messages[key] ?? key

const feedItem = (id: string) => ({
  id,
  slug: `slug-${id}`,
  sectionSlug: "culture",
  sectionName: "Культура",
  title: `Материал ${id}`,
  dek: null,
  cover: null,
  publishedAt: "2026-09-20T10:00:00.000Z",
  isTranslation: false,
  author: { name: "Автор", handle: "author", grade: "standard" }
})

const feedSection = (key: string, count: number) => ({
  key,
  caption: "by_publication_date",
  items: Array.from({ length: count }, (_, index) => feedItem(`${key}-${index + 1}`))
})

const sectionStub = (mark: string) => ({
  props: ["articles", "caption"],
  template: `<section data-zone="${mark}" :data-count="articles.length">{{ caption }}</section>`
})

const stubs = {
  PagesStartFeatured: sectionStub("top"),
  PagesStartLatest: sectionStub("new"),
  PagesStartPopular: sectionStub("popular"),
  ReadingEmptyState: {
    props: ["title", "description", "actionLabel", "actionTo"],
    template: '<div data-zone="empty" :data-action="actionTo">{{ title }} {{ actionLabel }}</div>'
  },
  ReadingErrorState: {
    props: ["requestId"],
    template: '<div data-zone="error" :data-request-id="requestId">error</div>'
  },
  ReadingLoadingSkeleton: { template: '<div data-zone="skeleton" />' }
}

const graphQLRequest = vi.fn()

/** Состояние собирается из ответа `feed`: страница сама разбирает конверт GraphQL. */
const respondWith = (envelope: unknown) => graphQLRequest.mockResolvedValue(envelope)

// Страница ждёт данные в setup, поэтому монтируется под <Suspense>.
const renderHome = async () => {
  const host = defineComponent({ components: { HomePage }, template: "<Suspense><HomePage /></Suspense>" })
  const wrapper = mount(host, { global: { stubs } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  graphQLRequest.mockReset()
  vi.stubGlobal("computed", computed)
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("useI18n", () => ({ t, locale: ref("ru") }))
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("createError", (input: object) => Object.assign(new Error("feed failed"), input))
  vi.stubGlobal("useGraphQL", graphQLRequest)
  vi.stubGlobal("useAsyncData", async (_key: unknown, handler: () => Promise<unknown>) => {
    try {
      return { data: ref(await handler()), error: ref(null), status: ref("success") }
    } catch (thrown) {
      return { data: ref(null), error: ref(thrown), status: ref("error") }
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("главная", () => {
  it("рисует подборки в порядке ответа и показывает подпись принципа", async () => {
    respondWith({ data: { feed: { locale: "ru", sections: [feedSection("top", 5), feedSection("new", 12)] } } })

    const wrapper = await renderHome()
    const zones = wrapper.findAll("[data-zone]").map((zone) => zone.attributes("data-zone"))

    expect(zones).toEqual(["top", "new"])
    expect(wrapper.get('[data-zone="top"]').attributes("data-count")).toBe("5")
    expect(wrapper.get('[data-zone="new"]').attributes("data-count")).toBe("12")
    expect(wrapper.get('[data-zone="top"]').text()).toBe("по дате публикации")
  })

  it("показывает «Популярное», когда подборка приходит с сервера", async () => {
    respondWith({ data: { feed: { locale: "ru", sections: [feedSection("top", 1), feedSection("popular", 10)] } } })

    const wrapper = await renderHome()

    expect(wrapper.findAll("[data-zone]").map((zone) => zone.attributes("data-zone"))).toEqual(["top", "popular"])
  })

  it("на пустой базе оставляет приглашение авторам со ссылкой на цены", async () => {
    respondWith({ data: { feed: { locale: "ru", sections: [] } } })

    const wrapper = await renderHome()

    expect(wrapper.get('[data-zone="empty"]').attributes("data-action")).toBe("/pricing")
    expect(wrapper.get('[data-zone="empty"]').text()).toContain("Здесь пока пусто")
    expect(wrapper.find('[data-zone="top"]').exists()).toBe(false)
  })

  it("отказ подборок показывает состояние ошибки с кодом запроса", async () => {
    respondWith({ errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "req-home" } }] })

    const wrapper = await renderHome()

    expect(wrapper.get('[data-zone="error"]').attributes("data-request-id")).toBe("req-home")
  })

  it("клиентская навигация показывает скелеты подборок", async () => {
    vi.stubGlobal("useAsyncData", async () => ({ data: ref(null), error: ref(null), status: ref("pending") }))

    const wrapper = await renderHome()

    expect(wrapper.find('[data-zone="skeleton"]').exists()).toBe(true)
  })

  it("запрашивает подборки для локали страницы", async () => {
    respondWith({ data: { feed: { locale: "ru", sections: [] } } })

    await renderHome()

    expect(graphQLRequest).toHaveBeenCalledWith(expect.anything(), { locale: "ru" })
  })
})
