// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { defineComponent, h, ref, Suspense } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AppHeader from "../app/components/app/header.vue"
import LanguageToggle from "../app/components/functional/LanguageToggle.vue"
import { useGraphQL } from "../app/composables/useGraphQL"

vi.mock("~/composables/useScroll", () => ({
  useScroll: () => ({ isScrolled: ref(false), isHeaderVisible: ref(true) })
}))

vi.mock("~/composables/useGraphQL", () => ({ useGraphQL: vi.fn() }))

const messages: Record<string, string> = {
  "common.logoHome": "Altera — на главную",
  "common.login": "Войти",
  "common.write": "Писать",
  "language.switchTo": "Switch language to {language}",
  "navigation.primary": "Основная навигация",
  "navigation.sections": "Рубрики",
  "navigation.sectionsLoading": "Загружаем рубрики…",
  "navigation.sectionsEmpty": "Пока нет опубликованных рубрик.",
  "navigation.articleCount": "{count} материалов",
  "navigation.trending": "Сейчас читают",
  "navigation.allSections": "Все рубрики",
  "footer.rss": "RSS"
}
const t = (key: string, params: Record<string, string | number> = {}) =>
  Object.entries(params).reduce(
    (message, [name, value]) => message.replace(`{${name}}`, String(value)),
    messages[key] ?? key
  )

const head = vi.fn()

/** Шапка объявляет ленту через `useHead`: в тестах он подменяется, как на других страницах. */
const headLinks = (): Record<string, string>[] => {
  const link = head.mock.calls.at(-1)?.[0]?.link
  return typeof link === "function" ? link() : (link ?? [])
}

const graphql = vi.mocked(useGraphQL)

const navigationResponse = {
  data: {
    publicSections: [
      { id: "culture", name: "Культура", nameEn: "Culture", slug: "culture", order: 1, articleCount: 8 },
      { id: "travel", name: "Путешествия", nameEn: "Travel", slug: "travel", order: 2, articleCount: 3 }
    ],
    popularTags: [{ slug: "photo", name: "Фотография", articleCount: 4 }]
  }
}

/**
 * Локаль страницы задаётся один раз на монтирование: `localePath` под неё префиксует адрес
 * ровно так же, как стратегия `prefix_except_default` в приложении.
 */
const useLocale = (locale: "ru" | "en") => {
  vi.stubGlobal("useI18n", () => ({
    t,
    locale: ref(locale),
    locales: ref([
      { code: "ru", name: "Русский" },
      { code: "en", name: "English" }
    ])
  }))
  vi.stubGlobal("useLocalePath", () => (path: string) => (locale === "en" ? `/en${path === "/" ? "" : path}` : path))
}

/**
 * Шапка грузит меню в `setup`, поэтому монтируется внутри `Suspense` — так же, как её
 * оборачивает `NuxtLayout` в приложении.
 */
const SuspendedHeader = defineComponent({
  setup: () => () => h(Suspense, null, { default: () => h(AppHeader) })
})

const mountHeader = async () => {
  const wrapper = mount(SuspendedHeader, {
    global: {
      stubs: {
        NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
        LanguageToggle: true,
        VisualLogo: { template: "<span>Altera</span>" },
        IconBurger: true
      }
    }
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  head.mockClear()
  graphql.mockReset()
  graphql.mockResolvedValue(navigationResponse as never)
  vi.stubGlobal("useHead", head)
  // Меню грузится при отрисовке страницы, а не после монтирования: `useAsyncData` в тестах
  // разрешается сразу, как это делает SSR перед отдачей разметки.
  vi.stubGlobal("useAsyncData", async (_key: unknown, handler: () => Promise<unknown>) => ({
    data: ref(await handler()),
    status: ref("success"),
    refresh: vi.fn()
  }))
  useLocale("ru")
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("AppHeader navigation", () => {
  it("строит меню из публичных рубрик ответа GraphQL", async () => {
    const wrapper = await mountHeader()

    expect(wrapper.get('nav[aria-label="Рубрики"]').text()).toContain("Культура")
    expect(wrapper.get('a[href="/travel"]').text()).toContain("Путешествия")
    expect(graphql).toHaveBeenCalledOnce()
    expect(graphql.mock.calls[0]![1]).toEqual({ locale: "ru" })
  })

  // AC-3 T-129: меню английской страницы спрашивает свою локаль и называет рубрики `nameEn`.
  it("на английской странице запрашивает свою локаль, ведёт в неё и берёт nameEn", async () => {
    useLocale("en")

    const wrapper = await mountHeader()

    expect(graphql.mock.calls[0]![1]).toEqual({ locale: "en" })
    const menu = wrapper.get('nav[aria-label="Рубрики"]')
    expect(menu.text()).toContain("Culture")
    expect(menu.text()).not.toContain("Культура")
    expect(wrapper.get('a[href="/en/travel"]').text()).toContain("Travel")
    expect(wrapper.find('a[href="/travel"]').exists()).toBe(false)
  })

  // Меню обязано быть в ответе SSR, поэтому оно рисуется закрытым, а не появляется по клику.
  it("держит рубрики в разметке до открытия меню", async () => {
    const wrapper = await mountHeader()

    expect(wrapper.get("#public-navigation-menu").attributes("style")).toContain("display: none")
    expect(wrapper.get('a[href="/culture"]').exists()).toBe(true)
  })

  it("пустой перевод рубрики оставляет её имя по умолчанию", async () => {
    useLocale("en")
    graphql.mockResolvedValue({
      data: {
        publicSections: [
          { id: "culture", name: "Культура", nameEn: "   ", slug: "culture", order: 1, articleCount: 8 }
        ],
        popularTags: []
      }
    } as never)

    const wrapper = await mountHeader()

    expect(wrapper.get('a[href="/en/culture"]').text()).toContain("Культура")
  })
})

// Ссылка на ленту в шапке: `docs/spec/20-public/feeds-and-sitemap.md` §3, §6.
describe("AppHeader RSS", () => {
  it("объявляет ленту русской локали", async () => {
    await mountHeader()

    expect(headLinks()).toContainEqual({
      rel: "alternate",
      type: "application/rss+xml",
      title: "RSS",
      href: "/rss.xml"
    })
  })

  it("в английской локали ведёт на её ленту", async () => {
    useLocale("en")

    await mountHeader()

    expect(headLinks()[0]!.href).toBe("/en/rss.xml")
  })
})

describe("LanguageToggle compact mode", () => {
  it("сохраняет полное доступное имя, но освобождает место в мобильной шапке", () => {
    vi.stubGlobal("useSwitchLocalePath", () => () => "/en")

    const wrapper = mount(LanguageToggle, {
      props: { compact: true },
      global: { stubs: { NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' } } }
    })

    expect(wrapper.get("a").text()).toBe("EN")
    expect(wrapper.get("a").attributes("aria-label")).toBe("Switch language to English")
  })
})
