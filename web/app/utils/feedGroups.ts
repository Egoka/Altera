import type { GroupLayout } from "~/types/layout"
import { capacityOf, getLayout, signatureOf } from "~/utils/articleLayouts"

/** Группа ленты: раскладка из реестра и материалы ровно под её слоты. */
export interface FeedGroup<T> {
  /** Ключ для `v-for`: имя раскладки и порядковый номер группы на странице. */
  id: string
  layout: string
  articles: T[]
}

/**
 * Запасные раскладки под остаток страницы, по вместимости. Берётся первая,
 * не совпадающая с предыдущей группой ни именем, ни сигнатурой — иначе две
 * одинаковые группы подряд, что валидатор ритма запрещает.
 */
const TAIL_LAYOUTS: Record<number, string[]> = {
  1: ["solo-wide"],
  2: ["pair-tall", "stripe-wide-narrow"],
  3: ["trio-tall", "hero-right", "hero-left", "trio-uneven"],
  4: ["quad-square", "tower-left", "mirror-tower", "wide-trio-right"],
  5: ["feature-stack", "quartet-lead"]
}
const MAX_TAIL = Math.max(...Object.keys(TAIL_LAYOUTS).map(Number))

const layoutOrThrow = (id: string): GroupLayout => {
  const layout = getLayout(id)
  if (!layout) throw new Error(`раскладка «${id}» не найдена в реестре`)
  return layout
}

const tailLayout = (remainder: number, previous?: GroupLayout): GroupLayout => {
  const candidates = TAIL_LAYOUTS[Math.min(remainder, MAX_TAIL)] ?? []
  const fits = candidates
    .map(layoutOrThrow)
    .find((l) => !previous || (l.id !== previous.id && signatureOf(l) !== signatureOf(previous)))
  if (!fits) throw new Error(`нет запасной раскладки под остаток ${remainder}`)
  return fits
}

/**
 * Собирает группы ленты из произвольного числа материалов: ритм идёт по кругу,
 * а когда остаток меньше вместимости следующей раскладки, остаток ложится в
 * запасную раскладку ровно под него. Материалы не теряются и не дублируются.
 */
export const buildFeedGroups = <T>(items: T[], rhythm: string[]): FeedGroup<T>[] => {
  if (!rhythm.length) throw new Error("ритм ленты пуст")
  const groups: FeedGroup<T>[] = []
  let cursor = 0
  let step = 0
  let previous: GroupLayout | undefined
  while (cursor < items.length) {
    const remainder = items.length - cursor
    const next = layoutOrThrow(rhythm[step % rhythm.length]!)
    const layout = capacityOf(next) <= remainder ? next : tailLayout(remainder, previous)
    const articles = items.slice(cursor, cursor + capacityOf(layout))
    groups.push({ id: `${layout.id}-${groups.length}`, layout: layout.id, articles })
    cursor += articles.length
    previous = layout
    if (layout === next) step++
  }
  return groups
}
