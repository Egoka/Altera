import { describe, expect, it } from "vitest"

import { createDocument } from "../src/create"
import { NODE_SPECS } from "../src/schema"
import { renderDocument, toHTML, toMarkdown } from "../src/render"
import { validateDocument } from "../src/validate"
import { NODE_FIXTURES, fullDocument, resolveAsset } from "./fixtures"

const CATALOG_NODES = Object.keys(NODE_FIXTURES) as (keyof typeof NODE_FIXTURES)[]

describe("снимки рендера каждого узла каталога", () => {
  // Критерий готовности T-041 №1. Список берётся из схемы, а не переписывается руками:
  // новый блок без снимка валит этот набор.
  it("каталог и набор образцов совпадают", () => {
    const catalog = Object.entries(NODE_SPECS)
      .filter(([, spec]) => spec.group === "block")
      .map(([type]) => type)
      .sort()
    expect(CATALOG_NODES.slice().sort()).toEqual(catalog)
  })

  for (const type of CATALOG_NODES) {
    describe(type, () => {
      const document = createDocument([NODE_FIXTURES[type]])

      it("документ с этим узлом проходит валидацию", () => {
        expect(validateDocument(document)).toMatchObject({ valid: true })
      })

      it("дерево рендера", () => {
        expect(renderDocument(document, { resolveAsset })).toMatchSnapshot()
      })

      it("HTML", () => {
        expect(toHTML(document, { resolveAsset })).toMatchSnapshot()
      })

      it("Markdown", () => {
        expect(toMarkdown(document, { resolveAsset })).toMatchSnapshot()
      })
    })
  }
})

describe("рендер документа целиком", () => {
  it("корень — ProseArticle со всеми блоками", () => {
    const tree = renderDocument(fullDocument(), { resolveAsset })
    expect(tree.component).toBe("ProseArticle")
    expect(tree.children.map((child) => ("component" in child ? child.component : "text"))).toEqual([
      "ProseHeading",
      "ProseParagraph",
      "ProseHeading",
      "ProseQuote",
      "ProseList",
      "ProseList",
      "ProseFigure",
      "ProseDivider"
    ])
  })

  it("HTML документа целиком", () => {
    expect(toHTML(fullDocument(), { resolveAsset })).toMatchSnapshot()
  })

  it("Markdown документа целиком", () => {
    expect(toMarkdown(fullDocument(), { resolveAsset })).toMatchSnapshot()
  })
})

describe("изображение без свойств медиафайла", () => {
  const document = createDocument([NODE_FIXTURES.figure])

  it("без resolveAsset рендер отдаёт только assetId", () => {
    const tree = renderDocument(document)
    const figure = tree.children[0]
    expect(figure).toMatchObject({
      component: "ProseFigure",
      props: { alt: null, caption: null, attribution: null, src: null }
    })
  })

  it("HTML без адреса изображения не содержит img", () => {
    const html = toHTML(document)
    expect(html).not.toContain("<img")
    expect(html).toContain(`data-asset-id="${String(NODE_FIXTURES.figure.attrs?.assetId)}"`)
  })

  it("alt и подпись приходят из медиафайла, а не из документа", () => {
    const html = toHTML(document, { resolveAsset })
    expect(html).toContain('alt="Рассвет над рекой"')
    expect(html).toContain("Утро на Оке")
    expect(html).toContain("Фото: Мария Иванова")
    expect(JSON.stringify(NODE_FIXTURES.figure)).not.toContain("Рассвет")
  })
})

describe("экранирование", () => {
  it("HTML экранирует текст и адрес ссылки", () => {
    const document = createDocument([
      {
        type: "paragraph",
        attrs: { id: "00000000-0000-4000-8000-000000000101" },
        content: [
          { type: "text", text: '<script>alert("x")</script>' },
          {
            type: "text",
            text: "ссылка",
            marks: [{ type: "link", attrs: { href: 'https://example.com/?a="b"&c=1' } }]
          }
        ]
      }
    ])
    const html = toHTML(document)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain('href="https://example.com/?a=&quot;b&quot;&amp;c=1"')
  })

  it("Markdown экранирует служебные символы", () => {
    const document = createDocument([
      {
        type: "paragraph",
        attrs: { id: "00000000-0000-4000-8000-000000000102" },
        content: [{ type: "text", text: "звёздочка * и _подчёркивание_" }]
      }
    ])
    expect(toMarkdown(document)).toBe("звёздочка \\* и \\_подчёркивание\\_")
  })
})

describe("порядок марок", () => {
  it("не зависит от порядка в документе", () => {
    const base = {
      type: "paragraph" as const,
      attrs: { id: "00000000-0000-4000-8000-000000000103" }
    }
    const direct = createDocument([
      {
        ...base,
        content: [
          {
            type: "text",
            text: "текст",
            marks: [{ type: "bold" }, { type: "italic" }, { type: "link", attrs: { href: "/about" } }]
          }
        ]
      }
    ])
    const reversed = createDocument([
      {
        ...base,
        content: [
          {
            type: "text",
            text: "текст",
            marks: [{ type: "link", attrs: { href: "/about" } }, { type: "italic" }, { type: "bold" }]
          }
        ]
      }
    ])
    expect(toHTML(direct)).toBe(toHTML(reversed))
    expect(toHTML(direct)).toContain('<a href="/about"><strong><em>текст</em></strong></a>')
  })
})
