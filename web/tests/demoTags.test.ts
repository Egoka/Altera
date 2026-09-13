import { describe, expect, it } from "vitest"
import { DEMO_TAGS, findDemoTag } from "~/utils/demoTags"

describe("справочник демо-тегов", () => {
  it("не содержит повторяющихся слагов", () => {
    const slugs = DEMO_TAGS.map((tag) => tag.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it("у каждого тега есть непустое имя", () => {
    expect(DEMO_TAGS.every((tag) => tag.name.trim().length > 0)).toBe(true)
  })

  it("находит тег по слагу", () => {
    expect(findDemoTag("economics")).toEqual({ name: "Экономика", slug: "economics" })
  })

  it("неизвестный слаг подставляет сам себя вместо имени", () => {
    // Страница тега не должна показывать чужое имя: пока данных нет, честнее
    // показать сам слаг, чем первый попавшийся тег из мока.
    expect(findDemoTag("нет-такого-тега")).toEqual({ name: "нет-такого-тега", slug: "нет-такого-тега" })
  })

  it("пустой слаг не роняет поиск", () => {
    expect(findDemoTag("")).toEqual({ name: "", slug: "" })
  })
})
