import { describe, it, expect } from "vitest"
import { validatePagination, validateSort, calculatePagination, getCacheKey } from "../src/utils/admin"

// Хелперы админских запросов (docs/guides/admin_query_standards.md).
// Из `../prisma` здесь импортируется только тип, поэтому подключения к Redis не происходит.

describe("validatePagination", () => {
  it("пропускает корректные границы", () => {
    expect(() => validatePagination({ page: 1, limit: 100 })).not.toThrow()
  })

  it("отклоняет страницу меньше первой", () => {
    expect(() => validatePagination({ page: 0, limit: 10 })).toThrow(/Page must be >= 1/)
  })

  it("отклоняет лимит больше ста", () => {
    expect(() => validatePagination({ page: 1, limit: 101 })).toThrow(/Limit cannot exceed 100/)
  })
})

describe("validateSort", () => {
  it("пропускает разрешённое поле и направление", () => {
    expect(() => validateSort({ field: "createdAt", direction: "DESC" }, ["createdAt"])).not.toThrow()
  })

  it("отклоняет поле вне списка разрешённых", () => {
    expect(() => validateSort({ field: "password", direction: "ASC" }, ["createdAt"])).toThrow(/Invalid sort field/)
  })

  it("отклоняет неизвестное направление", () => {
    expect(() => validateSort({ field: "createdAt", direction: "SIDEWAYS" }, ["createdAt"])).toThrow(
      /Invalid sort direction/
    )
  })
})

describe("calculatePagination", () => {
  it("считает смещение и признаки соседних страниц", () => {
    const result = calculatePagination(2, 10, 25)
    expect(result.skip).toBe(10)
    expect(result.take).toBe(10)
    expect(result.pagination.totalPages).toBe(3)
    expect(result.pagination.hasNextPage).toBe(true)
    expect(result.pagination.hasPreviousPage).toBe(true)
  })

  it("на первой странице нет предыдущей", () => {
    expect(calculatePagination(1, 10, 5).pagination.hasPreviousPage).toBe(false)
  })

  it("на последней странице нет следующей", () => {
    expect(calculatePagination(3, 10, 25).pagination.hasNextPage).toBe(false)
  })

  it("срезает лимит до сотни", () => {
    expect(calculatePagination(1, 500, 1000).take).toBe(100)
  })
})

describe("getCacheKey", () => {
  it("устойчив: одинаковые параметры дают один ключ", () => {
    expect(getCacheKey("users", { page: 1 })).toBe(getCacheKey("users", { page: 1 }))
  })

  it("различает разные параметры", () => {
    expect(getCacheKey("users", { search: "иван" })).not.toBe(getCacheKey("users", { search: "пётр" }))
  })

  it("различает разные операции", () => {
    expect(getCacheKey("users", { page: 1 })).not.toBe(getCacheKey("articles", { page: 1 }))
  })
})
