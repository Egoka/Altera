// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ArticleCard from "../app/components/article/Card.vue"
import BookmarkButton from "../app/components/reading/BookmarkButton.vue"
import EmptyState from "../app/components/reading/EmptyState.vue"
import ErrorState from "../app/components/reading/ErrorState.vue"
import LoadingSkeleton from "../app/components/reading/LoadingSkeleton.vue"

const article = {
  id: "article-1",
  title: "Город, который слушает море",
  slug: "gorod-slushaet-more",
  dek: "Портовый дневник о памяти, ветре и возвращении домой.",
  featuredImage: "/images/sea.jpg",
  publishedAt: "2026-09-15T10:00:00.000Z",
  isTranslation: true,
  author: { name: "Анна Волкова", slug: "anna-volkova", grade: "pro" as const },
  section: { name: "Путешествия", slug: "travel" }
}

const global = {
  stubs: {
    NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
    NuxtImg: { props: ["src", "alt"], template: '<img :src="src" :alt="alt" />' }
  }
}

const messages: Record<string, string> = {
  "reading.translation": "Перевод",
  "reading.loginToBookmark": "Войти, чтобы сохранить материал",
  "reading.removeBookmark": "Убрать из закладок",
  "reading.addBookmark": "Добавить в закладки",
  "reading.loadErrorTitle": "Не удалось загрузить материалы",
  "reading.loadErrorDescription": "Обновите страницу или напишите в редакцию.",
  "reading.requestCode": "Код запроса: {requestId}",
  "reading.contactEditorial": "Написать в редакцию",
  "reading.loading": "Материалы загружаются",
  "reading.proAuthor": "Автор уровня pro"
}
const t = (key: string, params: Record<string, string | number> = {}) =>
  Object.entries(params).reduce(
    (message, [name, value]) => message.replace(`{${name}}`, String(value)),
    messages[key] ?? key
  )

beforeEach(() => {
  vi.stubGlobal("useI18n", () => ({ t }))
})

describe("ArticleCard snapshots", () => {
  it.each([
    ["lede", undefined],
    ["large", undefined],
    ["small", undefined],
    ["rank", 2]
  ] as const)("фиксирует редакционную разметку варианта %s", (variant, rank) => {
    const wrapper = mount(ArticleCard, { props: { article, variant, rank }, global })

    expect(wrapper.html()).toMatchSnapshot()
  })

  it("оставляет карточку доступной без изображения и сохраняет метки pro/перевода", () => {
    const wrapper = mount(ArticleCard, {
      props: { article: { ...article, featuredImage: null }, variant: "large" },
      global
    })

    expect(wrapper.find("img").exists()).toBe(false)
    expect(wrapper.text()).toContain("pro")
    expect(wrapper.text()).toContain("Перевод")
    expect(wrapper.html()).toMatchSnapshot()
  })
})

describe("BookmarkButton", () => {
  it("сообщает владельцу следующее состояние закладки", async () => {
    const wrapper = mount(BookmarkButton, { props: { bookmarked: false }, global })

    await wrapper.get("button").trigger("click")

    expect(wrapper.emitted("toggle")).toEqual([[true]])
  })

  it("фиксирует состояния гостя и занятой мутации", () => {
    const guest = mount(BookmarkButton, { props: { guest: true, loginPath: "/login?next=%2F" }, global })
    const busy = mount(BookmarkButton, { props: { bookmarked: true, busy: true }, global })

    expect({ guest: guest.html(), busy: busy.html() }).toMatchSnapshot()
  })
})

describe("reading list states", () => {
  it("фиксирует пустое, ошибочное и загрузочное состояния", () => {
    const empty = mount(EmptyState, {
      props: { title: "Здесь пока пусто", actionLabel: "Стать автором", actionTo: "/pricing" },
      global
    })
    const error = mount(ErrorState, { props: { requestId: "req-123" }, global })
    const loading = mount(LoadingSkeleton, { props: { cards: 2 } })

    expect({ empty: empty.html(), error: error.html(), loading: loading.html() }).toMatchSnapshot()
  })
})
