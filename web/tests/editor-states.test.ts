import { describe, expect, it } from "vitest"
import { createDocument, createFigure, createParagraph, createText } from "@altera/content"
import {
  bodyLength,
  conflictRevisionId,
  documentBlocks,
  editorNotice,
  emptyBody,
  isReadOnly,
  missingForSubmit,
  primaryAction,
  readTab,
  saveErrorKey,
  withAppendedParagraph,
  withBlockText,
  withoutBlock
} from "~/utils/articleEditor"

/**
 * T-040: состояния обвязки редактора (`docs/spec/30-account/author/article-edit.md` §5, §8).
 *
 * Критерий 1 — отказ `CONFLICT` называет свежую ревизию, и по ней редактор показывает баннер
 * конфликта, а не общую ошибку.
 */

const NODE_ID = "0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a7b"
const ASSET_ID = "9c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f"
const body = (text: string) => createDocument([createParagraph([createText(text)], NODE_ID)])

describe("баннер состояния", () => {
  it.each([
    ["plan", "editor-notice-plan", "accent"],
    ["rejected", "editor-notice-rejected", "accent"],
    ["archived", "editor-notice-archived", "accent"],
    ["ai_check", "editor-notice-ai-check", "neutral"],
    ["in_review", "editor-notice-in-review", "neutral"],
    ["published", "editor-notice-published", "neutral"]
  ] as const)("%s показывает свой баннер", (reason, testId, tone) => {
    const notice = editorNotice(reason)

    expect(notice).toMatchObject({ testId, tone })
    expect(isReadOnly(reason)).toBe(true)
  })

  it("черновик с активным планом баннера не показывает", () => {
    expect(editorNotice("none")).toBeNull()
    expect(isReadOnly("none")).toBe(false)
  })

  it("офлайн показывается поверх любой причины: текст ещё в форме", () => {
    expect(editorNotice("none", { offline: true })?.testId).toBe("editor-notice-offline")
    expect(editorNotice("plan", { offline: true })?.testId).toBe("editor-notice-offline")
  })
})

describe("главное действие верхней панели", () => {
  it.each([
    ["draft", "none", "submit"],
    ["rework", "none", "submit"],
    ["ai_check", "ai_check", "withdraw"],
    ["review", "in_review", "withdraw"],
    ["published", "published", "openPublished"],
    ["draft", "plan", "none"]
  ] as const)("статус %s с причиной %s даёт %s", (status, reason, expected) => {
    expect(primaryAction(status, reason)).toBe(expected)
  })
})

describe("готовность подачи", () => {
  it("называет каждое недостающее обязательное поле", () => {
    const missing = missingForSubmit({
      title: "   ",
      body: emptyBody(NODE_ID),
      sectionId: null,
      coverAssetId: null
    })

    expect(missing).toEqual(["title", "body", "section", "cover"])
  })

  it("заполненная версия к подаче готова", () => {
    const missing = missingForSubmit({
      title: "Заголовок",
      body: body("Текст материала"),
      sectionId: "section-1",
      coverAssetId: "cover-1"
    })

    expect(missing).toEqual([])
  })
})

describe("разбор отказа API", () => {
  it("критерий 1: CONFLICT ревизии называет свежую ревизию", () => {
    const errors = [
      { extensions: { code: "CONFLICT", entity: "revision", expected: "revision-10", actual: "revision-9" } }
    ]

    expect(conflictRevisionId(errors)).toBe("revision-10")
    expect(saveErrorKey(errors)).toBe("conflict")
  })

  it("конфликт статуса за конфликт ревизий не принимается", () => {
    const errors = [{ extensions: { code: "CONFLICT", entity: "translation", expected: "draft", actual: "review" } }]

    expect(conflictRevisionId(errors)).toBeNull()
  })

  it.each([
    [{ code: "PLAN_LIMIT" }, "planLimit"],
    [{ code: "FORBIDDEN" }, "forbidden"],
    [{ code: "CONTENT_INVALID" }, "contentInvalid"],
    [{ code: "VALIDATION_ERROR", field: "cover" }, "coverRequired"],
    [{ code: "VALIDATION_ERROR", field: "sectionId" }, "sectionRequired"],
    [{ code: "VALIDATION_ERROR", field: "profile" }, "profileRequired"],
    [{ code: "INTERNAL_ERROR" }, "unknown"]
  ])("%o переводится в строку %s", (extensions, expected) => {
    expect(saveErrorKey([{ extensions }])).toBe(expected)
  })
})

describe("область блоков", () => {
  it("документ раскладывается в блоки с их видом и текстом", () => {
    const document = createDocument([
      createParagraph([createText("Первый абзац")], NODE_ID),
      createFigure(ASSET_ID, "normal", "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e")
    ])

    expect(documentBlocks(document)).toEqual([
      { id: NODE_ID, type: "paragraph", text: "Первый абзац" },
      { id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", type: "figure", text: "", assetId: ASSET_ID }
    ])
  })

  it("правка текста блока сохраняет его идентификатор", () => {
    const next = withBlockText(body("Было"), NODE_ID, "Стало")

    expect(documentBlocks(next)).toEqual([{ id: NODE_ID, type: "paragraph", text: "Стало" }])
    expect(bodyLength(next)).toBe(5)
  })

  it("изображение текстом не правится", () => {
    const document = createDocument([createFigure(ASSET_ID, "wide", NODE_ID)])

    expect(withBlockText(document, NODE_ID, "подпись")).toEqual(document)
  })

  it("абзац добавляется в конец, последний блок не удаляется", () => {
    const grown = withAppendedParagraph(body("Первый"), "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e")
    expect(documentBlocks(grown)).toHaveLength(2)

    const shrunk = withoutBlock(grown, "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e")
    expect(documentBlocks(shrunk)).toHaveLength(1)
    expect(documentBlocks(withoutBlock(shrunk, NODE_ID))).toHaveLength(1)
  })
})

describe("вкладка боковой панели", () => {
  it.each([
    ["revisions", "revisions"],
    ["seo", "seo"],
    ["languages", "languages"],
    ["text", "review"],
    [undefined, "review"]
  ])("?tab=%s открывает %s", (value, expected) => {
    expect(readTab(value)).toBe(expected)
  })
})
