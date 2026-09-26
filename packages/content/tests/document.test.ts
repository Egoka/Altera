import { describe, expect, it } from "vitest"

import { CONTENT_SCHEMA_VERSION, ContentMigrationError, DOCUMENT_MIGRATIONS, migrateDocument } from "../src/migrate"
import {
  createDocument,
  createEmptyDocument,
  createNodeId,
  createParagraph,
  createText,
  withNodeIds
} from "../src/create"
import { readDocument } from "../src/index"
import { validateDocument } from "../src/validate"
import { fullDocument, id } from "./fixtures"

describe("версия схемы и миграции", () => {
  it("новый документ помечен текущей версией", () => {
    expect(createEmptyDocument().attrs.schemaVersion).toBe(CONTENT_SCHEMA_VERSION)
  })

  it("реестр миграций пуст, пока версия одна", () => {
    expect(DOCUMENT_MIGRATIONS).toHaveLength(0)
  })

  it("документ текущей версии проходит без переходов", () => {
    const outcome = migrateDocument(fullDocument())
    expect(outcome.from).toBe(CONTENT_SCHEMA_VERSION)
    expect(outcome.applied).toEqual([])
    expect(validateDocument(outcome.document)).toMatchObject({ valid: true })
  })

  it("документ новее поддерживаемой версии не понижается", () => {
    expect(() => migrateDocument({ ...fullDocument(), attrs: { schemaVersion: CONTENT_SCHEMA_VERSION + 1 } })).toThrow(
      ContentMigrationError
    )
  })

  it("документ без версии отклоняется", () => {
    expect(() => migrateDocument({ type: "doc", content: [] })).toThrow(ContentMigrationError)
    expect(() => migrateDocument("строка")).toThrow(ContentMigrationError)
  })
})

describe("readDocument", () => {
  it("поднимает версию и проверяет документ", () => {
    expect(readDocument(fullDocument()).type).toBe("doc")
  })

  it("недопустимый документ доходит до ошибки валидации", () => {
    const document = createDocument([{ type: "paragraph", attrs: { id: "не-uuid" }, content: [] }])
    expect(() => readDocument(document)).toThrow(/CONTENT_INVALID/)
  })
})

describe("фабрики узлов", () => {
  it("пустой документ редактора проходит валидацию", () => {
    expect(validateDocument(createEmptyDocument())).toMatchObject({ valid: true })
  })

  it("createNodeId даёт уникальные uuid", () => {
    const first = createNodeId()
    const second = createNodeId()
    expect(first).not.toBe(second)
    expect(validateDocument(createDocument([createParagraph([createText("Текст")], first)]))).toMatchObject({
      valid: true
    })
  })

  it("withNodeIds проставляет недостающие идентификаторы и не трогает существующие", () => {
    let counter = 100
    const nextId = () => id((counter += 1))
    const raw = {
      type: "doc" as const,
      attrs: { schemaVersion: CONTENT_SCHEMA_VERSION },
      content: [
        { type: "paragraph" as const, content: [{ type: "text" as const, text: "Без идентификатора" }] },
        createParagraph([createText("С идентификатором")], id(1))
      ]
    }
    const patched = withNodeIds(raw, nextId)
    expect(patched.content?.[0]?.attrs?.id).toBe(id(101))
    expect(patched.content?.[1]?.attrs?.id).toBe(id(1))
    expect(validateDocument(patched)).toMatchObject({ valid: true })
  })

  it("withNodeIds принимает свой генератор", () => {
    let counter = 200
    const patched = withNodeIds({ type: "doc", attrs: { schemaVersion: 1 }, content: [{ type: "paragraph" }] }, () =>
      id((counter += 1))
    )
    expect(patched.content?.[0]?.attrs?.id).toBe(id(201))
  })
})
