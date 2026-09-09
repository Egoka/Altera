import { describe, it, expect } from "vitest"
import { GraphQLError } from "graphql"
import { ensureAuthenticated, ensureHasRole } from "../src/exceptions/permissions"

// Проверка прав — единственный контур доступа в API (CLAUDE.md, «Права»).
// Тесты фиксируют существующее поведение, чтобы его нельзя было ослабить незаметно.

const user = (role: string) => ({ id: "u1", role }) as never

describe("ensureAuthenticated", () => {
  it("возвращает пользователя, когда он есть", () => {
    const current = user("reader")
    expect(ensureAuthenticated(current)).toBe(current)
  })

  it("бросает UNAUTHENTICATED, когда пользователя нет", () => {
    expect(() => ensureAuthenticated(null)).toThrow(GraphQLError)
    try {
      ensureAuthenticated(null)
    } catch (error) {
      expect((error as GraphQLError).extensions.code).toBe("UNAUTHENTICATED")
    }
  })
})

describe("ensureHasRole", () => {
  it("пропускает пользователя с требуемой ролью", () => {
    expect(() => ensureHasRole(user("admin"), "admin" as never)).not.toThrow()
  })

  it("пропускает пользователя, если его роль есть в списке", () => {
    expect(() => ensureHasRole(user("editor"), ["admin", "editor"] as never)).not.toThrow()
  })

  it("отказывает, когда роль не подходит", () => {
    expect(() => ensureHasRole(user("reader"), "admin" as never)).toThrow(/Permission denied/)
  })

  it("отказывает неаутентифицированному раньше проверки роли", () => {
    expect(() => ensureHasRole(null, "reader" as never)).toThrow(/Authentication required/)
  })
})
