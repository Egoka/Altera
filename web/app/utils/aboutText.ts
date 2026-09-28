/**
 * Зона «Что ещё не работает» страницы «О проекте» (`docs/spec/20-public/about.md` §5 зона 6,
 * журнал §37 п. 1, T-118).
 *
 * Список ведёт владелец в тексте вида `about`: раздел второго уровня с якорем `not-working`
 * выносится на страницу отдельной зоной, а остальной текст показывается как прежде. Отдельного
 * поля у API нет намеренно: список обновляется на каждом этапе вместе с текстом и публикуется тем
 * же действием `/admin/legal`, поэтому источник у зоны и у текста один. Разметка приходит уже
 * проверенной при публикации (`server/src/legal/texts.ts`), поэтому пункты выводятся как есть —
 * со ссылками, которые поставил владелец.
 */

/** Якорь раздела: тот же механизм `id`, что адресует разделы юридических текстов. */
export const ABOUT_NOT_WORKING_ANCHOR = "not-working"

export interface AboutNotWorking {
  /** Заголовок раздела из текста владельца — своего названия у зоны нет. */
  title: string
  /** Пункты списка: внутренняя разметка `<li>` (или абзацев, если списка нет). */
  items: string[]
}

export interface AboutText {
  notWorking: AboutNotWorking | null
  /** Текст без вынесенного раздела: зона не дублирует список в общем тексте. */
  body: string
}

const NOT_WORKING_HEADING = new RegExp(
  `<h2\\b[^>]*\\bid\\s*=\\s*["']${ABOUT_NOT_WORKING_ANCHOR}["'][^>]*>([\\s\\S]*?)<\\/h2>`,
  "i"
)
const NEXT_HEADING = /<h2\b/i
const LIST_ITEM = /<li\b[^>]*>([\s\S]*?)<\/li>/gi
const PARAGRAPH = /<p\b[^>]*>([\s\S]*?)<\/p>/gi

const decodeEntities = (value: string): string =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")

const plainText = (html: string): string =>
  decodeEntities(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim()

const collect = (segment: string, pattern: RegExp): string[] =>
  [...segment.matchAll(pattern)].map((match) => (match[1] ?? "").trim()).filter((item) => plainText(item) !== "")

/**
 * Разбор текста «О проекте» на зону списка и остальной текст. Без раздела `not-working` — или
 * когда в нём нет ни пунктов, ни абзацев — текст возвращается целиком: страница ничего не теряет.
 * Вложенные списки внутри пункта не разбираются: список статуса плоский.
 */
export const splitAboutText = (html: string): AboutText => {
  const heading = NOT_WORKING_HEADING.exec(html)
  if (!heading) return { notWorking: null, body: html }

  const start = heading.index
  const afterHeading = start + heading[0].length
  const rest = html.slice(afterHeading)
  const next = rest.search(NEXT_HEADING)
  const end = next === -1 ? html.length : afterHeading + next
  const segment = html.slice(afterHeading, end)

  const title = plainText(heading[1] ?? "")
  const listItems = collect(segment, LIST_ITEM)
  const items = listItems.length ? listItems : collect(segment, PARAGRAPH)
  if (!title || !items.length) return { notWorking: null, body: html }

  return { notWorking: { title, items }, body: (html.slice(0, start) + html.slice(end)).trim() }
}
