// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { computed, defineComponent, onMounted, onUnmounted, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ErrorPage from "../app/error.vue"
import NotFound from "../app/components/service/NotFound.vue"
import ServerError from "../app/components/service/ServerError.vue"
import ReportLinkForm from "../app/components/service/ReportLinkForm.vue"
import CachedList from "../app/components/service/CachedList.vue"
import CopyField from "../app/components/reading/CopyField.vue"
import OfflinePage from "../app/pages/offline.vue"
import { serviceRequestId } from "../app/utils/serviceError"

// Строки состояний §8 трёх служебных спецификаций: `not-found.md`, `error.md`, `offline.md`.
// Проверка журнала §28.4 — `requestId` только при техническом сбое — стоит отдельным тестом.

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key

const feedItem = (id: string) => ({
  id,
  slug: `slug-${id}`,
  sectionSlug: "culture",
  sectionName: "Культура",
  title: `Материал ${id}`,
  dek: null,
  cover: null,
  publishedAt: "2026-09-18T10:00:00.000Z",
  isTranslation: false,
  author: { name: "Автор", handle: "author", grade: "standard" }
})

const homeFeed = (items: ReturnType<typeof feedItem>[]) => ({
  data: {
    feed: { locale: "ru", sections: items.length ? [{ key: "top", caption: "by_publication_date", items }] : [] }
  }
})

const stubs = {
  AppHeader: {
    props: { static: Boolean, minimal: Boolean },
    template: '<header data-zone="header" :data-static="String(Boolean($props.static))" />'
  },
  AppMain: { template: "<main><slot /></main>" },
  AppFooter: { template: '<footer data-zone="footer" />' },
  ArticleCard: {
    props: ["article", "variant", "locale"],
    template: '<article data-zone="card">{{ article.title }}</article>'
  },
  ReadingLoadingSkeleton: { props: ["cards"], template: '<div data-zone="skeleton" />' },
  ReadingDateStamp: { props: ["time", "locale"], template: "<time>{{ time }}</time>" },
  NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
  NuxtRouteAnnouncer: { template: "<div />" },
  Html: { template: "<div><slot /></div>" },
  Body: { template: "<div><slot /></div>" }
}

// Автоимпорт Nuxt по именам каталогов в юнит-среде не работает: компоненты регистрируются явно.
const components = {
  ServiceNotFound: NotFound,
  ServiceServerError: ServerError,
  ServiceReportLinkForm: ReportLinkForm,
  ServiceCachedList: CachedList,
  ReadingCopyField: CopyField
}

const graphQLRequest = vi.fn()
const routeQuery = ref<Record<string, unknown>>({})
const routeFullPath = ref("/culture/missing?ref=letter")
const states = new Map<string, unknown>()

const render = async (component: unknown, props: Record<string, unknown> = {}) => {
  const host = defineComponent({
    components: { Page: component as never },
    props: { bound: { type: Object, default: () => ({}) } },
    template: "<Suspense><Page v-bind='bound' /></Suspense>"
  })
  const wrapper = mount(host, { props: { bound: props }, global: { stubs, components } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  graphQLRequest.mockReset()
  states.clear()
  routeQuery.value = {}
  routeFullPath.value = "/culture/missing?ref=letter"
  vi.stubGlobal("computed", computed)
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("onMounted", onMounted)
  vi.stubGlobal("onUnmounted", onUnmounted)
  vi.stubGlobal("useI18n", () => ({ t, locale: ref("ru") }))
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useSeoMeta", vi.fn())
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useLocalePath", () => (path: string) => path)
  vi.stubGlobal("useRoute", () => ({ query: routeQuery.value, fullPath: routeFullPath.value, params: {} }))
  vi.stubGlobal("useRequestEvent", () => ({ context: { requestId: "event-request-id" } }))
  vi.stubGlobal("useGraphQL", graphQLRequest)
  vi.stubGlobal("useState", (key: string, init: () => unknown) => {
    if (!states.has(key)) states.set(key, ref(init()))
    return states.get(key)
  })
  vi.stubGlobal(
    "useAsyncData",
    async (_key: unknown, handler: () => Promise<unknown>, options?: { default?: () => unknown }) => {
      try {
        return { data: ref(await handler()), error: ref(null), status: ref("success") }
      } catch (thrown) {
        return { data: ref(options?.default?.() ?? null), error: ref(thrown), status: ref("error") }
      }
    }
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("страница 404", () => {
  it("показывает сообщение, ссылки и три карточки подборки", async () => {
    graphQLRequest.mockResolvedValue(homeFeed([feedItem("1"), feedItem("2"), feedItem("3"), feedItem("4")]))

    const wrapper = await render(NotFound)

    expect(wrapper.get('[data-testid="not-found"]').text()).toContain("service.notFoundTitle")
    expect(wrapper.findAll('a[href="/"]').length).toBeGreaterThan(0)
    expect(wrapper.find('a[href="/sections"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/authors"]').exists()).toBe(true)
    // Зона 4 — ровно три карточки `small` (`not-found.md` §5).
    expect(wrapper.findAll('[data-zone="card"]')).toHaveLength(3)
  })

  it("строка «Пусто»: пустая лента оставляет ссылки без карточек", async () => {
    graphQLRequest.mockResolvedValue(homeFeed([]))

    const wrapper = await render(NotFound)

    expect(wrapper.findAll('[data-zone="card"]')).toHaveLength(0)
    expect(wrapper.find('a[href="/sections"]').exists()).toBe(true)
  })

  it("строка «Ошибка данных»: отказ ленты скрывает зону и не ломает страницу", async () => {
    graphQLRequest.mockResolvedValue({ errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "feed-id" } }] })

    const wrapper = await render(NotFound)

    expect(wrapper.findAll('[data-zone="card"]')).toHaveLength(0)
    expect(wrapper.get('[data-testid="not-found"]').text()).toContain("service.notFoundTitle")
    expect(wrapper.text()).not.toContain("feed-id")
  })

  it("строка «Загрузка»: клиентская навигация показывает скелет карточек", async () => {
    vi.stubGlobal("useAsyncData", async () => ({ data: ref(null), error: ref(null), status: ref("pending") }))

    const wrapper = await render(NotFound)

    expect(wrapper.find('[data-zone="skeleton"]').exists()).toBe(true)
  })

  it("в обращение о битой ссылке уходит путь без query", async () => {
    graphQLRequest.mockResolvedValue(homeFeed([]))

    const wrapper = await render(NotFound)

    expect(wrapper.getComponent(ReportLinkForm).props("path")).toBe("/culture/missing")
  })
})

describe("страница 500", () => {
  it("показывает код запроса, копирование и три действия", async () => {
    const wrapper = await render(ServerError, { requestId: "abc-123" })

    expect(wrapper.get('[data-testid="copy-field-value"]').text()).toBe("abc-123")
    expect(wrapper.get('[data-testid="server-error-contact"]').attributes("href")).toBe("/contact?requestId=abc-123")
    expect(wrapper.find('[data-testid="server-error-retry"]').exists()).toBe(true)
    expect(wrapper.text()).toContain("service.serverErrorRepeated")
  })

  it("не ходит в API: шапка статическая", async () => {
    const wrapper = await render(ServerError, { requestId: "abc-123" })

    expect(wrapper.get('[data-zone="header"]').attributes("data-static")).toBe("true")
    expect(graphQLRequest).not.toHaveBeenCalled()
  })

  it("без кода запроса поле копирования не рисуется", async () => {
    const wrapper = await render(ServerError, { requestId: null })

    expect(wrapper.find('[data-testid="copy-field-value"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="server-error-contact"]').attributes("href")).toBe("/contact")
  })
})

describe("обработчик ошибок Nuxt", () => {
  it("404 отдаёт страницу «не найдено» и не считает код запроса", async () => {
    graphQLRequest.mockResolvedValue(homeFeed([]))

    const wrapper = await render(ErrorPage, { error: { statusCode: 404, data: { requestId: "leaked-id" } } })

    expect(wrapper.find('[data-testid="not-found"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="server-error"]').exists()).toBe(false)
    // Журнал §28.4: на обычном пользовательском состоянии кода запроса нет даже в разметке.
    expect(wrapper.html()).not.toContain("leaked-id")
    expect((states.get("service.requestId") as { value: unknown }).value).toBeNull()
  })

  it("500 берёт код запроса из отказа", async () => {
    const wrapper = await render(ErrorPage, { error: { statusCode: 500, data: { requestId: "from-error" } } })

    expect(wrapper.get('[data-testid="copy-field-value"]').text()).toBe("from-error")
  })

  it("500 без кода в отказе берёт его из контекста запроса", () => {
    expect(serviceRequestId({ statusCode: 500 }, "event-request-id")).toBe("event-request-id")
    expect(serviceRequestId({ statusCode: 500, data: { requestId: "from-error" } }, "event")).toBe("from-error")
    expect(serviceRequestId({ statusCode: 404, data: { requestId: "leaked" } }, "event")).toBeNull()
    expect(serviceRequestId(null, undefined)).toBeNull()
  })
})

describe("форма «сообщить о битой ссылке»", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("$fetch", fetchMock)
  })

  const expand = async (wrapper: Awaited<ReturnType<typeof render>>) => {
    await wrapper.get('[data-testid="report-link-toggle"]').trigger("click")
    await flushPromises()
  }

  it("свёрнута до нажатия и разворачивается в форму", async () => {
    const wrapper = await render(ReportLinkForm, { path: "/culture/missing" })

    expect(wrapper.find('[data-testid="report-link-form"]').exists()).toBe(false)
    await expand(wrapper)
    expect(wrapper.find('[data-testid="report-link-form"]').exists()).toBe(true)
  })

  it("отправленное обращение благодарит и больше не показывает форму", async () => {
    fetchMock.mockResolvedValue({ data: { createSupportRequest: { ok: true } } })
    const wrapper = await render(ReportLinkForm, { path: "/culture/missing" })

    await expand(wrapper)
    await wrapper.get('[data-testid="report-link-form"]').trigger("submit")
    await flushPromises()

    expect(wrapper.get('[data-testid="report-link-sent"]').text()).toBe("service.reportLinkSent")
    expect(fetchMock.mock.calls[0]?.[1]?.body.variables).toMatchObject({
      topic: "broken_link",
      path: "/culture/missing",
      message: null
    })
  })

  it("превышенный лимит показывает свою строку", async () => {
    fetchMock.mockResolvedValue({ errors: [{ extensions: { code: "RATE_LIMITED" } }] })
    const wrapper = await render(ReportLinkForm, { path: "/culture/missing" })

    await expand(wrapper)
    await wrapper.get('[data-testid="report-link-form"]').trigger("submit")
    await flushPromises()

    expect(wrapper.find('[data-testid="report-link-limited"]').exists()).toBe(true)
  })

  it("отказ отправки оставляет путь в редакцию", async () => {
    fetchMock.mockRejectedValue(new Error("network"))
    const wrapper = await render(ReportLinkForm, { path: "/culture/missing" })

    await expand(wrapper)
    await wrapper.get('[data-testid="report-link-form"]').trigger("submit")
    await flushPromises()

    expect(wrapper.get('[data-testid="report-link-failed"]').text()).toContain("service.reportLinkFailed")
    expect(wrapper.find('a[href^="/contact?topic=broken_link"]').exists()).toBe(true)
  })
})

describe("офлайн-страница", () => {
  const cachedPage = {
    path: "/culture/essay",
    title: "Эссе о городе",
    section: "culture",
    visitedAt: "2026-09-19T08:00:00.000Z"
  }

  it("пустой кеш объясняет, что сохранится позже", async () => {
    const wrapper = await render(CachedList, { pages: [] })

    expect(wrapper.get('[data-testid="cached-list-empty"]').text()).toBe("service.offlineSavedEmpty")
  })

  it("сохранённое показывается строкой с рубрикой и датой посещения", async () => {
    const wrapper = await render(CachedList, { pages: [cachedPage] })

    expect(wrapper.get('a[href="/culture/essay"]').text()).toBe("Эссе о городе")
    expect(wrapper.get('[data-testid="cached-list"]').text()).toContain("culture")
  })

  it("без Cache Storage список не показывается, а страница объясняет почему", async () => {
    const wrapper = await render(OfflinePage)
    await flushPromises()

    expect(wrapper.find('[data-testid="cached-list"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="offline-storage-unavailable"]').exists()).toBe(true)
    expect(wrapper.get('[data-zone="header"]').attributes("data-static")).toBe("true")
  })

  it("строка «Загрузка»: повтор показывает индикатор попытки до перехода", async () => {
    const assign = vi.fn()
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign, origin: "http://localhost", reload: vi.fn() }
    })
    routeQuery.value = { from: "/culture/essay" }

    const wrapper = await render(OfflinePage)
    await flushPromises()

    await wrapper.get('[data-testid="offline-retry"]').trigger("click")
    await flushPromises()

    expect(wrapper.find('[data-testid="offline-retrying"]').exists()).toBe(true)
    expect(assign).toHaveBeenCalledWith("/culture/essay")
  })

  it("запрошенный адрес вне кеша получает свою строку", async () => {
    const cache = { match: vi.fn().mockResolvedValue(undefined), keys: vi.fn().mockResolvedValue([]) }
    vi.stubGlobal("caches", { keys: vi.fn().mockResolvedValue([]), match: cache.match, open: vi.fn() })
    window.caches = globalThis.caches
    routeQuery.value = { from: "/culture/essay" }

    const wrapper = await render(OfflinePage)
    await flushPromises()

    expect(wrapper.get('[data-testid="offline-description"]').text()).toBe("service.offlineNotCached")
  })
})
