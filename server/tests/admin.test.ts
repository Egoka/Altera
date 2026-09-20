import { describe, it, expect } from "vitest"
import { GraphQLError } from "graphql"
import {
  buildOrderBy,
  calculatePagination,
  handleAdminError,
  validatePagination,
  validateSort
} from "../src/utils/admin"

// Хелперы админских запросов (docs/guides/admin_query_standards.md).
// Из `../prisma` здесь импортируется только тип, поэтому подключения к Redis не происходит.

describe("validatePagination", () => {
  it("пропускает корректные границы", () => {
    expect(() => validatePagination({ page: 1, limit: 100 }, "req-1")).not.toThrow()
  })

  it("отклоняет страницу меньше первой", () => {
    expect(() => validatePagination({ page: 0, limit: 10 }, "req-1")).toThrow(GraphQLError)
  })

  it("отклоняет лимит больше ста", () => {
    expect(() => validatePagination({ page: 1, limit: 101 }, "req-1")).toThrow(GraphQLError)
  })
})

describe("validateSort", () => {
  it("пропускает разрешённое поле и направление", () => {
    expect(() => validateSort({ field: "createdAt", direction: "DESC" }, ["createdAt"], "req-1")).not.toThrow()
  })

  it("отклоняет поле вне списка разрешённых", () => {
    expect(() => validateSort({ field: "password", direction: "ASC" }, ["createdAt"], "req-1")).toThrow(GraphQLError)
  })

  it("отклоняет неизвестное направление", () => {
    expect(() => validateSort({ field: "createdAt", direction: "SIDEWAYS" }, ["createdAt"], "req-1")).toThrow(
      GraphQLError
    )
  })
})

describe("handleAdminError", () => {
  it.each([
    ["P2002", "DUPLICATE"],
    ["P2025", "NOT_FOUND"],
    ["P2003", "CONFLICT"]
  ])("maps Prisma %s to %s", (prismaCode, apiCode) => {
    try {
      handleAdminError({ code: prismaCode, meta: { target: ["slug"] } }, "req-1", "article")
    } catch (error) {
      expect((error as GraphQLError).extensions.code).toBe(apiCode)
      expect((error as GraphQLError).extensions.requestId).toBe("req-1")
    }
  })

  it("rethrows an unknown error for the Yoga boundary", () => {
    const original = new Error("database unavailable")
    expect(() => handleAdminError(original, "req-1", "article")).toThrow(original)
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

describe("buildOrderBy", () => {
  it("строит простую сортировку по полю", () => {
    expect(buildOrderBy({ field: "name", direction: "ASC" })).toEqual({ name: "asc" })
  })

  it("сортирует по числу связанных материалов синтаксисом Prisma", () => {
    expect(buildOrderBy({ field: "_count.articles", direction: "DESC" })).toEqual({ articles: { _count: "desc" } })
  })

  it("разворачивает прочие составные поля во вложенный объект", () => {
    expect(buildOrderBy({ field: "author.name", direction: "ASC" })).toEqual({ author: { name: "asc" } })
  })
})
