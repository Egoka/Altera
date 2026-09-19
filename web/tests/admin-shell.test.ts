import { describe, expect, it } from "vitest"
import { canManageTaxonomy, getAdminAccessDecision, getAdminNavigation, parseAdminPeriod } from "../app/utils/admin"

describe("admin shell role navigation", () => {
  it.each([
    ["editor", ["/admin", "/admin/articles", "/admin/mail", "/admin/audit"]],
    ["moderator", ["/admin", "/admin/review", "/admin/ai", "/admin/audit", "/admin/mail"]],
    [
      "analyst",
      [
        "/admin",
        "/admin/users",
        "/admin/subscriptions",
        "/admin/payments",
        "/admin/grants",
        "/admin/statistics",
        "/admin/ai",
        "/admin/audit",
        "/admin/mail"
      ]
    ],
    [
      "admin",
      [
        "/admin",
        "/admin/categories",
        "/admin/tags",
        "/admin/users",
        "/admin/admins",
        "/admin/subscriptions",
        "/admin/payments",
        "/admin/grants",
        "/admin/statistics",
        "/admin/jobs",
        "/admin/ai",
        "/admin/audit",
        "/admin/mail",
        "/admin/errors",
        "/admin/legal",
        "/admin/settings"
      ]
    ]
  ] as const)("shows only the %s default sections", (role, expectedRoutes) => {
    expect(getAdminNavigation(role).map(({ to }) => to)).toEqual(expectedRoutes)
  })

  it("gives owner every active section and keeps deferred complaints hidden", () => {
    const routes = getAdminNavigation("owner").map(({ to }) => to)

    expect(routes).toEqual(
      expect.arrayContaining([
        "/admin/articles",
        "/admin/review",
        "/admin/statistics",
        "/admin/errors",
        "/admin/ranking",
        "/admin/settings"
      ])
    )
    expect(routes).not.toContain("/admin/reports")
  })

  it.each([
    ["7d", 7],
    ["30d", 30],
    ["invalid", 7],
    [undefined, 7]
  ] as const)("parses period %s as %i days", (value, expected) => {
    expect(parseAdminPeriod(value)).toBe(expected)
  })
})

describe("admin middleware decision", () => {
  it.each([
    ["admin", true],
    ["owner", true],
    ["editor", false],
    ["analyst", false]
  ] as const)("limits taxonomy management for %s", (role, expected) => {
    expect(canManageTaxonomy(role)).toBe(expected)
  })

  it("allows a service summary returned by the server", () => {
    const summary = { role: "editor", cards: [] } as const

    expect(getAdminAccessDecision({ data: { adminSummary: summary } }, "/admin?period=30d")).toEqual({
      kind: "allow",
      summary
    })
  })

  it("redirects an unauthenticated request to login with the original target", () => {
    expect(
      getAdminAccessDecision({ errors: [{ extensions: { code: "UNAUTHENTICATED" } }] }, "/admin?period=30d")
    ).toEqual({ kind: "redirect", to: "/login?next=%2Fadmin%3Fperiod%3D30d" })
  })

  it("turns a server-side role rejection into a 403", () => {
    expect(getAdminAccessDecision({ errors: [{ extensions: { code: "FORBIDDEN" } }] }, "/admin")).toEqual({
      kind: "forbidden"
    })
  })

  it("keeps the safe requestId for technical failures", () => {
    expect(
      getAdminAccessDecision({ errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "req-safe" } }] }, "/admin")
    ).toEqual({ kind: "error", requestId: "req-safe" })
  })
})
