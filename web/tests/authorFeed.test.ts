import { describe, expect, it } from "vitest"
import { capacityOf, getLayout, rowSpanFor, validateRhythm } from "../app/utils/articleLayouts"
import { formatArticleMonth } from "../app/utils/articleDate"
import { groupByMonth } from "../app/utils/feedGroups"
import { AUTHOR_RHYTHM } from "../app/utils/feedRhythm"

// Лента автора должна читаться как хроника: только однорядные раскладки, где порядок
// чтения слева направо совпадает с порядком по дате, и деление по месяцам публикации.

const capacity = AUTHOR_RHYTHM.reduce((sum, id) => sum + capacityOf(getLayout(id)!), 0)

describe("ритм автора", () => {
  it("открывается одиночной статьёй во всю строку", () => {
    expect(AUTHOR_RHYTHM[0]).toBe("solo-wide")
  })

  it("не монотонен внутри круга", () => {
    expect(validateRhythm(AUTHOR_RHYTHM, capacity)).toEqual([])
  })

  it("не монотонен на стыке круга", () => {
    const wrapped = [...AUTHOR_RHYTHM, AUTHOR_RHYTHM[0]!]
    expect(validateRhythm(wrapped, capacity + capacityOf(getLayout(AUTHOR_RHYTHM[0]!)!))).toEqual([])
  })

  it("состоит только из однорядных раскладок", () => {
    for (const id of AUTHOR_RHYTHM) {
      const layout = getLayout(id)!
      expect(layout.cells.length, id).toBe(1)
      for (const slot of layout.slots) expect(rowSpanFor(layout, slot.key), `${id}/${slot.key}`).toBe(1)
    }
  })
})

describe("разбиение по месяцам", () => {
  const items = [
    { id: "a", publishedAt: "2026-09-13T12:00:00Z" },
    { id: "b", publishedAt: "2026-09-02T12:00:00Z" },
    { id: "c", publishedAt: "2026-08-31T12:00:00Z" },
    { id: "d", publishedAt: "2026-06-15T12:00:00Z" }
  ]

  it("делит по месяцу публикации, сохраняя порядок", () => {
    const months = groupByMonth(items, (i) => i.publishedAt)
    expect(months.map((m) => m.key)).toEqual(["2026-09", "2026-08", "2026-06"])
    expect(months.map((m) => m.items.map((i) => i.id))).toEqual([["a", "b"], ["c"], ["d"]])
  })

  it("не теряет и не дублирует материалы", () => {
    const months = groupByMonth(items, (i) => i.publishedAt)
    expect(months.flatMap((m) => m.items)).toEqual(items)
  })

  it("пустой список даёт пустой результат", () => {
    expect(groupByMonth([], (i: { publishedAt: string }) => i.publishedAt)).toEqual([])
  })
})

describe("подпись месяца по локали", () => {
  it("русская: месяц с заглавной и год", () => {
    expect(formatArticleMonth("2026-09", "ru")).toBe("Сентябрь 2026")
  })

  it("английская: месяц и год", () => {
    expect(formatArticleMonth("2026-09", "en")).toBe("September 2026")
  })

  it("битый ключ даёт пустую строку", () => {
    expect(formatArticleMonth("не месяц", "ru")).toBe("")
  })
})
