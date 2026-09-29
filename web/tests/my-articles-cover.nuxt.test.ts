// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { computed } from "vue"
import { beforeEach, describe, expect, it, vi } from "vitest"
import MyArticleRow from "../app/components/me/MyArticleRow.vue"

/**
 * Заполнитель обложки в кабинете автора (`docs/spec/85-media-and-binary/article-covers.md` п. 4):
 * черновик без обложки показывает его именно здесь — в лентах дефолтных изображений нет
 * (журнал §29.1). Обложка обязательна перед публикацией, и до неё автору нужно видеть, чего
 * материалу не хватает.
 */

const cover = {
  url: "/media/cover-w960.webp",
  alt: "Волнорез в утреннем тумане",
  variants: {
    version: 1,
    placeholder: null,
    thumbnailWidth: 480,
    items: [
      { format: "webp", width: 480, height: 320, url: "/media/cover-w480.webp" },
      { format: "webp", width: 480, height: 320, url: "/media/cover-large-w480.webp", crop: "large" }
    ]
  }
}

const article = (overrides: Record<string, unknown> = {}) => ({
  id: "article-1",
  status: "draft",
  archivedBy: null,
  cover: null,
  section: null,
  format: null,
  tags: [],
  translations: [
    {
      id: "translation-1",
      locale: "ru",
      slug: "moj-material",
      title: "Мой материал",
      status: "draft",
      rejected: false,
      publishedAt: null,
      updatedAt: "2026-09-21T11:00:00.000Z",
      reeditUntil: null,
      lastReviewMessageAt: null,
      unread: false
    }
  ],
  ...overrides
})

const messages: Record<string, string> = {
  "myArticles.row.noCover": "Без обложки",
  "myArticles.row.status.draft": "Черновик",
  "myArticles.row.status.rework": "На доработке",
  "myArticles.row.status.rejected": "Отклонён",
  "myArticles.row.updated": "Обновлён {date}",
  "myArticles.row.edit": "Редактировать",
  "myArticles.row.reviewHistory": "История проверки",
  "myArticles.row.reworkDetail": "Есть рекомендации",
  "myArticles.row.rejectedDetail": "Только чтение",
  "myArticles.row.openReadOnly": "Открыть для чтения"
}

const global = {
  stubs: {
    NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
    Badge: { template: "<span><slot /></span>" }
  }
}

beforeEach(() => {
  // В Nuxt `computed` и `useI18n` приходят автоимпортом; в наборе они подставляются явно.
  vi.stubGlobal("computed", computed)
  vi.stubGlobal("useI18n", () => ({
    t: (key: string, params: Record<string, string> = {}) =>
      Object.entries(params).reduce(
        (message, [name, value]) => message.replace(`{${name}}`, value),
        messages[key] ?? key
      )
  }))
})

describe("строка материала в кабинете", () => {
  it("черновик без обложки показывает заполнитель", () => {
    const wrapper = mount(MyArticleRow, { props: { article: article() as never }, global })

    expect(wrapper.find("[data-cover-placeholder]").exists()).toBe(true)
    expect(wrapper.text()).toContain("Без обложки")
    expect(wrapper.find("img").exists()).toBe(false)
  })

  it("с обложкой вместо заполнителя показывается её кадр карточки", () => {
    const wrapper = mount(MyArticleRow, { props: { article: article({ cover }) as never }, global })

    expect(wrapper.find("[data-cover-placeholder]").exists()).toBe(false)
    expect(wrapper.get("img").attributes("srcset")).toBe("/media/cover-large-w480.webp 480w")
    expect(wrapper.get("img").attributes("alt")).toBe("Волнорез в утреннем тумане")
  })

  it("ведёт состояния проверки в историю решения, сохраняя редактор для доработки", () => {
    const rework = article({
      status: "rework",
      translations: [
        {
          ...article().translations[0],
          status: "rework",
          lastReviewMessageAt: "2026-09-29T08:00:00.000Z",
          unread: true
        }
      ]
    })
    const wrapper = mount(MyArticleRow, { props: { article: rework as never }, global })

    expect(wrapper.get("a[href='/me/articles/translation-1/review']").text()).toBe("История проверки")
    expect(wrapper.get("a[href='/me/articles/translation-1/edit']").text()).toBe("Редактировать")

    const rejected = article({
      status: "review",
      translations: [{ ...article().translations[0], status: "review", rejected: true }]
    })
    const rejectedWrapper = mount(MyArticleRow, { props: { article: rejected as never }, global })
    expect(rejectedWrapper.get("a[href='/me/articles/translation-1/review']").text()).toBe("История проверки")
    expect(rejectedWrapper.get("a[href='/me/articles/translation-1/edit']").text()).toBe("Открыть для чтения")
  })
})
