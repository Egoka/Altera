/**
 * Сборка документа и узлов.
 *
 * Стабильный `attrs.id` блок получает при создании (ADR-0001 п. 3): к нему привязываются
 * заметки редактора и якоря, поэтому идентификатор не должен меняться при сохранении.
 */

import { CONTENT_SCHEMA_VERSION } from "./migrate"
import type {
  BlockquoteKind,
  ContentDocument,
  ContentMark,
  ContentNode,
  FigureSize,
  HeadingLevel,
  LinkAttrs
} from "./types"

interface CryptoLike {
  randomUUID(): string
}

/** uuid узла. `globalThis.crypto` есть и в Node 19+, и в браузере, поэтому пакет остаётся без зависимостей. */
export function createNodeId(): string {
  const source = (globalThis as { crypto?: Partial<CryptoLike> }).crypto
  if (!source || typeof source.randomUUID !== "function") {
    throw new Error("crypto.randomUUID недоступен: передайте идентификатор узла явно")
  }
  return source.randomUUID()
}

export function createDocument(content: ContentNode[] = [createParagraph()]): ContentDocument {
  return { type: "doc", attrs: { schemaVersion: CONTENT_SCHEMA_VERSION }, content }
}

/** Документ нового черновика: один пустой абзац, как его открывает редактор. */
export function createEmptyDocument(): ContentDocument {
  return createDocument([createParagraph()])
}

export function createText(text: string, marks: ContentMark[] = []): ContentNode {
  return marks.length > 0 ? { type: "text", text, marks } : { type: "text", text }
}

export function createParagraph(content: ContentNode[] = [], id: string = createNodeId()): ContentNode {
  return { type: "paragraph", attrs: { id }, content }
}

export function createHeading(
  level: HeadingLevel,
  content: ContentNode[] = [],
  id: string = createNodeId()
): ContentNode {
  return { type: "heading", attrs: { id, level }, content }
}

export function createBlockquote(
  kind: BlockquoteKind,
  content: ContentNode[],
  id: string = createNodeId()
): ContentNode {
  return { type: "blockquote", attrs: { id, kind }, content }
}

export function createListItem(content: ContentNode[], id: string = createNodeId()): ContentNode {
  return { type: "listItem", attrs: { id }, content }
}

export function createList(ordered: boolean, content: ContentNode[], id: string = createNodeId()): ContentNode {
  return { type: ordered ? "orderedList" : "bulletList", attrs: { id }, content }
}

export function createFigure(assetId: string, size: FigureSize, id: string = createNodeId()): ContentNode {
  return { type: "figure", attrs: { id, assetId, size } }
}

export function createHorizontalRule(id: string = createNodeId()): ContentNode {
  return { type: "horizontalRule", attrs: { id } }
}

export function createLinkMark(attrs: LinkAttrs): ContentMark {
  return { type: "link", attrs: { ...attrs } }
}

export const BOLD: ContentMark = { type: "bold" }
export const ITALIC: ContentMark = { type: "italic" }

/**
 * Проставляет недостающие `attrs.id` блокам документа, не трогая существующие.
 * Нужно при импорте чужого JSON и в миграциях; при обычном редактировании идентификатор уже есть.
 */
export function withNodeIds(node: ContentNode, nextId: () => string = createNodeId): ContentNode {
  const needsId = node.type !== "doc" && node.type !== "text"
  const attrs = node.attrs ?? (needsId ? {} : undefined)
  const patched =
    needsId && typeof (attrs as Record<string, unknown> | undefined)?.id !== "string"
      ? { ...(attrs ?? {}), id: nextId() }
      : attrs

  const result: ContentNode = { ...node }
  if (patched !== undefined) result.attrs = patched
  if (node.content) result.content = node.content.map((child) => withNodeIds(child, nextId))
  return result
}
