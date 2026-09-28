// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ArticleCard from "../app/components/article/Card.vue"
import BookmarkButton from "../app/components/reading/BookmarkButton.vue"
import EmptyState from "../app/components/reading/EmptyState.vue"
import ErrorState from "../app/components/reading/ErrorState.vue"
import LoadingSkeleton from "../app/components/reading/LoadingSkeleton.vue"

/**
 * Обложка материала (T-066): базовые варианты исходной композиции и кадры карточек по фокусной
 * точке. Карточка выбирает кадр по своему варианту, а не отдельный файл на каждый размер.
 */
const cover = {
  url: "/media/sea-w960.webp",
  alt: "Волнорез в утреннем тумане",
  variants: {
    version: 1,
    placeholder: "data:image/webp;base64,AA==",
    thumbnailWidth: 480,
    items: [
      { format: "webp", width: 480, height: 320, url: "/media/sea-w480.webp" },
      { format: "webp", width: 960, height: 640, url: "/media/sea-w960.webp" },
      { format: "webp", width: 480, height: 240, url: "/media/sea-lede-w480.webp", crop: "lede" },
      { format: "webp", width: 960, height: 480, url: "/media/sea-lede-w960.webp", crop: "lede" },
      { format: "webp", width: 480, height: 320, url: "/media/sea-large-w480.webp", crop: "large" },
      { format: "webp", width: 960, height: 640, url: "/media/sea-large-w960.webp", crop: "large" }
    ]
  }
}

const article = {
  id: "article-1",
  title: "Город, который слушает море",
  slug: "gorod-slushaet-more",
  dek: "Портовый дневник о памяти, ветре и возвращении домой.",
  cover,
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

/** Русская локаль адрес не префиксует, поэтому заглушка `localePath` возвращает его как есть. */
beforeEach(() => {
  vi.stubGlobal("useI18n", () => ({ t }))
  vi.stubGlobal("useLocalePath", () => (path: string) => path)
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

  it("берёт кадр обложки под свой вариант: `small` делит кадр с `large`", () => {
    // Соотношения карточек — `article-covers.md` п. 3; `small` и `large` отличаются `sizes`,
    // а не файлами (`image-variants.md` §2 п. 5).
    const lede = mount(ArticleCard, { props: { article, variant: "lede" }, global })
    const small = mount(ArticleCard, { props: { article, variant: "small" }, global })

    expect(lede.get("img").attributes("srcset")).toContain("/media/sea-lede-w960.webp")
    expect(lede.get("img").attributes("srcset")).not.toContain("/media/sea-large-")
    expect(small.get("img").attributes("srcset")).toContain("/media/sea-large-w960.webp")
    expect(small.get("img").attributes("srcset")).not.toContain("/media/sea-lede-")
  })

  it("в ленте нет заполнителя: без обложки карточка показывает только текст", () => {
    // Дефолтных изображений в лентах нет (журнал §29.1, `article-covers.md` п. 4): заполнитель
    // черновика живёт в кабинете автора, а не в карточке.
    const wrapper = mount(ArticleCard, { props: { article: { ...article, cover: null }, variant: "lede" }, global })

    expect(wrapper.find("img").exists()).toBe(false)
    expect(wrapper.find("figure").exists()).toBe(false)
    expect(wrapper.find("[data-cover-placeholder]").exists()).toBe(false)
  })

  it("оставляет карточку доступной без изображения и сохраняет метки pro/перевода", () => {
    const wrapper = mount(ArticleCard, {
      props: { article: { ...article, cover: null }, variant: "large" },
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
