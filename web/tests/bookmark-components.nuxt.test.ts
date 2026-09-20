// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import BookmarkCard from "../app/components/me/BookmarkCard.vue"
import { getArticleBookmarkState } from "../app/utils/bookmarkState"

const messages: Record<string, string> = {
  "bookmarks.savedAt": "Сохранено {date}",
  "bookmarks.unavailable": "Недоступна",
  "bookmarks.unavailableDetail": "Материал снят или отправлен в архив.",
  "bookmarks.remove": "Убрать из закладок"
}

const t = (key: string, params: Record<string, string | number> = {}) =>
  Object.entries(params).reduce(
    (message, [name, value]) => message.replace(`{${name}}`, String(value)),
    messages[key] ?? key
  )

const global = {
  stubs: { NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' } }
}

const bookmark = (available: boolean) => ({
  bookmarkedAt: "2026-09-18T10:00:00.000Z",
  article: {
    id: available ? "article-published" : "article-archived",
    title: available ? "Город, который слушает море" : "Снятый материал",
    slug: available ? "gorod-slushaet-more" : "snyatyy-material",
    locale: "ru" as const,
    cover: null,
    publishedAt: "2026-09-10T12:00:00.000Z",
    available,
    author: { name: "Анна Волкова", handle: "anna-volkova" },
    section: { name: "Путешествия", slug: "travel" }
  }
})

beforeEach(() => {
  vi.stubGlobal("useI18n", () => ({ t, locale: { value: "ru" } }))
})

describe("BookmarkCard", () => {
  it("открывает доступный материал ссылкой", () => {
    const wrapper = mount(BookmarkCard, { props: { bookmark: bookmark(true) }, global })

    expect(wrapper.find("h2 a").attributes("href")).toBe("/travel/gorod-slushaet-more")
    expect(wrapper.find('[data-testid="bookmark-unavailable"]').exists()).toBe(false)
    expect(wrapper.attributes("class")).not.toContain("grayscale")
  })

  it("оставляет недоступный материал серым, без ссылки, но с крестиком", () => {
    const wrapper = mount(BookmarkCard, { props: { bookmark: bookmark(false) }, global })

    expect(wrapper.attributes("data-available")).toBe("false")
    expect(wrapper.attributes("class")).toContain("grayscale")
    expect(wrapper.attributes("class")).toContain("opacity-60")
    expect(wrapper.find("h2 a").exists()).toBe(false)
    expect(wrapper.find('[data-testid="bookmark-unavailable"]').text()).toBe("Недоступна")
    expect(wrapper.find('[data-testid="bookmark-remove"]').exists()).toBe(true)
  })

  it("сообщает странице, какую закладку убрать", async () => {
    const wrapper = mount(BookmarkCard, { props: { bookmark: bookmark(false) }, global })

    await wrapper.find('[data-testid="bookmark-remove"]').trigger("click")

    expect(wrapper.emitted("remove")).toEqual([["article-archived"]])
  })
})

describe("getArticleBookmarkState", () => {
  it("отдаёт состояние владельцу закладки", () => {
    expect(getArticleBookmarkState({ data: { myBookmark: { bookmarked: true } } })).toEqual({
      kind: "owner",
      bookmarked: true
    })
  })

  it("приглашает гостя войти", () => {
    expect(getArticleBookmarkState({ errors: [{ extensions: { code: "UNAUTHENTICATED" } }] })).toEqual({
      kind: "guest"
    })
  })

  it("прячет кнопку от служебной роли", () => {
    expect(getArticleBookmarkState({ errors: [{ extensions: { code: "FORBIDDEN" } }] })).toEqual({ kind: "hidden" })
  })
})
