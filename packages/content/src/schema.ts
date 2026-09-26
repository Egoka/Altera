/**
 * Каталог блоков как данные — единственный источник схемы документа.
 *
 * Состав каталога первого бесплатного запуска закреплён журналом §31 п. 1: абзац; заголовок
 * уровней 2 и 3; цитата обычная и выносная; маркированный и нумерованный списки; изображение
 * с подписью (размеры «обычный», «широкий», «во всю ширину»; подпись и атрибуция из медиа);
 * разделитель; марки «полужирный», «курсив», «ссылка». Блоки этапа 5 (галерея, видео, аудио,
 * врезка, embed, таблица, колонки, шаблоны) в первый запуск не входят (журнал §31 п. 2).
 *
 * Имена узлов и атрибутов взяты из `docs/vision/05-editor.md` §7. Чего нет в этой таблице,
 * того не существует: неизвестный узел, марка или атрибут отклоняются (ADR-0017, ADR-0029).
 *
 * Расширения редактора (T-040) и компоненты страницы материала (T-056) выводятся отсюда же,
 * второй копии каталога в проекте быть не должно.
 */

import type { ContentMarkType, ContentNodeType } from "./types"

export type AttrKind = "uuid" | "string" | "enum" | "int"

export interface AttrSpec {
  kind: AttrKind
  required: boolean
  /** Допустимые значения для `enum`. */
  values?: readonly (string | number)[]
  /** Для `string` — минимальная длина, для `int` — минимальное значение. */
  min?: number
  /** Для `string` — максимальная длина, для `int` — максимальное значение. */
  max?: number
}

export interface ContentRule {
  /** Какие узлы допустимы внутри. */
  nodes: readonly ContentNodeType[]
  /** Сколько дочерних узлов требуется как минимум. */
  min: number
}

export interface NodeSpec {
  /** Роль узла: корень документа, блок каталога, элемент списка или инлайн. */
  group: "root" | "block" | "listItem" | "inline"
  /** Допустимое содержимое; `null` — узел без содержимого. */
  content: ContentRule | null
  attrs: Readonly<Record<string, AttrSpec>>
  /** Разрешены ли марки на самом узле (только у `text`). */
  marks: boolean
  /** Атрибуты, отсутствующие намеренно: значение — причина отказа для сообщения об ошибке. */
  forbiddenAttrs?: Readonly<Record<string, string>>
}

export interface MarkSpec {
  attrs: Readonly<Record<string, AttrSpec>>
}

/** Стабильный `attrs.id` есть у каждого блочного узла (ADR-0001 п. 3): к нему привязываются
 * заметки редактора и якоря. */
const NODE_ID: AttrSpec = { kind: "uuid", required: true }

/** Блоки первого уровня документа. */
export const BLOCK_NODES = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "figure",
  "horizontalRule"
] as const satisfies readonly ContentNodeType[]

/**
 * Причины, по которым у изображения нет собственных подписи, атрибуции и `alt`.
 * Журнал §29.13 и ADR-0053: единое `alt` живёт в медиафайле, размещение в статье его не
 * переопределяет. Журнал §31 п. 1: подпись и атрибуция тоже берутся из медиа.
 */
const FIGURE_FORBIDDEN_ATTRS = {
  alt: "единое alt хранится в медиафайле и не переопределяется размещением (журнал §29.13, ADR-0053)",
  caption: "подпись берётся из медиафайла (журнал §31 п. 1, ADR-0017)",
  attribution: "атрибуция берётся из медиафайла (журнал §31 п. 1, ADR-0017)",
  src: "изображение ссылается на assetId медиа-библиотеки, а не на URL (ADR-0001 п. 4)",
  url: "изображение ссылается на assetId медиа-библиотеки, а не на URL (ADR-0001 п. 4)"
} as const

export const NODE_SPECS: Readonly<Record<ContentNodeType, NodeSpec>> = {
  doc: {
    group: "root",
    content: { nodes: BLOCK_NODES, min: 1 },
    attrs: { schemaVersion: { kind: "int", required: true, min: 1 } },
    marks: false
  },
  paragraph: {
    group: "block",
    content: { nodes: ["text"], min: 0 },
    attrs: { id: NODE_ID },
    marks: false
  },
  heading: {
    group: "block",
    content: { nodes: ["text"], min: 0 },
    attrs: { id: NODE_ID, level: { kind: "enum", required: true, values: [2, 3] } },
    marks: false
  },
  // Цитата из нескольких абзацев — обычный случай журнальной вёрстки, поэтому содержимое цитаты
  // это абзацы, а не инлайн. Контейнером каталога цитата при этом не становится: ADR-0017
  // разрешает контейнеры только колонкам и галерее (этап 5), и глубина остаётся не больше двух.
  blockquote: {
    group: "block",
    content: { nodes: ["paragraph"], min: 1 },
    attrs: { id: NODE_ID, kind: { kind: "enum", required: true, values: ["plain", "pull"] } },
    marks: false
  },
  bulletList: {
    group: "block",
    content: { nodes: ["listItem"], min: 1 },
    attrs: { id: NODE_ID },
    marks: false
  },
  orderedList: {
    group: "block",
    content: { nodes: ["listItem"], min: 1 },
    attrs: { id: NODE_ID },
    marks: false
  },
  listItem: {
    group: "listItem",
    content: { nodes: ["paragraph"], min: 1 },
    attrs: { id: NODE_ID },
    marks: false
  },
  figure: {
    group: "block",
    content: null,
    attrs: {
      id: NODE_ID,
      assetId: { kind: "uuid", required: true },
      size: { kind: "enum", required: true, values: ["normal", "wide", "full"] }
    },
    marks: false,
    forbiddenAttrs: FIGURE_FORBIDDEN_ATTRS
  },
  horizontalRule: {
    group: "block",
    content: null,
    attrs: { id: NODE_ID },
    marks: false
  },
  text: {
    group: "inline",
    content: null,
    attrs: {},
    marks: true
  }
}

export const MARK_SPECS: Readonly<Record<ContentMarkType, MarkSpec>> = {
  bold: { attrs: {} },
  italic: { attrs: {} },
  link: { attrs: { href: { kind: "string", required: true, min: 1, max: 2048 } } }
}

/**
 * Схемы ссылок, которые допускает марка «ссылка».
 *
 * Это техническое ограничение безопасности, а не продуктовое правило: `javascript:`, `data:`
 * и подобные схемы в документе, который пишет пользователь и который потом попадает в SSR,
 * письма и RSS, дают выполнение кода у читателя. Относительная ссылка внутри сайта начинается
 * с `/`. Расширение списка — решение владельца, а не догадка кода.
 */
export const ALLOWED_LINK_SCHEMES = ["http:", "https:", "mailto:"] as const

export const NODE_TYPES = Object.keys(NODE_SPECS) as ContentNodeType[]
export const MARK_TYPES = Object.keys(MARK_SPECS) as ContentMarkType[]

export function isKnownNodeType(value: string): value is ContentNodeType {
  return Object.prototype.hasOwnProperty.call(NODE_SPECS, value)
}

export function isKnownMarkType(value: string): value is ContentMarkType {
  return Object.prototype.hasOwnProperty.call(MARK_SPECS, value)
}
