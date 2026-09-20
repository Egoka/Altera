// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { computed, defineComponent, onBeforeUnmount, onErrorCaptured, ref, watch } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import SectionFeedPage from "../app/pages/[slugTypeContent]/index.vue"
import TagFeedPage from "../app/pages/tags/[slug].vue"
import SectionsIndexPage from "../app/pages/sections/index.vue"
import TagsIndexPage from "../app/pages/tags/index.vue"
import AuthorsIndexPage from "../app/pages/authors/index.vue"
import AuthorPage from "../app/pages/authors/[slug].vue"

// Строки состояний §8 пяти спецификаций публичных страниц: готовая страница, «Пусто»,
// «Ошибка данных», скелеты клиентской навигации и переезд адреса на 301.

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

const listStub = (mark: string, props: string[]) => ({
  props,
  template: `<div data-zone="${mark}" :data-count="Array.isArray($props[Object.keys($props)[0]]) ? $props[Object.keys($props)[0]].length : undefined"><slot /></div>`
})

const stubs = {
  HeaderType: {
    props: ["section", "countLabel"],
    template: '<header data-zone="section-header">{{ section.name }}</header>'
  },
  HeaderTag: { props: ["tag"], template: '<header data-zone="tag-header">{{ tag.name }}</header>' },
  ReadingAuthorHeader: {
    props: ["author", "sinceLabel", "countLabel"],
    template:
      '<header data-zone="author-header" :data-since="sinceLabel" :data-count="countLabel" :data-links="author.links.length">{{ author.name }}</header>'
  },
  ArticleGroup: {
    props: ["articles", "layout", "meta"],
    template: '<section data-zone="group" :data-count="articles.length" />'
  },
  ArticleCatalog: {
    props: ["articles", "meta"],
    template: '<section data-zone="catalog" :data-count="articles.length" />'
  },
  ReadingFeedControls: {
    props: ["caption", "groups", "resetLabel", "resetTo"],
    template: '<div data-zone="controls" :data-groups="groups.length" :data-reset="resetTo" />'
  },
  ReadingPageHeader: {
    props: ["title", "count", "description", "caption", "actionLabel", "actionTo"],
    template: '<header data-zone="page-header" :data-count="count" :data-caption="caption">{{ title }}</header>'
  },
  ReadingEmptyState: {
    props: ["title", "description", "actionLabel", "actionTo"],
    template: '<div data-zone="empty" :data-action="actionTo">{{ title }}</div>'
  },
  ReadingErrorState: { props: ["requestId"], template: '<div data-zone="error" :data-request-id="requestId" />' },
  ReadingLoadingSkeleton: { props: ["cards"], template: '<div data-zone="skeleton" />' },
  ReadingPagination: {
    props: ["page", "totalPages", "to", "label"],
    template:
      '<nav data-zone="pagination" :data-total="totalPages" :data-next="totalPages > page ? to(page + 1) : undefined" />'
  },
  ReadingSectionCard: listStub("section-card", ["section", "countLabel"]),
  ReadingAuthorCard: listStub("author-card", ["author", "countLabel"]),
  ReadingTagChips: { props: ["tags", "sized"], template: '<div data-zone="chips" :data-count="tags.length" />' },
  ReadingTagList: {
    props: ["tags", "grouped"],
    template: '<div data-zone="tag-list" :data-grouped="grouped" :data-count="tags.length" />'
  },
  Input: { props: ["modelValue", "placeholder"], template: "<input />" }
}

const graphQLRequest = vi.fn()
const navigate = vi.fn()
const setStatus = vi.fn()
const requestEvent = { node: {} }
const routeQuery = ref<Record<string, unknown>>({})
const routeParams = ref<Record<string, unknown>>({})
const routePath = ref("/authors/vera")

const respondWith = (envelope: unknown) => graphQLRequest.mockResolvedValue(envelope)

const render = async (page: unknown) => {
  const host = defineComponent({ components: { Page: page as never }, template: "<Suspense><Page /></Suspense>" })
  const wrapper = mount(host, { global: { stubs } })
  await flushPromises()
  return wrapper
}

/** Отказ 404 прерывает setup страницы; он ловится хозяином, а не всплывает в отчёт. */
const renderFailing = async (page: unknown) => {
  const captured: { statusCode?: number }[] = []
  const host = defineComponent({
    components: { Page: page as never },
    setup: () => {
      onErrorCaptured((thrown) => {
        captured.push(thrown as { statusCode?: number })
        return false
      })
    },
    template: "<Suspense><Page /></Suspense>"
  })
  mount(host, { global: { stubs } })
  await flushPromises()
  return captured
}

const pending = () =>
  vi.stubGlobal("useAsyncData", async () => ({ data: ref(null), error: ref(null), status: ref("pending") }))

beforeEach(() => {
  graphQLRequest.mockReset()
  navigate.mockReset()
  setStatus.mockReset()
  routeQuery.value = {}
  routeParams.value = {}
  vi.stubGlobal("computed", computed)
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("onBeforeUnmount", onBeforeUnmount)
  vi.stubGlobal("useI18n", () => ({ t, locale: ref("ru") }))
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("navigateTo", navigate)
  vi.stubGlobal("useRoute", () => ({ query: routeQuery.value, params: routeParams.value }))
  vi.stubGlobal("useRouter", () => ({ replace: vi.fn() }))
  vi.stubGlobal("useLocalePath", () => (path: string) => path)
  vi.stubGlobal("useSwitchLocalePath", () => (target: string) => `/${target}${routePath.value}`)
  vi.stubGlobal("useRequestEvent", () => requestEvent)
  vi.stubGlobal("setResponseStatus", setStatus)
  vi.stubGlobal("useSeoMeta", vi.fn())
  vi.stubGlobal("createError", (input: object) => Object.assign(new Error("request failed"), input))
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

const sectionFeed = (overrides: Record<string, unknown> = {}) => ({
  data: {
    feed: {
      redirect: null,
      caption: "by_publication_date",
      section: { slug: "culture", name: "Культура", description: "Описание", articleCount: 30 },
      items: [feedItem("1"), feedItem("2")],
      pageInfo: { page: 1, totalPages: 2, hasNext: true },
      formats: [{ slug: "essay", name: "Эссе", count: 4 }],
      topTags: [{ slug: "ai", name: "ИИ", count: 3 }],
      otherSections: [{ slug: "society", name: "Общество", count: 5 }],
      ...overrides
    }
  }
})

describe("лента рубрики", () => {
  beforeEach(() => {
    routeParams.value = { slugTypeContent: "culture" }
  })

  it("рисует шапку рубрики, группы раскладок, панель фильтров и пагинацию", async () => {
    respondWith(sectionFeed())

    const wrapper = await render(SectionFeedPage)

    expect(wrapper.get('[data-zone="section-header"]').text()).toBe("Культура")
    expect(wrapper.get('[data-zone="controls"]').attributes("data-groups")).toBe("2")
    expect(wrapper.findAll('[data-zone="group"]')).toHaveLength(1)
    expect(wrapper.get('[data-zone="pagination"]').attributes("data-next")).toBe("/culture?page=2")
  })

  it("фильтр в адресе уходит в запрос и сбрасывается кнопкой", async () => {
    routeQuery.value = { format: "essay", tag: "ai", page: "2" }
    respondWith(sectionFeed({ items: [feedItem("1")] }))

    const wrapper = await render(SectionFeedPage)

    expect(graphQLRequest).toHaveBeenCalledWith(expect.anything(), {
      locale: "ru",
      slug: "culture",
      page: 2,
      format: "essay",
      tag: "ai"
    })
    expect(wrapper.get('[data-zone="controls"]').attributes("data-reset")).toBe("/culture")
  })

  it("пустой результат фильтра предлагает сбросить фильтры", async () => {
    routeQuery.value = { tag: "ai" }
    respondWith(sectionFeed({ items: [], pageInfo: { page: 1, totalPages: 0, hasNext: false } }))

    const wrapper = await render(SectionFeedPage)

    expect(wrapper.get('[data-zone="empty"]').attributes("data-action")).toBe("/culture")
    expect(wrapper.find('[data-zone="group"]').exists()).toBe(false)
  })

  it("архивированная рубрика уводит на преемника кодом 301", async () => {
    respondWith(sectionFeed({ redirect: { slug: "society" }, section: null, items: [] }))

    await render(SectionFeedPage)

    expect(navigate).toHaveBeenCalledWith("/society", { redirectCode: 301, replace: true })
  })

  it("отказ ленты показывает состояние ошибки с кодом запроса", async () => {
    respondWith({ errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "req-section" } }] })

    const wrapper = await render(SectionFeedPage)

    expect(wrapper.get('[data-zone="error"]').attributes("data-request-id")).toBe("req-section")
  })

  it("неизвестная рубрика прерывает страницу отказом 404, а не рисует пустую ленту", async () => {
    respondWith({ errors: [{ extensions: { code: "NOT_FOUND" } }] })

    expect(await renderFailing(SectionFeedPage)).toEqual([expect.objectContaining({ statusCode: 404 })])
  })

  it("клиентская навигация показывает скелеты", async () => {
    pending()

    expect((await render(SectionFeedPage)).find('[data-zone="skeleton"]').exists()).toBe(true)
  })
})

describe("лента тега", () => {
  beforeEach(() => {
    routeParams.value = { slug: "ai" }
  })

  const tagFeed = (overrides: Record<string, unknown> = {}) => ({
    data: {
      feed: {
        redirect: null,
        caption: "by_publication_date",
        tag: { slug: "ai", name: "ИИ", articleCount: 2 },
        items: [feedItem("1"), feedItem("2")],
        pageInfo: { page: 1, totalPages: 1, hasNext: false },
        ...overrides
      }
    }
  })

  it("рисует ровный каталог материалов под шапкой тега", async () => {
    respondWith(tagFeed())

    const wrapper = await render(TagFeedPage)

    expect(wrapper.get('[data-zone="tag-header"]').text()).toBe("ИИ")
    expect(wrapper.get('[data-zone="catalog"]').attributes("data-count")).toBe("2")
  })

  it("пусто в локали ведёт к списку тегов и не подмешивает другой язык", async () => {
    respondWith(tagFeed({ items: [], pageInfo: { page: 1, totalPages: 0, hasNext: false } }))

    const wrapper = await render(TagFeedPage)

    expect(wrapper.get('[data-zone="empty"]').attributes("data-action")).toBe("/tags")
    expect(wrapper.find('[data-zone="catalog"]').exists()).toBe(false)
  })

  it("слитый тег уводит на целевой кодом 301", async () => {
    respondWith(tagFeed({ redirect: { slug: "ai-2" }, tag: null, items: [] }))

    await render(TagFeedPage)

    expect(navigate).toHaveBeenCalledWith("/tags/ai-2", { redirectCode: 301, replace: true })
  })

  it("отказ ленты показывает состояние ошибки", async () => {
    respondWith({ errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "req-tag" } }] })

    expect((await render(TagFeedPage)).get('[data-zone="error"]').attributes("data-request-id")).toBe("req-tag")
  })

  it("архивированный тег прерывает страницу отказом 404", async () => {
    respondWith({ errors: [{ extensions: { code: "NOT_FOUND" } }] })

    expect(await renderFailing(TagFeedPage)).toEqual([expect.objectContaining({ statusCode: 404 })])
  })
})

describe("список рубрик", () => {
  it("рисует карточку на каждую непустую рубрику", async () => {
    respondWith({
      data: {
        sectionCatalog: [
          { slug: "culture", name: "Культура", description: null, cover: null, articleCount: 3, preview: [] },
          { slug: "society", name: "Общество", description: null, cover: null, articleCount: 1, preview: [] }
        ]
      }
    })

    const wrapper = await render(SectionsIndexPage)

    expect(wrapper.findAll('[data-zone="section-card"]')).toHaveLength(2)
    expect(wrapper.get('[data-zone="page-header"]').attributes("data-count")).toBe("sectionsIndex.count:2")
  })

  it("без публикаций показывает приглашение авторам", async () => {
    respondWith({ data: { sectionCatalog: [] } })

    expect((await render(SectionsIndexPage)).get('[data-zone="empty"]').attributes("data-action")).toBe("/pricing")
  })

  it("отказ каталога показывает состояние ошибки", async () => {
    respondWith({ errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "req-sections" } }] })

    expect((await render(SectionsIndexPage)).get('[data-zone="error"]').attributes("data-request-id")).toBe(
      "req-sections"
    )
  })
})

describe("список тегов", () => {
  const tagCatalog = (overrides: Record<string, unknown> = {}) => ({
    data: {
      popularTags: [{ slug: "ai", name: "ИИ", articleCount: 9 }],
      tagCatalog: {
        letters: ["И"],
        items: [{ slug: "ai", name: "ИИ", articleCount: 9 }],
        pageInfo: { page: 1, totalPages: 1, totalCount: 1, hasNext: false },
        ...overrides
      }
    }
  })

  it("показывает облако популярных и список со счётчиками", async () => {
    respondWith(tagCatalog())

    const wrapper = await render(TagsIndexPage)

    expect(wrapper.get('[data-zone="chips"]').attributes("data-count")).toBe("1")
    expect(wrapper.get('[data-zone="tag-list"]').attributes("data-count")).toBe("1")
    expect(wrapper.get('[data-zone="tag-list"]').attributes("data-grouped")).toBe("false")
  })

  it("порядок «по имени» группирует список по первой букве", async () => {
    routeQuery.value = { sort: "name" }
    respondWith(tagCatalog())

    expect((await render(TagsIndexPage)).get('[data-zone="tag-list"]').attributes("data-grouped")).toBe("true")
  })

  it("поиск без результатов предлагает сбросить, пустая база — нет", async () => {
    routeQuery.value = { q: "зет" }
    respondWith(tagCatalog({ items: [], pageInfo: { page: 1, totalPages: 0, totalCount: 0, hasNext: false } }))
    expect((await render(TagsIndexPage)).get('[data-zone="empty"]').attributes("data-action")).toBe("/tags")

    routeQuery.value = {}
    expect((await render(TagsIndexPage)).get('[data-zone="empty"]').attributes("data-action")).toBeUndefined()
  })

  it("передаёт параметры адреса в запрос каталога", async () => {
    routeQuery.value = { q: "ии", letter: "И", sort: "name", page: "2" }
    respondWith(tagCatalog())

    await render(TagsIndexPage)

    expect(graphQLRequest).toHaveBeenCalledWith(expect.anything(), {
      locale: "ru",
      q: "ии",
      letter: "И",
      sort: "name",
      page: 2
    })
  })
})

describe("список авторов", () => {
  const authorCatalog = (overrides: Record<string, unknown> = {}) => ({
    data: {
      sectionCatalog: [{ slug: "culture", name: "Культура" }],
      authorCatalog: {
        letters: ["А"],
        items: [
          {
            id: "1",
            handle: "anna",
            name: "Анна",
            avatar: null,
            grade: "standard",
            bioShort: null,
            publishedCount: 2,
            isEditorial: false,
            recent: []
          }
        ],
        pageInfo: { page: 1, totalPages: 1, totalCount: 1, hasNext: false },
        ...overrides
      }
    }
  })

  it("рисует карточки авторов и называет принцип порядка словами", async () => {
    respondWith(authorCatalog())

    const wrapper = await render(AuthorsIndexPage)

    expect(wrapper.findAll('[data-zone="author-card"]')).toHaveLength(1)
    expect(wrapper.get('[data-zone="page-header"]').attributes("data-caption")).toBe("authorsIndex.captionRecent")
  })

  it("фильтр по рубрике и буква попадают в запрос и дают кнопку сброса", async () => {
    routeQuery.value = { section: "culture", letter: "А" }
    respondWith(authorCatalog())

    const wrapper = await render(AuthorsIndexPage)

    expect(graphQLRequest).toHaveBeenCalledWith(expect.anything(), {
      locale: "ru",
      sort: "recent",
      section: "culture",
      letter: "А",
      page: 1
    })
    expect(wrapper.get('[data-zone="controls"]').attributes("data-reset")).toBe("/authors")
  })

  it("пустой каталог зовёт стать автором, пустой фильтр — сбросить", async () => {
    respondWith(authorCatalog({ items: [], pageInfo: { page: 1, totalPages: 0, totalCount: 0, hasNext: false } }))
    expect((await render(AuthorsIndexPage)).get('[data-zone="empty"]').attributes("data-action")).toBe("/pricing")

    routeQuery.value = { section: "culture" }
    expect((await render(AuthorsIndexPage)).get('[data-zone="empty"]').attributes("data-action")).toBe("/authors")
  })

  it("отказ каталога показывает состояние ошибки", async () => {
    respondWith({ errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "req-authors" } }] })

    expect((await render(AuthorsIndexPage)).get('[data-zone="error"]').attributes("data-request-id")).toBe(
      "req-authors"
    )
  })
})

describe("страница автора", () => {
  beforeEach(() => {
    routeParams.value = { slug: "vera" }
    routePath.value = "/authors/vera"
  })

  const authorPage = (overrides: { author?: Record<string, unknown>; feed?: Record<string, unknown> } = {}) => ({
    data: {
      author: {
        id: "1",
        handle: "vera",
        name: "Вера Орлова",
        bio: "Пишет о городе.",
        avatar: null,
        grade: "pro",
        publishedCount: 3,
        firstPublishedAt: "2026-03-04T08:00:00.000Z",
        redirect: null,
        links: [{ kind: "telegram", url: "https://t.me/vera" }],
        ...overrides.author
      },
      feed: {
        caption: "by_publication_date",
        redirect: null,
        items: [feedItem("1"), feedItem("2")],
        pageInfo: { page: 1, totalPages: 2, hasNext: true },
        ...overrides.feed
      }
    }
  })

  it("рисует шапку автора, подпись порядка, хронику и пагинацию", async () => {
    respondWith(authorPage())

    const wrapper = await render(AuthorPage)

    expect(wrapper.get('[data-zone="author-header"]').text()).toBe("Вера Орлова")
    expect(wrapper.get('[data-zone="author-header"]').attributes("data-count")).toBe("authorPage.articleCount:3")
    expect(wrapper.get('[data-zone="author-header"]').attributes("data-since")).toBe("authorPage.since:марта 2026")
    expect(wrapper.get('[data-zone="controls"]').attributes("data-groups")).toBe("0")
    // Один месяц публикации, внутри — однорядные группы ритма автора: первая раскладка
    // ритма держит один материал, второй ложится в запасную под остаток.
    expect(wrapper.findAll("h2").map((heading) => heading.text())).toEqual(["Сентябрь 2026"])
    expect(
      wrapper.findAll('[data-zone="group"]').reduce((total, group) => total + Number(group.attributes("data-count")), 0)
    ).toBe(2)
    expect(wrapper.get('[data-zone="pagination"]').attributes("data-next")).toBe("/authors/vera?page=2")
  })

  it("хэндл и страница адреса уходят в запрос локали", async () => {
    routeQuery.value = { page: "2" }
    respondWith(authorPage())

    await render(AuthorPage)

    expect(graphQLRequest).toHaveBeenCalledWith(expect.anything(), { handle: "vera", locale: "ru", page: 2 })
  })

  it("пусто в локали предлагает другой язык и не подмешивает чужие материалы", async () => {
    respondWith(authorPage({ feed: { items: [], pageInfo: { page: 1, totalPages: 0, hasNext: false } } }))

    const wrapper = await render(AuthorPage)

    expect(wrapper.get('[data-zone="empty"]').attributes("data-action")).toBe("/en/authors/vera")
    expect(wrapper.find('[data-zone="group"]').exists()).toBe(false)
  })

  it("прежний хэндл уводит на нынешний кодом 301", async () => {
    respondWith(authorPage({ author: { redirect: "vera-new", handle: "vera-new" } }))

    await render(AuthorPage)

    expect(navigate).toHaveBeenCalledWith("/authors/vera-new", { redirectCode: 301, replace: true })
  })

  it("хэндл не в том регистре тоже уводит на канонический", async () => {
    routeParams.value = { slug: "Vera" }
    respondWith(authorPage())

    await render(AuthorPage)

    expect(navigate).toHaveBeenCalledWith("/authors/vera", { redirectCode: 301, replace: true })
  })

  it("архивированный аккаунт отвечает 410 и текстом страницы #22", async () => {
    respondWith({ errors: [{ extensions: { code: "ARCHIVED" } }] })

    const wrapper = await render(AuthorPage)

    expect(setStatus).toHaveBeenCalledWith(requestEvent, 410)
    expect(wrapper.get("#author-gone-title").text()).toBe("authorPage.goneTitle")
    expect(wrapper.find('[data-zone="author-header"]').exists()).toBe(false)
  })

  it("неизвестный хэндл и аккаунт без публикаций прерывают страницу отказом 404", async () => {
    respondWith({ errors: [{ extensions: { code: "NOT_FOUND" } }] })

    expect(await renderFailing(AuthorPage)).toEqual([expect.objectContaining({ statusCode: 404 })])
  })

  it("отказ данных показывает состояние ошибки с кодом запроса", async () => {
    respondWith({ errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "req-author" } }] })

    expect((await render(AuthorPage)).get('[data-zone="error"]').attributes("data-request-id")).toBe("req-author")
  })

  it("клиентская навигация показывает скелеты", async () => {
    pending()

    expect((await render(AuthorPage)).find('[data-zone="skeleton"]').exists()).toBe(true)
  })
})
