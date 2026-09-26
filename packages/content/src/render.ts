/**
 * Рендер документа.
 *
 * `renderDocument` даёт дерево описаний компонентов: страница материала (T-056) отображает его
 * в компоненты дизайн-системы, ничего не зная про JSON. Имена компонентов взяты из
 * `docs/vision/05-editor.md` §7 и `docs/spec/20-public/article.md` §5. `toHTML` и `toMarkdown` —
 * сериализаторы для RSS, писем и экспорта автору (ADR-0029 п. 1, 3).
 *
 * Изображение не хранит ни `alt`, ни подпись, ни атрибуцию: они приходят из медиафайла через
 * `resolveAsset` (журнал §29.13, §31 п. 1, ADR-0053). Без `resolveAsset` рендер отдаёт только
 * `assetId` — это нормальный режим для предпросмотра и тестов схемы, а не ошибка.
 */

import type { BlockquoteKind, ContentMark, ContentNode, FigureSize, HeadingLevel } from "./types"

/** Свойства медиафайла, нужные рендеру. Источник — медиа-библиотека (ADR-0008). */
export interface RenderAsset {
  assetId: string
  /** Единое `alt` из медиафайла (ADR-0053). */
  alt?: string | null
  caption?: string | null
  attribution?: string | null
  /** Адрес изображения для HTML и Markdown. */
  src?: string | null
  width?: number | null
  height?: number | null
}

export interface RenderOptions {
  resolveAsset?: (assetId: string) => RenderAsset | null | undefined
}

export interface RenderElement {
  component: string
  props: Record<string, unknown>
  children: RenderChild[]
}

export interface RenderText {
  text: string
  marks: ContentMark[]
}

export type RenderChild = RenderElement | RenderText

export function isRenderText(child: RenderChild): child is RenderText {
  return typeof (child as RenderText).text === "string"
}

/** Компонент под каждый узел каталога. `ProseListItem` — обвязка списка, а не блок каталога. */
export const RENDER_COMPONENTS = {
  doc: "ProseArticle",
  paragraph: "ProseParagraph",
  heading: "ProseHeading",
  blockquote: "ProseQuote",
  bulletList: "ProseList",
  orderedList: "ProseList",
  listItem: "ProseListItem",
  figure: "ProseFigure",
  horizontalRule: "ProseDivider"
} as const

export function renderDocument(document: ContentNode, options: RenderOptions = {}): RenderElement {
  return {
    component: RENDER_COMPONENTS.doc,
    props: {},
    children: (document.content ?? []).map((child) => renderNode(child, options))
  }
}

function renderNode(node: ContentNode, options: RenderOptions): RenderElement {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  const id = typeof attrs.id === "string" ? attrs.id : undefined

  switch (node.type) {
    case "paragraph":
      return { component: RENDER_COMPONENTS.paragraph, props: { id }, children: renderInline(node) }
    case "heading":
      return {
        component: RENDER_COMPONENTS.heading,
        props: { id, level: attrs.level as HeadingLevel },
        children: renderInline(node)
      }
    case "blockquote":
      return {
        component: RENDER_COMPONENTS.blockquote,
        props: { id, kind: attrs.kind as BlockquoteKind },
        children: (node.content ?? []).map((child) => renderNode(child, options))
      }
    case "bulletList":
    case "orderedList":
      return {
        component: RENDER_COMPONENTS.bulletList,
        props: { id, ordered: node.type === "orderedList" },
        children: (node.content ?? []).map((child) => renderNode(child, options))
      }
    case "listItem":
      return {
        component: RENDER_COMPONENTS.listItem,
        props: { id },
        children: (node.content ?? []).map((child) => renderNode(child, options))
      }
    case "figure": {
      const assetId = String(attrs.assetId ?? "")
      const asset = options.resolveAsset?.(assetId) ?? null
      return {
        component: RENDER_COMPONENTS.figure,
        props: {
          id,
          assetId,
          size: attrs.size as FigureSize,
          src: asset?.src ?? null,
          alt: asset?.alt ?? null,
          caption: asset?.caption ?? null,
          attribution: asset?.attribution ?? null,
          width: asset?.width ?? null,
          height: asset?.height ?? null
        },
        children: []
      }
    }
    case "horizontalRule":
      return { component: RENDER_COMPONENTS.horizontalRule, props: { id }, children: [] }
    default:
      return { component: RENDER_COMPONENTS.paragraph, props: { id }, children: renderInline(node) }
  }
}

function renderInline(node: ContentNode): RenderChild[] {
  return (node.content ?? [])
    .filter((child) => child.type === "text" && typeof child.text === "string")
    .map((child) => ({ text: child.text as string, marks: child.marks ?? [] }))
}

/* ------------------------------------------------------------------ HTML */

const HEADING_TAGS: Record<HeadingLevel, string> = { 2: "h2", 3: "h3" }

/** HTML для RSS и писем. Разметка семантическая: вид задаёт дизайн-система, а не эти теги. */
export function toHTML(document: ContentNode, options: RenderOptions = {}): string {
  return (document.content ?? []).map((child) => blockToHTML(child, options)).join("\n")
}

function blockToHTML(node: ContentNode, options: RenderOptions): string {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  const id = typeof attrs.id === "string" ? ` id="${escapeHTML(attrs.id)}"` : ""

  switch (node.type) {
    case "paragraph":
      return `<p${id}>${inlineToHTML(node)}</p>`
    case "heading": {
      const tag = HEADING_TAGS[attrs.level as HeadingLevel] ?? "h2"
      return `<${tag}${id}>${inlineToHTML(node)}</${tag}>`
    }
    case "blockquote": {
      const kind = escapeHTML(String(attrs.kind ?? "plain"))
      const inner = (node.content ?? []).map((child) => blockToHTML(child, options)).join("")
      return `<blockquote${id} data-kind="${kind}">${inner}</blockquote>`
    }
    case "bulletList":
    case "orderedList": {
      const tag = node.type === "orderedList" ? "ol" : "ul"
      const inner = (node.content ?? []).map((child) => blockToHTML(child, options)).join("")
      return `<${tag}${id}>${inner}</${tag}>`
    }
    case "listItem": {
      const inner = (node.content ?? []).map((child) => blockToHTML(child, options)).join("")
      return `<li${id}>${inner}</li>`
    }
    case "figure": {
      const assetId = String(attrs.assetId ?? "")
      const asset = options.resolveAsset?.(assetId) ?? null
      const size = escapeHTML(String(attrs.size ?? "normal"))
      const image = asset?.src
        ? `<img src="${escapeHTML(asset.src)}" alt="${escapeHTML(asset.alt ?? "")}"${dimension("width", asset.width)}${dimension("height", asset.height)}>`
        : ""
      const captionText = asset?.caption ?? ""
      const attributionText = asset?.attribution ?? ""
      const caption =
        captionText || attributionText
          ? `<figcaption>${escapeHTML(captionText)}${
              attributionText
                ? `${captionText ? " " : ""}<span class="attribution">${escapeHTML(attributionText)}</span>`
                : ""
            }</figcaption>`
          : ""
      return `<figure${id} data-size="${size}" data-asset-id="${escapeHTML(assetId)}">${image}${caption}</figure>`
    }
    case "horizontalRule":
      return `<hr${id}>`
    default:
      return ""
  }
}

function inlineToHTML(node: ContentNode): string {
  return (node.content ?? [])
    .map((child) => {
      if (child.type !== "text" || typeof child.text !== "string") return ""
      let html = escapeHTML(child.text)
      for (const mark of orderMarks(child.marks ?? [])) {
        if (mark.type === "bold") html = `<strong>${html}</strong>`
        else if (mark.type === "italic") html = `<em>${html}</em>`
        else if (mark.type === "link") {
          const href = escapeHTML(String((mark.attrs ?? {}).href ?? ""))
          html = `<a href="${href}">${html}</a>`
        }
      }
      return html
    })
    .join("")
}

function dimension(name: string, value: number | null | undefined): string {
  return typeof value === "number" ? ` ${name}="${value}"` : ""
}

export function escapeHTML(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/* -------------------------------------------------------------- Markdown */

/** Markdown для экспорта автору (ADR-0029 «Следствия»). */
export function toMarkdown(document: ContentNode, options: RenderOptions = {}): string {
  return (document.content ?? [])
    .map((child) => blockToMarkdown(child, options))
    .filter((block) => block.length > 0)
    .join("\n\n")
}

function blockToMarkdown(node: ContentNode, options: RenderOptions): string {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>

  switch (node.type) {
    case "paragraph":
      return inlineToMarkdown(node)
    case "heading": {
      const level = attrs.level === 3 ? 3 : 2
      return `${"#".repeat(level)} ${inlineToMarkdown(node)}`
    }
    case "blockquote": {
      const inner = (node.content ?? []).map((child) => blockToMarkdown(child, options)).join("\n\n")
      return inner
        .split("\n")
        .map((line) => (line.length > 0 ? `> ${line}` : ">"))
        .join("\n")
    }
    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList"
      return (node.content ?? [])
        .map((item, index) => {
          const marker = ordered ? `${index + 1}. ` : "- "
          const body = (item.content ?? []).map((child) => blockToMarkdown(child, options)).join("\n\n")
          return indentContinuation(`${marker}${body}`, marker.length)
        })
        .join("\n")
    }
    case "figure": {
      const assetId = String(attrs.assetId ?? "")
      const asset = options.resolveAsset?.(assetId) ?? null
      const alt = escapeMarkdown(asset?.alt ?? "")
      const src = asset?.src ?? `asset:${assetId}`
      const image = `![${alt}](${src})`
      const caption = [asset?.caption, asset?.attribution].filter(Boolean).join(" — ")
      return caption ? `${image}\n\n*${escapeMarkdown(caption)}*` : image
    }
    case "horizontalRule":
      return "---"
    default:
      return ""
  }
}

function inlineToMarkdown(node: ContentNode): string {
  return (node.content ?? [])
    .map((child) => {
      if (child.type !== "text" || typeof child.text !== "string") return ""
      let text = escapeMarkdown(child.text)
      for (const mark of orderMarks(child.marks ?? [])) {
        if (mark.type === "bold") text = `**${text}**`
        else if (mark.type === "italic") text = `*${text}*`
        else if (mark.type === "link") text = `[${text}](${String((mark.attrs ?? {}).href ?? "")})`
      }
      return text
    })
    .join("")
}

function indentContinuation(block: string, width: number): string {
  const [first, ...rest] = block.split("\n")
  if (rest.length === 0) return first ?? ""
  const padding = " ".repeat(width)
  return [first, ...rest.map((line) => (line.length > 0 ? `${padding}${line}` : line))].join("\n")
}

export function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]])/g, "\\$1")
}

/**
 * Порядок наложения марок фиксирован, чтобы одинаковый документ давал одинаковый вывод:
 * ссылка снаружи, начертания внутри.
 */
function orderMarks(marks: ContentMark[]): ContentMark[] {
  const order: Record<string, number> = { italic: 0, bold: 1, link: 2 }
  return [...marks].sort((left, right) => (order[left.type] ?? 99) - (order[right.type] ?? 99))
}
