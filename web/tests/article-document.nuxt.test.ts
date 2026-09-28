// @vitest-environment happy-dom
import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import ArticleDocument from "../app/components/reading/ArticleDocument.vue"

const imageId = "22222222-2222-4222-8222-222222222222"
const document = {
  type: "doc",
  attrs: { schemaVersion: 1 },
  content: [
    {
      type: "heading",
      attrs: { id: "11111111-1111-4111-8111-111111111111", level: 2 },
      content: [{ type: "text", text: "Глава первая" }]
    },
    {
      type: "paragraph",
      attrs: { id: "33333333-3333-4333-8333-333333333333" },
      content: [
        { type: "text", text: "Текст с " },
        {
          type: "text",
          text: "источником",
          marks: [{ type: "link", attrs: { href: "https://example.test/source" } }]
        }
      ]
    },
    {
      type: "figure",
      attrs: { id: "44444444-4444-4444-8444-444444444444", assetId: imageId, size: "wide" }
    }
  ]
}

const asset = {
  id: imageId,
  alt: "Посетитель смотрит на картину",
  caption: "В зале музея",
  attribution: "Фото: редакция",
  width: 1200,
  height: 800,
  variants: {
    version: 1,
    placeholder: null,
    thumbnailWidth: 480,
    items: [
      {
        format: "avif",
        width: 960,
        height: 640,
        url: "https://media.example.test/body-960.avif"
      },
      {
        format: "webp",
        width: 960,
        height: 640,
        url: "https://media.example.test/body-960.webp"
      }
    ]
  }
}

describe("ArticleDocument", () => {
  it("renders the content tree and takes image metadata only from the media asset", () => {
    const wrapper = mount(ArticleDocument, { props: { document, assets: [asset] } })

    expect(wrapper.get("h2").text()).toBe("Глава первая")
    expect(wrapper.get("p").text()).toBe("Текст с источником")
    expect(wrapper.get("a").attributes()).toMatchObject({
      href: "https://example.test/source",
      rel: "noopener noreferrer"
    })
    expect(wrapper.get("img").attributes("alt")).toBe("Посетитель смотрит на картину")
    expect(wrapper.get('source[type="image/avif"]').attributes("srcset")).toContain("body-960.avif 960w")
    expect(wrapper.get("figcaption").text()).toBe("В зале музея Фото: редакция")
  })
})
