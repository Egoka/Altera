import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import type { GraphQLContext } from "../src/prisma"
import { grantPlan, listAdminGrants, revokePlan } from "../src/admin/grants"

const now = new Date("2026-09-19T12:00:00.000Z")

function actor(role: "author" | "analyst" | "admin" | "owner" = "admin") {
  return {
    id: `${role}-1`,
    role,
    archivedAt: null,
    planTier: "free",
    planUntil: null
  }
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    userId: "user-1",
    tier: "standard",
    startsAt: new Date("2026-09-18T00:00:00.000Z"),
    endsAt: new Date("2026-09-20T00:00:00.000Z"),
    grantedById: "admin-1",
    reason: "Редакционная выдача",
    revokedAt: null,
    createdAt: new Date("2026-09-17T00:00:00.000Z"),
    user: { id: "user-1", name: "Иван", handle: "ivan" },
    grantedBy: { id: "admin-1", name: "Администратор", handle: "admin" },
    ...overrides
  }
}

function context(
  options: {
    role?: "author" | "analyst" | "admin" | "owner"
    rows?: ReturnType<typeof grant>[]
    recipient?: Record<string, unknown> | null
    existing?: ReturnType<typeof grant> | null
  } = {}
): GraphQLContext {
  const planGrant = {
    findMany: vi.fn().mockResolvedValue(options.rows ?? []),
    findUnique: vi.fn().mockResolvedValue(options.existing ?? null),
    create: vi.fn().mockResolvedValue(grant()),
    update: vi.fn().mockResolvedValue(grant({ revokedAt: now }))
  }
  const auditLog = { create: vi.fn().mockResolvedValue({ id: "audit-1" }) }
  const user = {
    findUnique: vi
      .fn()
      .mockResolvedValue(
        options.recipient === undefined
          ? { id: "user-1", name: "Иван", handle: "ivan", archivedAt: null, isServiceAccount: false }
          : options.recipient
      )
  }
  const prisma = {
    planGrant,
    auditLog,
    user,
    $transaction: vi.fn(async (callback: (tx: { planGrant: typeof planGrant; auditLog: typeof auditLog }) => unknown) =>
      callback({ planGrant, auditLog })
    )
  }

  return {
    currentUser: actor(options.role),
    requestId: "req-grants",
    prisma
  } as unknown as GraphQLContext
}

describe("admin grants", () => {
  it("derives queued, active, ended and revoked states from persisted dates", async () => {
    const ctx = context({
      rows: [
        grant({ id: "queued", startsAt: new Date("2026-09-20T00:00:00.000Z") }),
        grant({ id: "active" }),
        grant({ id: "ended", endsAt: new Date("2026-09-19T00:00:00.000Z") }),
        grant({ id: "revoked", revokedAt: new Date("2026-09-18T12:00:00.000Z") })
      ]
    })

    const rows = await listAdminGrants(ctx, now)

    expect(rows.map(({ id, status }) => [id, status])).toEqual([
      ["queued", "queued"],
      ["active", "active"],
      ["ended", "ended"],
      ["revoked", "revoked"]
    ])
  })

  it("rejects a non-finance actor before querying personal grant data", async () => {
    const ctx = context({ role: "author" })

    await expect(listAdminGrants(ctx, now)).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "FORBIDDEN", action: "plan.read" }
    })
    expect(ctx.prisma.planGrant.findMany).not.toHaveBeenCalled()
  })

  it("rejects a manual grant without an end date", async () => {
    const ctx = context()

    await expect(
      grantPlan(
        ctx,
        {
          userHandle: "ivan",
          tier: "standard",
          startsAt: "2026-09-19T00:00:00.000Z",
          endsAt: null,
          reason: "Редакционная выдача"
        },
        now
      )
    ).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "VALIDATION_ERROR", field: "endsAt", rule: "required" }
    })
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled()
  })

  it("rejects a grant to a service account", async () => {
    const ctx = context({
      recipient: { id: "service-1", name: "Сервис", handle: "service", archivedAt: null, isServiceAccount: true }
    })

    await expect(
      grantPlan(
        ctx,
        {
          userHandle: "service",
          tier: "pro",
          startsAt: "2026-09-19T00:00:00.000Z",
          endsAt: "2026-10-19T00:00:00.000Z",
          reason: "Недопустимая выдача"
        },
        now
      )
    ).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "FORBIDDEN", action: "plan.grant" }
    })
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled()
  })

  it("creates a grant and plan.grant audit record in one transaction", async () => {
    const ctx = context()

    const result = await grantPlan(
      ctx,
      {
        userHandle: "ivan",
        tier: "standard",
        startsAt: "2026-09-19T00:00:00.000Z",
        endsAt: "2026-10-19T00:00:00.000Z",
        reason: "  Редакционная выдача  "
      },
      now
    )

    expect(result.status).toBe("active")
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(ctx.prisma.planGrant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          grantedById: "admin-1",
          reason: "Редакционная выдача"
        })
      })
    )
    expect(ctx.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "plan.grant",
        actorId: "admin-1",
        actorRole: "admin",
        entityType: "planGrant",
        entityId: "grant-1",
        requestId: "req-grants"
      })
    })
  })

  it("revokes an active grant and records plan.revoke atomically", async () => {
    const ctx = context({ existing: grant() })

    const result = await revokePlan(ctx, { grantId: "grant-1", reason: "  Решение редакции  " }, now)

    expect(result.status).toBe("revoked")
    expect(ctx.prisma.planGrant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "grant-1" }, data: { revokedAt: now } })
    )
    expect(ctx.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "plan.revoke",
        actorId: "admin-1",
        entityId: "grant-1",
        requestId: "req-grants"
      })
    })
  })
})
