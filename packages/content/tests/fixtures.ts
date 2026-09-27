import {
  BOLD,
  ITALIC,
  createBlockquote,
  createDocument,
  createFigure,
  createHeading,
  createHorizontalRule,
  createLinkMark,
  createList,
  createListItem,
  createParagraph,
  createText
} from "../src/create"
import type { ContentNode, ContentNodeType } from "../src/types"
import type { RenderAsset } from "../src/render"

/** Предсказуемые идентификаторы: снимки не должны зависеть от генератора uuid. */
export function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
}

export const ASSET_ID = id(900)

/** Медиафайл со всеми свойствами, которые рендер берёт снаружи документа (ADR-0053). */
export const ASSET: RenderAsset = {
  assetId: ASSET_ID,
  alt: "Рассвет над рекой",
  caption: "Утро на Оке",
  attribution: "Фото: Мария Иванова",
  src: "https://media.example/altera/river.webp",
  width: 1440,
  height: 960
}

export function resolveAsset(assetId: string): RenderAsset | null {
  return assetId === ASSET_ID ? ASSET : null
}

/** По одному образцу на каждый узел каталога — основа снимков рендера. */
export const NODE_FIXTURES: Record<Exclude<ContentNodeType, "doc" | "text" | "listItem">, ContentNode> = {
  paragraph: createParagraph(
    [
      createText("Обычный текст, "),
      createText("полужирный", [BOLD]),
      createText(", "),
      createText("курсив", [ITALIC]),
      createText(" и "),
      createText("ссылка", [createLinkMark({ href: "https://altera.example/about" })]),
      createText(".")
    ],
    id(1)
  ),
  heading: createHeading(2, [createText("Заголовок второго уровня")], id(2)),
  blockquote: createBlockquote("pull", [createParagraph([createText("Выносная цитата в две строки.")], id(4))], id(3)),
  bulletList: createList(
    false,
    [
      createListItem([createParagraph([createText("Первый пункт")], id(7))], id(6)),
      createListItem([createParagraph([createText("Второй пункт")], id(9))], id(8))
    ],
    id(5)
  ),
  orderedList: createList(
    true,
    [
      createListItem([createParagraph([createText("Шаг один")], id(12))], id(11)),
      createListItem([createParagraph([createText("Шаг два")], id(14))], id(13))
    ],
    id(10)
  ),
  figure: createFigure(ASSET_ID, "wide", id(15)),
  horizontalRule: createHorizontalRule(id(16))
}

/** Заголовок третьего уровня нужен оглавлению; отдельным узлом каталога он не является. */
export const HEADING_LEVEL_3 = createHeading(3, [createText("Подзаголовок")], id(17))

/** Документ, в котором встречается каждый узел каталога. */
export function fullDocument() {
  return createDocument([
    NODE_FIXTURES.heading,
    NODE_FIXTURES.paragraph,
    HEADING_LEVEL_3,
    NODE_FIXTURES.blockquote,
    NODE_FIXTURES.bulletList,
    NODE_FIXTURES.orderedList,
    NODE_FIXTURES.figure,
    NODE_FIXTURES.horizontalRule
  ])
}
