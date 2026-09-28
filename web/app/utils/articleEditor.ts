import type { ContentDocument, ContentNode } from "@altera/content"
import { createDocument, createNodeId, createParagraph, createText, nodeText, toPlainText } from "@altera/content"

/**
 * Состояния обвязки редактора (`docs/spec/30-account/author/article-edit.md` §5, §8).
 *
 * Решения собраны отдельно от компонентов: баннер, готовность подачи и разбор отказа проверяются
 * без монтирования страницы.
 */

export type EditorReadOnlyReason = "none" | "plan" | "rejected" | "archived" | "ai_check" | "in_review" | "published"

export type EditorNoticeTone = "neutral" | "accent"

export interface EditorNotice {
  /** Ключ перевода в `myArticles.editor.notice.*`. */
  key: string
  tone: EditorNoticeTone
  /** Признак для браузерного сценария: строка состояния §8 узнаётся по нему. */
  testId: string
}

/** Версия открыта только на чтение: сохранение, подача и медиа недоступны. */
export function isReadOnly(reason: EditorReadOnlyReason): boolean {
  return reason !== "none"
}

/**
 * Баннер состояния (§5 зона 2). Офлайн показывается поверх любой причины: изменения ещё в форме,
 * и автору важнее узнать, что сеть пропала (`20-public/offline.md`).
 */
export function editorNotice(reason: EditorReadOnlyReason, options: { offline?: boolean } = {}): EditorNotice | null {
  if (options.offline) return { key: "offline", tone: "accent", testId: "editor-notice-offline" }

  switch (reason) {
    case "plan":
      return { key: "plan", tone: "accent", testId: "editor-notice-plan" }
    case "rejected":
      return { key: "rejected", tone: "accent", testId: "editor-notice-rejected" }
    case "archived":
      return { key: "archived", tone: "accent", testId: "editor-notice-archived" }
    case "ai_check":
      return { key: "aiCheck", tone: "neutral", testId: "editor-notice-ai-check" }
    case "in_review":
      return { key: "inReview", tone: "neutral", testId: "editor-notice-in-review" }
    case "published":
      return { key: "published", tone: "neutral", testId: "editor-notice-published" }
    default:
      return null
  }
}

/** Вкладки боковой панели (§5 зона 5); выбранная живёт в `?tab=` (§3 `[ДОПУЩЕНИЕ]`). */
export type SidePanelTab = "review" | "revisions" | "seo" | "languages"

const SIDE_PANEL_TABS: readonly SidePanelTab[] = ["review", "revisions", "seo", "languages"]

export function readTab(value: unknown): SidePanelTab {
  return SIDE_PANEL_TABS.includes(value as SidePanelTab) ? (value as SidePanelTab) : "review"
}

/** Главное действие верхней панели по состоянию версии (§5 зона 1, журнал #9). */
export type EditorPrimaryAction = "submit" | "withdraw" | "openPublished" | "none"

export function primaryAction(status: string, reason: EditorReadOnlyReason): EditorPrimaryAction {
  if (status === "ai_check" || status === "review" || status === "in_review") return "withdraw"
  if (status === "published") return "openPublished"
  if (reason === "none") return "submit"
  return "none"
}

export interface SubmitReadiness {
  title: string
  body: ContentDocument
  sectionId: string | null
  coverAssetId: string | null
}

/**
 * Чего не хватает для подачи (§4): рубрика — журнал §25.3, обложка — §29.1, заголовок и текст.
 * Тот же перечень проверяет сервер; интерфейс показывает его до нажатия, а не после отказа.
 */
export function missingForSubmit(input: SubmitReadiness): string[] {
  const missing: string[] = []
  if (input.title.trim() === "") missing.push("title")
  if (toPlainText(input.body).trim() === "") missing.push("body")
  if (!input.sectionId) missing.push("section")
  if (!input.coverAssetId) missing.push("cover")
  return missing
}

export interface GraphQLErrorLike {
  message?: string
  extensions?: Record<string, unknown> | null
}

export function errorCodeOf(errors: readonly GraphQLErrorLike[] | undefined | null): string | null {
  const code = errors?.[0]?.extensions?.code
  return typeof code === "string" ? code : null
}

/**
 * Конфликт базовой ревизии (ADR-0033). `expected` называет свежую ревизию: по ней редактор
 * предлагает открыть свежую версию или сохранить свой текст копией.
 */
export function conflictRevisionId(errors: readonly GraphQLErrorLike[] | undefined | null): string | null {
  const first = errors?.[0]?.extensions
  if (!first || first.code !== "CONFLICT" || first.entity !== "revision") return null
  return typeof first.expected === "string" && first.expected.length > 0 ? first.expected : null
}

/** Ключ перевода для отказа сохранения или подачи: неизвестный код — общая строка. */
export function saveErrorKey(errors: readonly GraphQLErrorLike[] | undefined | null): string {
  const extensions = errors?.[0]?.extensions
  const code = errorCodeOf(errors)
  if (code === "PLAN_LIMIT") return "planLimit"
  if (code === "FORBIDDEN") return "forbidden"
  if (code === "CONTENT_INVALID") return "contentInvalid"
  if (code === "VALIDATION_ERROR") {
    const field = typeof extensions?.field === "string" ? extensions.field : ""
    if (field === "cover") return "coverRequired"
    if (field === "sectionId") return "sectionRequired"
    if (field === "title") return "titleRequired"
    if (field === "body") return "bodyRequired"
    if (field === "profile") return "profileRequired"
    if (field === "slug") return "slugFormat"
  }
  if (code === "CONFLICT") return "conflict"
  return "unknown"
}

/**
 * Блок области тела (§5 зона 4). Каталог узлов — отдельный проход `docs/spec/95-blocks/`
 * (ADR-0017, Q-02), поэтому обвязка работает с текстом блока и его видом, а не с разметкой
 * внутри блока.
 */
export interface EditorBlock {
  id: string
  type: ContentNode["type"]
  text: string
  /** Изображение показывается ссылкой на медиафайл: подпись и `alt` живут в самом файле. */
  assetId?: string
}

const blockId = (node: ContentNode, index: number): string => {
  const id = node.attrs?.id
  return typeof id === "string" ? id : `block-${index}`
}

export function documentBlocks(document: ContentDocument): EditorBlock[] {
  return document.content.map((node, index) => ({
    id: blockId(node, index),
    type: node.type,
    text: nodeText(node),
    ...(node.type === "figure" && typeof node.attrs?.assetId === "string" ? { assetId: node.attrs.assetId } : {})
  }))
}

/**
 * Замена текста блока. Узел сохраняет свой `attrs.id`: к нему привязаны заметки редактора и
 * якоря (ADR-0001 п. 3), поэтому правка текста идентификатор не меняет.
 */
export function withBlockText(document: ContentDocument, id: string, text: string): ContentDocument {
  const content = document.content.map((node, index) => {
    if (blockId(node, index) !== id) return node
    if (node.type === "figure" || node.type === "horizontalRule") return node
    return { ...node, content: text === "" ? [] : [createText(text)] }
  })
  return { ...document, content }
}

/** Новый абзац в конце тела: остальные виды блоков придут с каталогом. */
export function withAppendedParagraph(document: ContentDocument, id: string = createNodeId()): ContentDocument {
  return { ...document, content: [...document.content, createParagraph([], id)] }
}

/** Удаление блока; последний блок не удаляется — документу нужен хотя бы один. */
export function withoutBlock(document: ContentDocument, id: string): ContentDocument {
  if (document.content.length <= 1) return document
  return { ...document, content: document.content.filter((node, index) => blockId(node, index) !== id) }
}

/** Документ нового черновика, когда версия пришла без тела. */
export function emptyBody(id: string = createNodeId()): ContentDocument {
  return createDocument([createParagraph([], id)])
}

/** Число слов тела для панели: автору нужен масштаб текста, а не точный счёт знаков. */
export function bodyLength(document: ContentDocument): number {
  return toPlainText(document).trim().length
}
