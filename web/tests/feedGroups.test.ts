import { describe, expect, it } from "vitest"
import { capacityOf, getLayout, validateRhythm } from "../app/utils/articleLayouts"
import { buildFeedGroups } from "../app/utils/feedGroups"
import { SECTION_RHYTHM } from "../app/utils/feedRhythm"

// Лента рубрики получает произвольное число материалов: полную страницу, хвост
// последней страницы, пустой фильтр. Сборка идёт по ритму циклически, а остаток,
// который не вмещается в следующую группу, ложится в запасную раскладку ровно под
// него — дырявой сетки не бывает.

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a${i + 1}` }))

const PAGE = SECTION_RHYTHM.reduce((sum, id) => sum + capacityOf(getLayout(id)!), 0)

describe("ритм рубрики", () => {
  it("вмещает страницу из 24 материалов и не монотонен", () => {
    expect(PAGE).toBe(24)
    expect(validateRhythm(SECTION_RHYTHM, 24)).toEqual([])
  })
})

describe("сборка групп ленты", () => {
  it("полная страница идёт по ритму, группа за группой", () => {
    const groups = buildFeedGroups(items(PAGE), SECTION_RHYTHM)
    expect(groups.map((g) => g.layout)).toEqual(SECTION_RHYTHM)
    groups.forEach((g) => expect(g.articles.length).toBe(capacityOf(getLayout(g.layout)!)))
  })

  it("остаток в один материал получает solo-wide", () => {
    const groups = buildFeedGroups(items(PAGE + 1), SECTION_RHYTHM)
    const last = groups[groups.length - 1]!
    expect(last.layout).toBe("solo-wide")
    expect(last.articles.map((a) => a.id)).toEqual(["a25"])
  })

  it("остаток в два материала получает pair-tall", () => {
    const groups = buildFeedGroups(items(PAGE + 2), SECTION_RHYTHM)
    expect(groups[groups.length - 1]!.layout).toBe("pair-tall")
  })

  it("остаток ровно под следующую раскладку ритма идёт по ритму", () => {
    const groups = buildFeedGroups(items(PAGE + 3), SECTION_RHYTHM)
    expect(groups[groups.length - 1]!.layout).toBe(SECTION_RHYTHM[0])
  })

  it("запасная раскладка не повторяет предыдущую группу", () => {
    const groups = buildFeedGroups(items(8), ["quad-square", "feature-stack"])
    expect(groups.map((g) => g.layout)).toEqual(["quad-square", "tower-left"])
  })

  it("материалы не теряются, не дублируются и идут по порядку", () => {
    const source = items(29)
    const groups = buildFeedGroups(source, SECTION_RHYTHM)
    expect(groups.flatMap((g) => g.articles)).toEqual(source)
  })

  it("ключи групп на странице уникальны", () => {
    const groups = buildFeedGroups(items(PAGE * 2), SECTION_RHYTHM)
    expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length)
  })

  it("пустой список даёт пустую ленту", () => {
    expect(buildFeedGroups([], SECTION_RHYTHM)).toEqual([])
  })
})
