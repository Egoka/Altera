import { describe, it, expect } from "vitest"
import { GraphQLError } from "graphql"
import { ensureAuthenticated, ensureHasRole } from "../src/exceptions/permissions"

// Проверка прав — единственный контур доступа в API (CLAUDE.md, «Права»).
// Тесты фиксируют существующее поведение, чтобы его нельзя было ослабить незаметно.

const user = (role: string) => ({ id: "u1", role }) as never

describe("ensureAuthenticated", () => {
  it("возвращает пользователя, когда он есть", () => {
    const current = user("reader")
    expect(ensureAuthenticated(current, "req-1")).toBe(current)
  })

  it("бросает UNAUTHENTICATED, когда пользователя нет", () => {
    expect(() => ensureAuthenticated(null, "req-1")).toThrow(GraphQLError)
    try {
      ensureAuthenticated(null, "req-1")
    } catch (error) {
      expect((error as GraphQLError).extensions).toEqual({ code: "UNAUTHENTICATED", requestId: "req-1" })
    }
  })
})

describe("ensureHasRole", () => {
  it("пропускает пользователя с требуемой ролью", () => {
    expect(() => ensureHasRole(user("admin"), "admin" as never, "admin.read", "req-1")).not.toThrow()
  })

  it("пропускает пользователя, если его роль есть в списке", () => {
    expect(() => ensureHasRole(user("editor"), ["admin", "editor"] as never, "article.edit", "req-1")).not.toThrow()
  })

  it("отказывает, когда роль не подходит", () => {
    expect(() => ensureHasRole(user("reader"), "admin" as never, "admin.read", "req-1")).toThrow(GraphQLError)
    try {
      ensureHasRole(user("reader"), "admin" as never, "admin.read", "req-1")
    } catch (error) {
      expect((error as GraphQLError).extensions).toEqual({
        code: "FORBIDDEN",
        requestId: "req-1",
        action: "admin.read"
      })
    }
  })

  it("отказывает неаутентифицированному раньше проверки роли", () => {
    expect(() => ensureHasRole(null, "reader" as never, "profile.read", "req-1")).toThrow(GraphQLError)
  })
})
