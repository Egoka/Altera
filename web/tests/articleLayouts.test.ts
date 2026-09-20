import { describe, expect, it } from "vitest"
import {
  ARTICLE_LAYOUTS,
  capacityOf,
  getLayout,
  mdMediaFor,
  mdSpanFor,
  validateLayout,
  validateRhythm
} from "../app/utils/articleLayouts"
import { LATEST_RHYTHM } from "../app/utils/feedRhythm"

// Кривая матрица ломает сетку молча: браузер отбрасывает grid-template-areas
// целиком и без ошибки. Ритм с неверной вместимостью молча терял хвост ленты.
// Оба валидатора работают и в dev-режиме, но только в консоли браузера —
// здесь они становятся красным тестом.

describe("реестр раскладок", () => {
  it.each(ARTICLE_LAYOUTS.map((layout) => [layout.id, layout] as const))(
    "«%s» проходит validateLayout",
    (_, layout) => {
      expect(validateLayout(layout)).toEqual([])
    }
  )

  it("идентификаторы уникальны", () => {
    const ids = ARTICLE_LAYOUTS.map((layout) => layout.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("ритм лент стартовой страницы", () => {
  it("круг «Нового» непротиворечив и не монотонен", () => {
    const capacity = LATEST_RHYTHM.reduce((sum, id) => sum + capacityOf(getLayout(id)!), 0)

    expect(validateRhythm(LATEST_RHYTHM, capacity)).toEqual([])
  })
})

// На средних экранах слоту, где текст стоит рядом с изображением, не хватает
// половины ширины: заголовок дробится на строки. Такой слот занимает всю
// строку, если реестр не сказал иначе; карточка с изображением сверху идёт по
// одному столбцу; композицию слота на средних экранах реестр может переопределить.
describe("средние экраны", () => {
  it("текст рядом с изображением получает всю строку, изображение сверху — столбец", () => {
    const tower = getLayout("wide-trio-right")!
    expect(mdSpanFor(tower, "a")).toBe(2)
    expect(mdSpanFor(tower, "b")).toBe(2)
    const quad = getLayout("quad-square")!
    expect(mdSpanFor(quad, "a")).toBe(1)
  })

  it("явный спан старше правила", () => {
    const layout = getLayout("trio-tall")!
    expect(mdSpanFor(layout, "a")).toBe(2)
    expect(mdSpanFor(layout, "b")).toBe(1)
  })

  it("переопределённая композиция тянет за собой спан", () => {
    const layout = getLayout("stripe-wide-narrow")!
    expect(mdMediaFor(layout, "b")).toBe("beside")
    expect(mdSpanFor(layout, "b")).toBe(2)
    expect(mdMediaFor(layout, "a")).toBe("beside")
  })
})
