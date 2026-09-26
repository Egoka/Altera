import { describe, expect, it } from "vitest"

import { CONTENT_SCHEMA_VERSION } from "../src/migrate"
import { createDocument, createFigure, createParagraph, createText } from "../src/create"
import {
  CONTENT_INVALID,
  ContentInvalidError,
  assertValidDocument,
  isSafeLink,
  validateDocument
} from "../src/validate"
import { ASSET_ID, fullDocument, id } from "./fixtures"

function codes(input: unknown): string[] {
  const result = validateDocument(input)
  return result.valid ? [] : result.errors.map((error) => error.code)
}

describe("документ целиком", () => {
  it("документ со всеми узлами каталога допустим", () => {
    const result = validateDocument(fullDocument())
    expect(result).toMatchObject({ valid: true })
  })

  it("не объект отклоняется", () => {
    expect(codes("<p>текст</p>")).toEqual(["not_an_object"])
    expect(codes(null)).toEqual(["not_an_object"])
  })

  it("корень не doc отклоняется", () => {
    expect(codes({ type: "paragraph" })).toEqual(["not_a_document"])
  })

  it("пустой документ без блоков отклоняется", () => {
    expect(codes({ type: "doc", attrs: { schemaVersion: CONTENT_SCHEMA_VERSION }, content: [] })).toEqual([
      "missing_content"
    ])
  })

  it("версия схемы обязательна и равна текущей", () => {
    expect(codes({ type: "doc", content: [createParagraph([], id(1))] })).toEqual(["missing_attribute"])
    expect(codes({ type: "doc", attrs: { schemaVersion: 99 }, content: [createParagraph([], id(1))] })).toEqual([
      "unsupported_schema_version"
    ])
  })
})

describe("узел изображения не имеет собственного alt", () => {
  // Критерий готовности T-041 №2. Правило журнала §29.13 и ADR-0053: единое `alt` живёт в
  // медиафайле, размещение в статье его не переопределяет.
  it("документ с alt в узле изображения не проходит валидацию", () => {
    const document = createDocument([
      { type: "figure", attrs: { id: id(15), assetId: ASSET_ID, size: "normal", alt: "Своё описание" } }
    ])
    const result = validateDocument(document)
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.code).toBe(CONTENT_INVALID)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      path: "doc.content[0].attrs.alt",
      code: "forbidden_attribute"
    })
    expect(result.errors[0]?.message).toContain("§29.13")
  })

  it("подпись и атрибуция в узле тоже отклоняются: они берутся из медиа", () => {
    const document = createDocument([
      {
        type: "figure",
        attrs: { id: id(15), assetId: ASSET_ID, size: "normal", caption: "Подпись", attribution: "Автор" }
      }
    ])
    expect(codes(document)).toEqual(["forbidden_attribute", "forbidden_attribute"])
  })

  it("прямой URL вместо assetId отклоняется", () => {
    const document = createDocument([
      { type: "figure", attrs: { id: id(15), assetId: ASSET_ID, size: "normal", src: "https://example/x.jpg" } }
    ])
    expect(codes(document)).toEqual(["forbidden_attribute"])
  })

  it("изображение без assetId или с неизвестным размером отклоняется", () => {
    expect(codes(createDocument([{ type: "figure", attrs: { id: id(15), size: "normal" } }]))).toEqual([
      "missing_attribute"
    ])
    expect(codes(createDocument([{ type: "figure", attrs: { id: id(15), assetId: ASSET_ID, size: "huge" } }]))).toEqual(
      ["invalid_attribute"]
    )
  })
})

describe("каталог блоков закрыт", () => {
  it("блоки этапа 5 отклоняются", () => {
    for (const type of ["gallery", "video", "audio", "aside", "embed", "table", "columns"]) {
      expect(codes(createDocument([{ type, attrs: { id: id(20) } } as never]))).toEqual(["unknown_node"])
    }
  })

  it("заголовок первого уровня отклоняется: автору доступны только 2 и 3", () => {
    expect(codes(createDocument([{ type: "heading", attrs: { id: id(2), level: 1 }, content: [] }]))).toEqual([
      "invalid_attribute"
    ])
  })

  it("неизвестный атрибут блока отклоняется", () => {
    expect(codes(createDocument([{ type: "paragraph", attrs: { id: id(1), align: "center" }, content: [] }]))).toEqual([
      "unknown_attribute"
    ])
  })

  it("неизвестная марка отклоняется", () => {
    const document = createDocument([
      {
        type: "paragraph",
        attrs: { id: id(1) },
        content: [{ type: "text", text: "текст", marks: [{ type: "highlight" }] as never }]
      }
    ])
    expect(codes(document)).toEqual(["unknown_mark"])
  })

  it("марка на блочном узле отклоняется", () => {
    const document = createDocument([
      { type: "paragraph", attrs: { id: id(1) }, content: [], marks: [{ type: "bold" }] }
    ])
    expect(codes(document)).toEqual(["marks_not_allowed"])
  })
})

describe("стабильные идентификаторы блоков", () => {
  it("блок без id отклоняется", () => {
    expect(codes(createDocument([{ type: "paragraph", content: [] }]))).toEqual(["missing_attribute"])
  })

  it("id не uuid отклоняется", () => {
    expect(codes(createDocument([{ type: "paragraph", attrs: { id: "block-1" }, content: [] }]))).toEqual([
      "invalid_attribute"
    ])
  })

  it("повтор id в документе отклоняется", () => {
    expect(codes(createDocument([createParagraph([], id(1)), createParagraph([], id(1))]))).toEqual([
      "duplicate_node_id"
    ])
  })
})

describe("вложенность", () => {
  it("абзац внутри цитаты допустим", () => {
    const document = createDocument([
      {
        type: "blockquote",
        attrs: { id: id(3), kind: "plain" },
        content: [createParagraph([createText("Цитата")], id(4))]
      }
    ])
    expect(validateDocument(document)).toMatchObject({ valid: true })
  })

  it("цитата внутри цитаты отклоняется", () => {
    const document = createDocument([
      {
        type: "blockquote",
        attrs: { id: id(3), kind: "plain" },
        content: [
          {
            type: "blockquote",
            attrs: { id: id(4), kind: "plain" },
            content: [createParagraph([createText("Глубоко")], id(5))]
          }
        ]
      }
    ])
    expect(codes(document)).toEqual(["unexpected_node"])
  })

  it("список внутри пункта списка отклоняется", () => {
    const document = createDocument([
      {
        type: "bulletList",
        attrs: { id: id(5) },
        content: [
          {
            type: "listItem",
            attrs: { id: id(6) },
            content: [{ type: "bulletList", attrs: { id: id(7) }, content: [] }]
          }
        ]
      }
    ])
    expect(codes(document)).toEqual(["unexpected_node"])
  })

  it("пункт списка вне списка отклоняется", () => {
    expect(codes(createDocument([{ type: "listItem", attrs: { id: id(6) }, content: [] }]))).toEqual([
      "unexpected_node"
    ])
  })
})

describe("текст", () => {
  it("пустой текстовый узел отклоняется", () => {
    expect(
      codes(createDocument([{ type: "paragraph", attrs: { id: id(1) }, content: [{ type: "text", text: "" }] }]))
    ).toEqual(["empty_text"])
  })

  it("текст у блочного узла отклоняется", () => {
    expect(codes(createDocument([{ type: "paragraph", attrs: { id: id(1) }, text: "текст", content: [] }]))).toEqual([
      "text_not_allowed"
    ])
  })

  it("содержимое у разделителя отклоняется", () => {
    expect(
      codes(createDocument([{ type: "horizontalRule", attrs: { id: id(16) }, content: [createText("x")] }]))
    ).toEqual(["content_not_allowed"])
  })
})

describe("ссылки", () => {
  it("допустимые адреса", () => {
    for (const href of ["https://altera.example", "http://altera.example", "mailto:hi@altera.example", "/about"]) {
      expect(isSafeLink(href)).toBe(true)
    }
  })

  it("недопустимые адреса", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "//evil.example",
      " https://altera.example",
      "",
      "about"
    ]) {
      expect(isSafeLink(href)).toBe(false)
    }
  })

  it("документ со ссылкой javascript: не проходит валидацию", () => {
    const document = createDocument([
      {
        type: "paragraph",
        attrs: { id: id(1) },
        content: [{ type: "text", text: "клик", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }]
      }
    ])
    expect(codes(document)).toEqual(["unsafe_link"])
  })

  it("ссылка без href отклоняется", () => {
    const document = createDocument([
      { type: "paragraph", attrs: { id: id(1) }, content: [{ type: "text", text: "клик", marks: [{ type: "link" }] }] }
    ])
    expect(codes(document)).toEqual(["missing_attribute"])
  })

  it("повтор одной марки отклоняется", () => {
    const document = createDocument([
      {
        type: "paragraph",
        attrs: { id: id(1) },
        content: [{ type: "text", text: "текст", marks: [{ type: "bold" }, { type: "bold" }] }]
      }
    ])
    expect(codes(document)).toEqual(["duplicate_mark"])
  })
})

describe("ограничения размеров", () => {
  it("превышение числа узлов отклоняется", () => {
    const document = createDocument([
      createParagraph([createText("а")], id(1)),
      createParagraph([createText("б")], id(2))
    ])
    const result = validateDocument(document, { maxNodes: 3 })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.map((error) => error.code)).toEqual(["too_many_nodes"])
  })

  it("превышение длины текста отклоняется", () => {
    const document = createDocument([createParagraph([createText("текст подлиннее")], id(1))])
    const result = validateDocument(document, { maxTextLength: 5 })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.map((error) => error.code)).toEqual(["text_too_long"])
  })

  it("превышение глубины отклоняется", () => {
    const document = createDocument([
      {
        type: "blockquote",
        attrs: { id: id(3), kind: "plain" },
        content: [createParagraph([createText("Цитата")], id(4))]
      }
    ])
    const result = validateDocument(document, { maxBlockDepth: 1 })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.map((error) => error.code)).toEqual(["too_deep"])
  })
})

describe("assertValidDocument", () => {
  it("возвращает документ, когда он допустим", () => {
    expect(assertValidDocument(fullDocument()).type).toBe("doc")
  })

  it("бросает ContentInvalidError с кодом CONTENT_INVALID", () => {
    const document = createDocument([createFigure(ASSET_ID, "normal", "не-uuid")])
    try {
      assertValidDocument(document)
      expect.unreachable("ожидалась ошибка")
    } catch (error) {
      expect(error).toBeInstanceOf(ContentInvalidError)
      expect((error as ContentInvalidError).code).toBe(CONTENT_INVALID)
      expect((error as ContentInvalidError).errors[0]?.path).toBe("doc.content[0].attrs.id")
    }
  })
})
