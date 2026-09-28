// @vitest-environment happy-dom
import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import PreviewBanner from "../app/components/reading/PreviewBanner.vue"

const messages: Record<string, string> = {
  "article.preview": "Предпросмотр",
  "article.previewStatus": "Статус: {status}",
  "article.reeditUntil": "Перередактировать до {time}",
  "article.openEditor": "Открыть в редакторе",
  "article.status.published": "published",
  "article.status.review": "review"
}

beforeEach(() => {
  vi.stubGlobal("useI18n", () => ({
    locale: { value: "ru" },
    t: (key: string, params: Record<string, string> = {}) =>
      Object.entries(params).reduce(
        (value, [name, replacement]) => value.replace(`{${name}}`, replacement),
        messages[key] ?? key
      )
  }))
})

describe("PreviewBanner", () => {
  it("shows the preview status and the author's re-edit deadline", () => {
    const wrapper = mount(PreviewBanner, {
      props: {
        status: "published",
        reeditUntil: "2026-09-28T20:00:00.000Z",
        editPath: "/me/articles/translation-1/edit"
      },
      global: { stubs: { NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' } } }
    })

    expect(wrapper.get('[data-testid="preview-banner"]').text()).toContain("Предпросмотр")
    expect(wrapper.text()).toContain("Статус: published")
    expect(wrapper.text()).toContain("Перередактировать до")
    expect(wrapper.get("a").attributes("href")).toBe("/me/articles/translation-1/edit")
  })

  it("does not invent a re-edit window for a staff preview", () => {
    const wrapper = mount(PreviewBanner, { props: { status: "review", reeditUntil: null, editPath: null } })

    expect(wrapper.text()).toContain("Статус: review")
    expect(wrapper.text()).not.toContain("Перередактировать до")
    expect(wrapper.find("a").exists()).toBe(false)
  })
})
