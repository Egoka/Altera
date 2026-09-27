import { describe, expect, it } from "vitest"

import { createDocument, createHeading, createParagraph, createText } from "../src/create"
import {
  buildTableOfContents,
  countWords,
  extractCover,
  extractHeadings,
  extractImages,
  extractLinks,
  firstParagraph,
  readingTime,
  toPlainText
} from "../src/extract"
import { ASSET_ID, fullDocument, id } from "./fixtures"

describe("toPlainText", () => {
  it("собирает текст блоков, включая цитаты и списки", () => {
    expect(toPlainText(fullDocument())).toBe(
      [
        "Заголовок второго уровня",
        "Обычный текст, полужирный, курсив и ссылка.",
        "Подзаголовок",
        "Выносная цитата в две строки.",
        "Первый пункт",
        "Второй пункт",
        "Шаг один",
        "Шаг два"
      ].join("\n\n")
    )
  })

  it("подпись изображения в текст не попадает: она живёт в медиафайле", () => {
    expect(toPlainText(fullDocument())).not.toContain("Утро на Оке")
  })

  it("пустой абзац не даёт пустой строки", () => {
    const document = createDocument([createParagraph([], id(1)), createParagraph([createText("Текст")], id(2))])
    expect(toPlainText(document)).toBe("Текст")
  })
})

describe("firstParagraph", () => {
  it("берёт первый непустой абзац, а не заголовок", () => {
    expect(firstParagraph(fullDocument())).toBe("Обычный текст, полужирный, курсив и ссылка.")
  })

  it("без абзацев возвращает null", () => {
    expect(firstParagraph(createDocument([createHeading(2, [createText("Только заголовок")], id(2))]))).toBeNull()
  })
})

describe("countWords и readingTime", () => {
  it("считает слова по пробелам", () => {
    expect(countWords(createDocument([createParagraph([createText("одно два три")], id(1))]))).toBe(3)
  })

  it("пустой документ даёт ноль минут", () => {
    expect(readingTime(createDocument([createParagraph([], id(1))]))).toBe(0)
  })

  it("короткий текст округляется до одной минуты", () => {
    expect(readingTime(createDocument([createParagraph([createText("одно два три")], id(1))]))).toBe(1)
  })

  it("двести слов в минуту — значение по умолчанию", () => {
    const words = Array.from({ length: 450 }, (_, index) => `слово${index}`).join(" ")
    const document = createDocument([createParagraph([createText(words)], id(1))])
    expect(readingTime(document)).toBe(3)
    expect(readingTime(document, { wordsPerMinute: 150 })).toBe(3)
    expect(readingTime(document, { wordsPerMinute: 450 })).toBe(1)
  })
})

describe("заголовки и оглавление", () => {
  it("возвращает заголовки в порядке следования", () => {
    expect(extractHeadings(fullDocument())).toEqual([
      { id: id(2), level: 2, text: "Заголовок второго уровня" },
      { id: id(17), level: 3, text: "Подзаголовок" }
    ])
  })

  it("третий уровень вкладывается во второй", () => {
    expect(buildTableOfContents(fullDocument())).toEqual([
      {
        id: id(2),
        level: 2,
        text: "Заголовок второго уровня",
        children: [{ id: id(17), level: 3, text: "Подзаголовок" }]
      }
    ])
  })

  it("третий уровень до первого второго остаётся верхним", () => {
    const document = createDocument([
      createHeading(3, [createText("Сначала третий")], id(20)),
      createHeading(2, [createText("Потом второй")], id(21))
    ])
    expect(buildTableOfContents(document).map((entry) => entry.level)).toEqual([3, 2])
  })
})

describe("изображения и обложка", () => {
  it("возвращает изображения документа", () => {
    expect(extractImages(fullDocument())).toEqual([{ id: id(15), assetId: ASSET_ID, size: "wide" }])
  })

  it("обложка по умолчанию — первое изображение", () => {
    expect(extractCover(fullDocument())).toBe(ASSET_ID)
  })

  it("без изображений обложки нет", () => {
    expect(extractCover(createDocument([createParagraph([createText("Текст")], id(1))]))).toBeNull()
  })
})

describe("ссылки", () => {
  it("возвращает адреса всех ссылок", () => {
    expect(extractLinks(fullDocument())).toEqual(["https://altera.example/about"])
  })
})
