/**
 * Экстракторы: то, что нужно поиску, AI-проверке, лентам и SEO, не разбирая документ заново.
 *
 * ADR-0029 п. 2: экстракторы дают `bodyText`, время чтения и excerpt по умолчанию.
 * Задача T-041 добавляет к ним заголовки с оглавлением и изображения с обложкой.
 */

import type { ContentNode, FigureSize, HeadingLevel } from "./types"

const BLOCK_SEPARATOR = "\n\n"

export interface ExtractedHeading {
  /** Стабильный `attrs.id` блока — якорь на странице материала. */
  id: string
  level: HeadingLevel
  text: string
}

export interface TableOfContentsEntry extends ExtractedHeading {
  children: ExtractedHeading[]
}

export interface ExtractedImage {
  id: string
  assetId: string
  size: FigureSize
}

/**
 * Плоский текст документа: тело для поиска (ADR-0025) и вход AI-проверки (T-048).
 *
 * Подписи и атрибуции изображений сюда не попадают: они живут в медиафайле, а не в документе
 * (журнал §29.13, §31 п. 1).
 */
export function toPlainText(document: ContentNode, separator: string = BLOCK_SEPARATOR): string {
  const blocks: string[] = []
  collectBlockText(document, blocks)
  return blocks.join(separator)
}

/** Текст первого абзаца — excerpt по умолчанию (ADR-0029 п. 2). */
export function firstParagraph(document: ContentNode): string | null {
  const found = findFirst(document, (node) => node.type === "paragraph" && nodeText(node).length > 0)
  return found ? nodeText(found) : null
}

/** Число слов документа: разделителями считаются любые пробельные символы. */
export function countWords(document: ContentNode): number {
  const text = toPlainText(document, " ").trim()
  if (text.length === 0) return 0
  return text.split(/\s+/).length
}

export interface ReadingTimeOptions {
  /**
   * Слов в минуту. Значение 200 взято из существующего кода
   * (`server/src/graphql/article/resolver.ts`), а не назначено заново.
   */
  wordsPerMinute?: number
}

/** Время чтения в минутах; пустой документ даёт 0. */
export function readingTime(document: ContentNode, options: ReadingTimeOptions = {}): number {
  const wordsPerMinute = options.wordsPerMinute ?? 200
  const words = countWords(document)
  if (words === 0) return 0
  return Math.max(1, Math.ceil(words / wordsPerMinute))
}

/** Заголовки документа в порядке следования. */
export function extractHeadings(document: ContentNode): ExtractedHeading[] {
  const headings: ExtractedHeading[] = []
  walk(document, (node) => {
    if (node.type !== "heading") return
    const attrs = (node.attrs ?? {}) as { id?: unknown; level?: unknown }
    if (typeof attrs.id !== "string") return
    if (attrs.level !== 2 && attrs.level !== 3) return
    headings.push({ id: attrs.id, level: attrs.level, text: nodeText(node) })
  })
  return headings
}

/**
 * Оглавление: заголовки третьего уровня вкладываются в предшествующий второй.
 * Третий уровень до первого второго остаётся записью верхнего уровня.
 */
export function buildTableOfContents(document: ContentNode): TableOfContentsEntry[] {
  const entries: TableOfContentsEntry[] = []
  for (const heading of extractHeadings(document)) {
    const parent = entries[entries.length - 1]
    if (heading.level === 3 && parent && parent.level === 2) {
      parent.children.push(heading)
      continue
    }
    entries.push({ ...heading, children: [] })
  }
  return entries
}

/** Изображения документа в порядке следования. */
export function extractImages(document: ContentNode): ExtractedImage[] {
  const images: ExtractedImage[] = []
  walk(document, (node) => {
    if (node.type !== "figure") return
    const attrs = (node.attrs ?? {}) as { id?: unknown; assetId?: unknown; size?: unknown }
    if (typeof attrs.id !== "string" || typeof attrs.assetId !== "string") return
    const size = attrs.size
    if (size !== "normal" && size !== "wide" && size !== "full") return
    images.push({ id: attrs.id, assetId: attrs.assetId, size })
  })
  return images
}

/**
 * Обложка по умолчанию — первое изображение документа.
 * Выбранная автором обложка статьи хранится отдельно (`Article.cover`) и здесь не участвует.
 */
export function extractCover(document: ContentNode): string | null {
  const [first] = extractImages(document)
  return first ? first.assetId : null
}

/** Адреса всех ссылок документа в порядке следования, с повторами. */
export function extractLinks(document: ContentNode): string[] {
  const links: string[] = []
  walk(document, (node) => {
    for (const mark of node.marks ?? []) {
      if (mark.type !== "link") continue
      const href = (mark.attrs ?? {}).href
      if (typeof href === "string") links.push(href)
    }
  })
  return links
}

/** Текст одного узла вместе с потомками, без разделителей блоков. */
export function nodeText(node: ContentNode): string {
  let text = ""
  walk(node, (current) => {
    if (current.type === "text" && typeof current.text === "string") text += current.text
  })
  return text
}

function collectBlockText(node: ContentNode, blocks: string[]): void {
  for (const child of node.content ?? []) {
    switch (child.type) {
      case "paragraph":
      case "heading": {
        const text = nodeText(child)
        if (text.length > 0) blocks.push(text)
        break
      }
      case "blockquote":
      case "bulletList":
      case "orderedList":
      case "listItem":
        collectBlockText(child, blocks)
        break
      default:
        // figure и horizontalRule текста не содержат.
        break
    }
  }
}

function walk(node: ContentNode, visit: (node: ContentNode) => void): void {
  visit(node)
  for (const child of node.content ?? []) walk(child, visit)
}

function findFirst(node: ContentNode, predicate: (node: ContentNode) => boolean): ContentNode | null {
  if (predicate(node)) return node
  for (const child of node.content ?? []) {
    const found = findFirst(child, predicate)
    if (found) return found
  }
  return null
}
