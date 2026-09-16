// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AppHeader from "../app/components/app/header.vue"
import LanguageToggle from "../app/components/functional/LanguageToggle.vue"

vi.mock("~/composables/useScroll", () => ({
  useScroll: () => ({ isScrolled: ref(false), isHeaderVisible: ref(true) })
}))

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
  "navigation.allSections": "Все рубрики"
}
const t = (key: string, params: Record<string, string | number> = {}) =>
  Object.entries(params).reduce(
    (message, [name, value]) => message.replace(`{${name}}`, String(value)),
    messages[key] ?? key
  )

beforeEach(() => {
  vi.stubGlobal("useI18n", () => ({
    t,
    locale: ref("ru"),
    locales: ref([
      { code: "ru", name: "Русский" },
      { code: "en", name: "English" }
    ])
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("AppHeader navigation", () => {
  it("строит меню из публичных рубрик ответа GraphQL", async () => {
    const requestFetch = vi.fn().mockResolvedValue({
      data: {
        publicSections: [
          { id: "culture", name: "Культура", nameEn: "Culture", slug: "culture", order: 1, articleCount: 8 },
          { id: "travel", name: "Путешествия", nameEn: "Travel", slug: "travel", order: 2, articleCount: 3 }
        ],
        popularTags: { tags: [{ name: "Фотография", slug: "photo" }] }
      }
    })
    vi.stubGlobal("useRequestFetch", () => requestFetch)

    const wrapper = mount(AppHeader, {
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
    await wrapper.get('button[aria-controls="public-navigation-menu"]').trigger("click")

    expect(wrapper.get('nav[aria-label="Рубрики"]').text()).toContain("Культура")
    expect(wrapper.get('a[href="/travel"]').text()).toContain("Путешествия")
    expect(requestFetch).toHaveBeenCalledOnce()
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
