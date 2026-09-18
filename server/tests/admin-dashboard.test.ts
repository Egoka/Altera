import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import type { GraphQLContext } from "../src/prisma"
import { getAdminSummary } from "../src/admin/dashboard"

type ServiceRole = "editor" | "moderator" | "analyst" | "admin" | "owner"

function context(role: ServiceRole | "author", count = 1): GraphQLContext {
  const model = () => ({ count: vi.fn().mockResolvedValue(count) })

  return {
    currentUser: {
      id: `${role}-1`,
      role,
      archivedAt: null,
      planTier: "free",
      planUntil: null
    },
    requestId: "req-dashboard",
    logger: { log: vi.fn() },
    prisma: {
      article: model(),
      user: model(),
      aiProcess: model(),
      mailMessage: model(),
      job: model(),
      backendError: model(),
      reviewMessage: model(),
      planGrant: model()
    }
  } as unknown as GraphQLContext
}

describe("admin dashboard", () => {
  it.each([
    ["editor", ["editorial", "editorialProcesses"]],
    ["moderator", ["reviewQueue", "profileChecks"]],
    ["analyst", ["growth", "operationalQueue"]],
    ["admin", ["growth", "operationalQueue", "health"]],
    ["owner", ["growth", "operationalQueue", "health", "ownership"]]
  ] as const)("returns only the %s working cards", async (role, expectedCards) => {
    const ctx = context(role)

    const summary = await getAdminSummary(ctx, 7)

    expect(summary.role).toBe(role)
    expect(summary.cards.map((card) => card.id)).toEqual(expectedCards)
    expect(summary.cards.every((card) => card.status === "READY")).toBe(true)
    expect(ctx.logger.log).toHaveBeenCalledWith({
      level: "info",
      event: "admin.enter",
      requestId: "req-dashboard",
      message: "Service account entered the admin dashboard",
      data: { role }
    })
  })

  it("returns an empty dashboard instead of zero-value cards", async () => {
    const summary = await getAdminSummary(context("editor", 0), 30)

    expect(summary.cards).toEqual([])
  })

  it("keeps successful cards when one card fails and exposes only its requestId", async () => {
    const ctx = context("admin")
    vi.mocked(ctx.prisma.backendError.count).mockRejectedValueOnce(new Error("database secret"))

    const summary = await getAdminSummary(ctx, 7)

    expect(summary.cards.map((card) => card.id)).toEqual(["growth", "operationalQueue", "health"])
    expect(summary.cards.find((card) => card.id === "health")).toEqual({
      id: "health",
      href: "/admin/errors",
      metrics: [],
      requestId: "req-dashboard",
      status: "ERROR"
    })
    expect(JSON.stringify(summary)).not.toContain("database secret")
    expect(ctx.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: "backend.error", requestId: "req-dashboard", data: { cardId: "health" } })
    )
  })

  it("rejects an author before any dashboard query or enter log", async () => {
    const ctx = context("author")

    await expect(getAdminSummary(ctx, 7)).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "FORBIDDEN", requestId: "req-dashboard", action: "admin.enter" }
    })
    expect(ctx.prisma.article.count).not.toHaveBeenCalled()
    expect(ctx.logger.log).not.toHaveBeenCalled()
  })
})
