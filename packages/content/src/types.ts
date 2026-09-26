/**
 * Типы документа материала.
 *
 * Хранилище — JSON-документ ProseMirror (ADR-0001): узел описывается полями `type`, `attrs`,
 * `content`, `marks` и `text`. Здесь описана только форма JSON; допустимость конкретного узла,
 * атрибута и вложенности задаёт `schema.ts` и проверяет `validate.ts`.
 */

/** Узлы каталога первого бесплатного запуска (журнал §31 п. 1, ADR-0017 этап 1). */
export type ContentNodeType =
  | "doc"
  | "paragraph"
  | "heading"
  | "blockquote"
  | "bulletList"
  | "orderedList"
  | "listItem"
  | "figure"
  | "horizontalRule"
  | "text"

/** Марки каталога первого бесплатного запуска. */
export type ContentMarkType = "bold" | "italic" | "link"

/** Уровни заголовка: автор выбирает 2 или 3 (ADR-0017). */
export type HeadingLevel = 2 | 3

/** Семантический вариант цитаты: обычная или выносная (ADR-0017). */
export type BlockquoteKind = "plain" | "pull"

/** Размер изображения — именованный вариант, а не число (ADR-0017, граница свободы). */
export type FigureSize = "normal" | "wide" | "full"

export interface ContentMark {
  type: ContentMarkType
  attrs?: Record<string, unknown>
}

export interface ContentNode {
  type: ContentNodeType
  attrs?: Record<string, unknown>
  content?: ContentNode[]
  marks?: ContentMark[]
  text?: string
}

/** Корень документа; версия схемы хранится в самом документе (ADR-0029 п. 4). */
export interface ContentDocument extends ContentNode {
  type: "doc"
  attrs: { schemaVersion: number }
  content: ContentNode[]
}

/** Атрибуты узла изображения. Собственных `alt`, `caption` и `attribution` у него нет. */
export interface FigureAttrs {
  id: string
  assetId: string
  size: FigureSize
}

/** Атрибуты марки «ссылка». */
export interface LinkAttrs {
  href: string
}
