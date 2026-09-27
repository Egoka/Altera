// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AppFooter from "../app/components/app/footer.vue"
import ArticleCard from "../app/components/article/Card.vue"
import AuthorCard from "../app/components/reading/AuthorCard.vue"
import BookmarkButton from "../app/components/reading/BookmarkButton.vue"
import Byline from "../app/components/reading/Byline.vue"
import EmptyState from "../app/components/reading/EmptyState.vue"
import FeedControls from "../app/components/reading/FeedControls.vue"
import PageHeader from "../app/components/reading/PageHeader.vue"
import SectionCard from "../app/components/reading/SectionCard.vue"
import SectionKicker from "../app/components/reading/SectionKicker.vue"
import TagChips from "../app/components/reading/TagChips.vue"
import TagList from "../app/components/reading/TagList.vue"

/**
 * AC-1 T-129: внутренние ссылки публичных страниц строятся в локали страницы. Стратегия
 * `prefix_except_default` префиксует только английскую локаль, поэтому заглушка `localePath`
 * повторяет именно её: адрес получает `/en`, а корень превращается в `/en`.
 *
 * Проверяются листовые компоненты — именно они собирают адрес из слага. Страницы и их
 * пагинация проверены в `public-pages.nuxt.test.ts`, шапка — в `navigation.nuxt.test.ts`.
 */
const t = (key: string) => key

const global = {
  stubs: {
    NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
    NuxtImg: { props: ["src", "alt"], template: '<img :src="src" :alt="alt" />' },
    ReadingProBadge: true,
    VisualLogo: true
  }
}

const hrefs = (wrapper: { findAll: (selector: string) => { attributes: (name: string) => string | undefined }[] }) =>
  wrapper.findAll("a").map((link) => link.attributes("href"))

beforeEach(() => {
  vi.stubGlobal("useI18n", () => ({ t, locale: { value: "en" } }))
  vi.stubGlobal("useLocalePath", () => (path: string) => (path === "/" ? "/en" : `/en${path}`))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const article = {
  id: "article-1",
  title: "A city that listens to the sea",
  slug: "city-listens",
  dek: null,
  featuredImage: null,
  publishedAt: "2026-09-15T10:00:00.000Z",
  isTranslation: false,
  author: { name: "Anna Volkova", slug: "anna-volkova", grade: "standard" as const },
  section: { name: "Travel", slug: "travel" }
}

describe("ссылки карточек в английской локали", () => {
  it("карточка материала ведёт на английский адрес рубрики, материала и автора", () => {
    const wrapper = mount(ArticleCard, { props: { article, variant: "large", locale: "en" }, global })

    expect(hrefs(wrapper)).toContain("/en/travel/city-listens")
    expect(hrefs(wrapper)).toContain("/en/authors/anna-volkova")
    expect(hrefs(wrapper)).toContain("/en/travel")
  })

  it("подпись автора и кикер рубрики префиксуют адрес", () => {
    expect(
      mount(Byline, { props: { name: "Anna", slug: "anna" }, global })
        .get("a")
        .attributes("href")
    ).toBe("/en/authors/anna")
    expect(
      mount(SectionKicker, { props: { name: "Travel", slug: "travel" }, global })
        .get("a")
        .attributes("href")
    ).toBe("/en/travel")
  })

  it("карточка рубрики ведёт в ленту и в превью материалов своей локали", () => {
    const wrapper = mount(SectionCard, {
      props: {
        section: {
          slug: "travel",
          name: "Travel",
          description: null,
          cover: null,
          articleCount: 2,
          preview: [{ title: "Sea", path: "/travel/sea", author: "Anna" }]
        },
        countLabel: "2 articles"
      },
      global
    })

    expect(hrefs(wrapper)).toEqual(["/en/travel", "/en/travel", "/en/travel/sea"])
  })

  it("карточка автора ведёт на профиль и последние материалы своей локали", () => {
    const wrapper = mount(AuthorCard, {
      props: {
        author: {
          handle: "anna",
          name: "Anna Volkova",
          avatar: null,
          grade: "standard" as const,
          bioShort: null,
          publishedCount: 1,
          isEditorial: false,
          recent: [{ title: "Sea", path: "/travel/sea" }]
        },
        countLabel: "1 article"
      },
      global
    })

    expect(hrefs(wrapper)).toEqual(["/en/authors/anna", "/en/travel/sea"])
  })

  it("теги списком и облаком ведут в английские ленты", () => {
    const tags = [{ slug: "ai", name: "AI", articleCount: 3 }]

    expect(hrefs(mount(TagList, { props: { tags, grouped: false }, global }))).toEqual(["/en/tags/ai"])
    expect(hrefs(mount(TagChips, { props: { tags }, global }))).toEqual(["/en/tags/ai"])
  })
})

describe("действия и служебные ссылки в английской локали", () => {
  /**
   * Действие пустого состояния и заголовка списка приходит готовым адресом: страница
   * автора нарочно уводит им в другую локаль («посмотреть на другом языке»), и повторная
   * локализация вернула бы читателя обратно. Локаль ставят страницы — это проверено в
   * `public-pages.nuxt.test.ts`.
   */
  it("действие пустого состояния и заголовка списка не переписывается компонентом", () => {
    expect(
      mount(EmptyState, { props: { title: "Empty", actionLabel: "Become an author", actionTo: "/en/pricing" }, global })
        .get("a")
        .attributes("href")
    ).toBe("/en/pricing")
    // Адрес другой локали остаётся нетронутым.
    expect(
      mount(EmptyState, { props: { title: "Empty", actionLabel: "Other language", actionTo: "/authors/vera" }, global })
        .get("a")
        .attributes("href")
    ).toBe("/authors/vera")
    expect(
      mount(PageHeader, {
        props: { title: "Authors", actionLabel: "Become an author", actionTo: "/en/pricing" },
        global
      })
        .get("a")
        .attributes("href")
    ).toBe("/en/pricing")
  })

  it("панель ленты выводит адреса фильтров и сброса такими, какими их дала страница", () => {
    const wrapper = mount(FeedControls, {
      props: {
        groups: [
          {
            label: "Format",
            options: [{ slug: "essay", name: "Essay" }],
            active: null,
            to: () => "/en/travel?format=essay"
          }
        ],
        resetLabel: "Reset",
        resetTo: "/en/travel"
      },
      global
    })

    expect(hrefs(wrapper)).toEqual(["/en/travel?format=essay", "/en/travel"])
  })

  it("приглашение войти у закладки гостя ведёт в /en", () => {
    expect(
      mount(BookmarkButton, { props: { guest: true }, global })
        .get("a")
        .attributes("href")
    ).toBe("/en/login")
  })

  it("футер целиком остаётся в английской локали", () => {
    const wrapper = mount(AppFooter, { global })

    expect(hrefs(wrapper).every((href) => href === "/en" || href?.startsWith("/en/"))).toBe(true)
    expect(hrefs(wrapper)).toContain("/en/legal/terms")
    expect(hrefs(wrapper)).toContain("/en/rss.xml")
  })
})
