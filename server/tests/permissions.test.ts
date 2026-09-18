import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import type { AppLogger } from "../src/observability/logger"
import {
  DEFAULT_ROLE_PERMISSIONS,
  ensureActiveAuthor,
  ensureAuthenticated,
  ensurePermission,
  ensureRole,
  type PermissionCode,
  type PermissionException,
  type PermissionUser
} from "../src/exceptions/permissions"

const NOW = new Date("2026-09-17T00:00:00.000Z")
const FUTURE = new Date("2026-10-17T00:00:00.000Z")
const PAST = new Date("2026-08-17T00:00:00.000Z")

const roles = ["reader", "author", "editor", "moderator", "analyst", "admin", "owner"] as const

function user(role: PermissionUser["role"], overrides: Partial<PermissionUser> = {}): PermissionUser {
  return {
    id: `${role}-1`,
    role,
    archivedAt: null,
    planTier: "free",
    planUntil: null,
    ...overrides
  }
}

function errorExtensions(run: () => unknown): Record<string, unknown> {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(GraphQLError)
    return (error as GraphQLError).extensions
  }
  throw new Error("Expected GraphQLError")
}

describe("ensureAuthenticated", () => {
  it("возвращает пользователя из проверенной серверной сессии", () => {
    const current = user("reader")

    expect(ensureAuthenticated(current, "req-1")).toBe(current)
  })

  it("возвращает UNAUTHENTICATED до остальных проверок", () => {
    expect(errorExtensions(() => ensureAuthenticated(null, "req-1"))).toEqual({
      code: "UNAUTHENTICATED",
      requestId: "req-1"
    })
  })
})

describe("ensureRole", () => {
  it("не использует иерархию служебных ролей, но всегда пропускает owner", () => {
    expect(() => ensureRole(user("moderator"), "moderator", "review.read", "req-1")).not.toThrow()
    expect(() => ensureRole(user("owner"), "moderator", "review.read", "req-1")).not.toThrow()
    expect(errorExtensions(() => ensureRole(user("admin"), "moderator", "review.read", "req-1"))).toEqual({
      code: "FORBIDDEN",
      requestId: "req-1",
      action: "review.read"
    })
  })

  it("не допускает архивированный аккаунт", () => {
    expect(
      errorExtensions(() => ensureRole(user("admin", { archivedAt: NOW }), "admin", "admin.users.read", "req-1"))
    ).toEqual({ code: "FORBIDDEN", requestId: "req-1", action: "admin.users.read" })
  })
})

describe("матрица дефолтных прав первого запуска", () => {
  const expected: Record<PermissionCode, readonly PermissionUser["role"][]> = {
    "admin.enter": ["editor", "moderator", "analyst", "admin", "owner"],
    publish: ["editor", "moderator", "owner"],
    review: ["moderator", "owner"],
    moderate: ["moderator", "admin", "owner"],
    editorial: ["editor", "owner"],
    taxonomy: ["admin", "owner"],
    finance: ["analyst", "admin", "owner"],
    accounts: ["admin", "owner"],
    "ai.read": ["moderator", "analyst", "admin", "owner"],
    user: ["reader", "author"],
    owner: ["owner"]
  }

  for (const [permission, allowedRoles] of Object.entries(expected) as [
    PermissionCode,
    readonly PermissionUser["role"][]
  ][]) {
    it(`${permission}: роль × действие соответствует утверждённой матрице`, () => {
      expect(DEFAULT_ROLE_PERMISSIONS[permission]).toEqual(allowedRoles)

      for (const role of roles) {
        const run = () => ensurePermission(user(role), permission, `${permission}.action`, "req-1", { now: NOW })
        if (allowedRoles.includes(role)) {
          expect(run, role).not.toThrow()
        } else {
          expect(errorExtensions(run), role).toMatchObject({ code: "FORBIDDEN", action: `${permission}.action` })
        }
      }
    })
  }
})

describe("индивидуальные исключения", () => {
  const active = (overrides: Partial<PermissionException> = {}): PermissionException => ({
    userId: "admin-1",
    role: "admin",
    permission: "publish",
    kind: "grant",
    startsAt: PAST,
    endsAt: FUTURE,
    revokedAt: null,
    ...overrides
  })

  it("grant добавляет право служебной роли, а deny снимает дефолтное", () => {
    expect(() =>
      ensurePermission(user("admin"), "publish", "translation.publish.manual", "req-1", {
        exceptions: [active()],
        now: NOW
      })
    ).not.toThrow()

    expect(
      errorExtensions(() =>
        ensurePermission(user("admin"), "taxonomy", "section.update", "req-1", {
          exceptions: [active({ permission: "taxonomy", kind: "deny" })],
          now: NOW
        })
      )
    ).toMatchObject({ code: "FORBIDDEN", action: "section.update" })
  })

  it("игнорирует исключения другой роли, отозванные, будущие и истёкшие", () => {
    const invalidExceptions: PermissionException[] = [
      active({ userId: "another-admin" }),
      active({ role: "moderator" }),
      active({ revokedAt: NOW }),
      active({ startsAt: FUTURE, endsAt: null }),
      active({ endsAt: PAST })
    ]

    expect(
      errorExtensions(() =>
        ensurePermission(user("admin"), "publish", "translation.publish.manual", "req-1", {
          exceptions: invalidExceptions,
          now: NOW
        })
      )
    ).toMatchObject({ code: "FORBIDDEN" })
  })

  it("не применяет исключения к reader, author и праву owner", () => {
    for (const current of [user("reader"), user("author")]) {
      expect(
        errorExtensions(() =>
          ensurePermission(current, "publish", "translation.publish.manual", "req-1", {
            exceptions: [active({ role: current.role })],
            now: NOW
          })
        )
      ).toMatchObject({ code: "FORBIDDEN" })
    }

    expect(
      errorExtensions(() =>
        ensurePermission(user("admin"), "owner", "settings.change", "req-1", {
          exceptions: [active({ permission: "owner" })],
          now: NOW
        })
      )
    ).toMatchObject({ code: "FORBIDDEN" })
  })
})

describe("ensureActiveAuthor", () => {
  it("пропускает author с активным standard или pro", () => {
    for (const planTier of ["standard", "pro"] as const) {
      expect(() =>
        ensureActiveAuthor(user("author", { planTier, planUntil: FUTURE }), "article.create", "req-1", { now: NOW })
      ).not.toThrow()
    }
  })

  it("возвращает PLAN_LIMIT и пишет безопасный структурированный лог при неактивном плане", () => {
    const log = vi.fn()
    const logger: AppLogger = { log }

    expect(
      errorExtensions(() =>
        ensureActiveAuthor(user("author", { planTier: "standard", planUntil: PAST }), "translation.save", "req-1", {
          now: NOW,
          logger
        })
      )
    ).toEqual({
      code: "PLAN_LIMIT",
      requestId: "req-1",
      requiredTier: "standard",
      limit: 1,
      current: 0
    })
    expect(log).toHaveBeenCalledWith({
      level: "warn",
      event: "plan.action.rejected",
      message: "Author action rejected because the plan is inactive",
      requestId: "req-1",
      data: { action: "translation.save", role: "author", requiredTier: "standard" }
    })
  })

  it("возвращает PLAN_LIMIT после понижения истёкшего автора до reader", () => {
    expect(
      errorExtensions(() => ensureActiveAuthor(user("reader"), "translation.save", "req-1", { now: NOW }))
    ).toMatchObject({
      code: "PLAN_LIMIT",
      requiredTier: "standard"
    })
  })

  it("возвращает FORBIDDEN служебной роли вместо обхода плана", () => {
    expect(errorExtensions(() => ensureActiveAuthor(user("editor"), "article.create", "req-1", { now: NOW }))).toEqual({
      code: "FORBIDDEN",
      requestId: "req-1",
      action: "article.create"
    })
  })
})
