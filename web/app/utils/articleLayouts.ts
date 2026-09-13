import { GRID_COLUMNS, type GroupLayout, type SlotRules } from "~/types/layout"

/**
 * Реестр раскладок групп «Нового».
 *
 * Правило ширины: слот `small` держит миниатюру сбоку, только если он не уже
 * пяти колонок — в трёх колонках тексту остаётся около 140 px, и заголовок
 * рвётся на четыре строки. Узкие слоты берут вертикальную карточку.
 *
 * Разнообразие даёт спан и число рядов, а не смена числа колонок: колонок
 * всегда двенадцать, поэтому вертикальные оси соседних групп совпадают, и
 * страница остаётся геометричной при разных раскладках.
 */
export const ARTICLE_LAYOUTS: GroupLayout[] = [
  {
    id: "hero-left",
    cells: ["aaaaaaabbbbb", "aaaaaaaccccc"],
    slots: [
      { key: "a", variant: "large", media: "beside" },
      { key: "b", variant: "small" },
      { key: "c", variant: "small" }
    ],
    traits: { anchor: "left", dominant: "wide" }
  },
  {
    id: "hero-right",
    cells: ["bbbbbaaaaaaa", "cccccaaaaaaa"],
    slots: [
      { key: "a", variant: "large", media: "beside" },
      { key: "b", variant: "small" },
      { key: "c", variant: "small" }
    ],
    traits: { anchor: "right", dominant: "wide" }
  },
  {
    id: "trio-tall",
    cells: ["aaaabbbbcccc"],
    slots: [
      { key: "a", variant: "large", media: "above" },
      { key: "b", variant: "large", media: "above" },
      { key: "c", variant: "large", media: "above" }
    ],
    md: { cols: 2, spans: { a: 2 } },
    traits: { anchor: "center", dominant: "tall" }
  },
  {
    id: "tower-left",
    cells: ["aaaaaaabbbbb", "aaaaaaaccccc", "aaaaaaaddddd"],
    slots: [
      { key: "a", variant: "large", media: "above" },
      { key: "b", variant: "small" },
      { key: "c", variant: "small" },
      { key: "d", variant: "small" }
    ],
    traits: { anchor: "left", dominant: "tall" }
  },
  {
    id: "duo-wide",
    cells: ["aaaaaabbbbbb"],
    slots: [
      { key: "a", variant: "large", media: "above" },
      { key: "b", variant: "large", media: "beside" }
    ],
    md: { cols: 2 },
    traits: { anchor: "center", dominant: "wide" }
  },
  {
    /* Описание под изображением, а сбоку — четыре компактных материала.
       Ломает привычку «крупный блок плюс стопка из двух». */
    id: "feature-stack",
    cells: ["aaaaabbbbbbb", "aaaaaccccccc", "aaaaaddddddd", "aaaaaeeeeeee"],
    slots: [
      { key: "a", variant: "large", media: "above" },
      { key: "b", variant: "small" },
      { key: "c", variant: "small" },
      { key: "d", variant: "small" },
      { key: "e", variant: "small" }
    ],
    md: { cols: 2, spans: { a: 2 } },
    traits: { anchor: "left", dominant: "tall" }
  },
  {
    /* Две вертикальные статьи во всю ширину — пауза между тяжёлыми группами. */
    id: "pair-tall",
    cells: ["aaaaaabbbbbb"],
    slots: [
      { key: "a", variant: "large", media: "above" },
      { key: "b", variant: "large", media: "above" }
    ],
    md: { cols: 2 },
    traits: { anchor: "center", dominant: "tall" }
  },
  {
    /* Четыре вертикали сеткой два на два: пара сверху, пара снизу. */
    id: "quad-square",
    cells: ["aaaaaabbbbbb", "ccccccdddddd"],
    slots: [
      { key: "a", variant: "large", media: "above" },
      { key: "b", variant: "large", media: "above" },
      { key: "c", variant: "large", media: "above" },
      { key: "d", variant: "large", media: "above" }
    ],
    md: { cols: 2 },
    traits: { anchor: "center", dominant: "tall" }
  },
  {
    /* Три вертикали неравной ширины: геометрия строгая, доли разные. */
    id: "trio-uneven",
    cells: ["aaaaabbbbccc"],
    slots: [
      { key: "a", variant: "large", media: "above" },
      { key: "b", variant: "large", media: "above" },
      { key: "c", variant: "large", media: "above" }
    ],
    md: { cols: 2, spans: { a: 2 } },
    traits: { anchor: "left", dominant: "tall" }
  },
  {
    /* Крупный материал слева и башня из трёх компактных справа. */
    id: "wide-trio-right",
    cells: ["aaaaaaabbbbb", "aaaaaaaccccc", "aaaaaaaddddd"],
    slots: [
      { key: "a", variant: "large", media: "beside" },
      { key: "b", variant: "small" },
      { key: "c", variant: "small" },
      { key: "d", variant: "small" }
    ],
    traits: { anchor: "left", dominant: "wide" }
  },
  {
    /* Крупный материал слева и башня из трёх компактных справа, зеркально. */
    id: "mirror-tower",
    cells: ["bbbbbaaaaaaa", "cccccaaaaaaa", "dddddaaaaaaa"],
    slots: [
      { key: "a", variant: "large", media: "beside" },
      { key: "b", variant: "small" },
      { key: "c", variant: "small" },
      { key: "d", variant: "small" }
    ],
    traits: { anchor: "right", dominant: "wide" }
  },
  {
    /* Ведущий во всю ширину с изображением сбоку — не сверху: полноширинное
       изображение в ленте конкурирует с флагманом страницы. Под ним пара. */
    id: "lead-wide-pair",
    cells: ["aaaaaaaaaaaa", "bbbbbbcccccc"],
    slots: [
      { key: "a", variant: "large", media: "beside" },
      { key: "b", variant: "large", media: "above" },
      { key: "c", variant: "large", media: "above" }
    ],
    md: { cols: 2, spans: { a: 2 } },
    traits: { anchor: "center", dominant: "wide" }
  },
  {
    /* Крупный слева на два ряда и четыре компактных справа сеткой два на два. */
    id: "quartet-lead",
    cells: ["aaaaaabbbccc", "aaaaaadddeee"],
    slots: [
      { key: "a", variant: "large", media: "beside" },
      { key: "b", variant: "large", media: "above" },
      { key: "c", variant: "large", media: "above" },
      { key: "d", variant: "large", media: "above" },
      { key: "e", variant: "large", media: "above" }
    ],
    md: { cols: 2, spans: { a: 2 } },
    traits: { anchor: "left", dominant: "wide" }
  },
  {
    /* Широкая и узкая рядом: доли резко разные, обе вертикальные. */
    id: "stripe-wide-narrow",
    cells: ["aaaaaaaaabbb"],
    slots: [
      { key: "a", variant: "large", media: "beside" },
      { key: "b", variant: "large", media: "above" }
    ],
    md: { cols: 2, spans: { a: 2 } },
    traits: { anchor: "left", dominant: "wide" }
  },
  {
    /* Единственное намеренное нарушение геометрии: группа отступает от левой
       кромки на две колонки. Нарушает строй сдвигом, а не размером — крупное
       изображение здесь конкурировало бы с флагманом страницы. */
    id: "break-inset",
    cells: ["..aaaabbbbbb"],
    slots: [
      { key: "a", variant: "large", media: "above" },
      { key: "b", variant: "large", media: "above" }
    ],
    md: { cols: 2 },
    traits: { anchor: "center", dominant: "tall", accent: true }
  }
]

const byId = new Map(ARTICLE_LAYOUTS.map((l) => [l.id, l]))

export const getLayout = (id: string): GroupLayout | undefined => byId.get(id)

/** Сколько материалов вмещает раскладка. */
export const capacityOf = (layout: GroupLayout): number => layout.slots.length

/** Порядок слотов: первый материал попадает в первый слот. */
export const slotOrder = (layout: GroupLayout): string[] => layout.slots.map((s) => s.key)

/** Стиль сетки для широких экранов. Высота рядов — по содержимому: трек `fr` не
 *  сжимается ниже контента и заявленных пропорций всё равно не даёт. */
export const toGridStyle = (layout: GroupLayout): Record<string, string> => ({
  "grid-template-columns": `repeat(${GRID_COLUMNS}, 1fr)`,
  "grid-template-rows": layout.cells.map(() => "auto").join(" "),
  "grid-template-areas": layout.cells.map((row) => `"${[...row].join(" ")}"`).join("\n")
})

/**
 * Разделители выводятся из матрицы: вертикальная линейка нужна слоту, у
 * которого справа стоит другой слот. Соседняя пустота линейки не рождает —
 * пустота сама и есть разделитель.
 */
export const rulesFor = (layout: GroupLayout, key: string): SlotRules => {
  let right = false
  layout.cells.forEach((row) => {
    for (let x = 0; x < row.length - 1; x++) {
      const here = row[x]
      const next = row[x + 1]
      if (here === key && next !== key && next !== ".") right = true
    }
  })
  return { right }
}

/** Спан слота на средних экранах: из `md`, иначе один столбец. */
export const mdSpanFor = (layout: GroupLayout, key: string): number => layout.md?.spans?.[key] ?? 1

export const mdColsOf = (layout: GroupLayout): number => layout.md?.cols ?? 2

/**
 * Проверки, без которых модель ломается молча: непрямоугольный слот заставляет
 * браузер отбросить всё объявление `grid-template-areas` целиком и без ошибки.
 */
export const validateLayout = (layout: GroupLayout): string[] => {
  const errors: string[] = []
  const { id, cells, slots } = layout

  if (cells.length === 0) errors.push(`${id}: пустая матрица`)
  cells.forEach((row, i) => {
    if (row.length !== GRID_COLUMNS) errors.push(`${id}: строка ${i} длиной ${row.length}, ожидается ${GRID_COLUMNS}`)
  })

  const inCells = new Set([...cells.join("")].filter((c) => c !== "."))
  const inSlots = new Set(slots.map((s) => s.key))
  inCells.forEach((k) => {
    if (!inSlots.has(k)) errors.push(`${id}: слот «${k}» есть в матрице, но не описан`)
  })
  inSlots.forEach((k) => {
    if (!inCells.has(k)) errors.push(`${id}: слот «${k}» описан, но в матрице отсутствует`)
  })
  if (inSlots.size !== slots.length) errors.push(`${id}: повторяющиеся ключи слотов`)

  inCells.forEach((k) => {
    const coords: Array<[number, number]> = []
    cells.forEach((row, y) => [...row].forEach((c, x) => c === k && coords.push([y, x])))
    const ys = coords.map(([y]) => y)
    const xs = coords.map(([, x]) => x)
    const area = (Math.max(...ys) - Math.min(...ys) + 1) * (Math.max(...xs) - Math.min(...xs) + 1)
    if (area !== coords.length) errors.push(`${id}: слот «${k}» не прямоугольный — сетка молча схлопнется`)
  })

  return errors
}

/**
 * Ритм ленты отвергает монотонность: соседние группы обязаны различаться, а
 * нарушение геометрии допускается ровно одно и не с краю.
 */
export const validateRhythm = (rhythm: string[], articleCount: number): string[] => {
  const errors: string[] = []
  const layouts = rhythm.map((id) => getLayout(id))

  rhythm.forEach((id, i) => {
    if (!layouts[i]) errors.push(`раскладка «${id}» на позиции ${i} не найдена в реестре`)
  })
  if (errors.length) return errors

  const signature = (i: number) => {
    const t = layouts[i]!.traits
    return `${t.anchor}/${layouts[i]!.cells.length}/${t.dominant}`
  }
  for (let i = 1; i < rhythm.length; i++) {
    if (rhythm[i] === rhythm[i - 1])
      errors.push(`две одинаковые раскладки подряд: «${rhythm[i]}» на позициях ${i - 1} и ${i}`)
    else if (signature(i) === signature(i - 1))
      errors.push(`соседние группы читаются одинаково: ${signature(i - 1)} на позициях ${i - 1} и ${i}`)
  }

  const accents = rhythm.filter((id) => getLayout(id)!.traits.accent)
  if (accents.length > 1) errors.push(`нарушение должно быть одно на страницу, найдено ${accents.length}`)
  const accentAt = rhythm.findIndex((id) => getLayout(id)!.traits.accent)
  if (accentAt === 0 || (accentAt !== -1 && accentAt === rhythm.length - 1))
    errors.push("нарушение должно опираться на регулярность с обеих сторон, а не стоять с краю")

  const capacity = layouts.reduce((sum, l) => sum + capacityOf(l!), 0)
  if (capacity !== articleCount) errors.push(`ритм рассчитан на ${capacity} материалов, доступно ${articleCount}`)

  return errors
}
