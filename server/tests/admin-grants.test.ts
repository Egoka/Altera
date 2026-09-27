import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import type { GraphQLContext } from "../src/prisma"
import { getAdminGrant, grantPlan, listAdminGrants, revokePlan } from "../src/admin/grants"
import { BASE_AUTHORSHIP_REASON } from "../src/authorship/base-authorship"

const now = new Date("2026-09-19T12:00:00.000Z")
const PAST = new Date("2026-09-18T00:00:00.000Z")
const SOON = new Date("2026-10-19T00:00:00.000Z")
const LATER = new Date("2026-11-19T00:00:00.000Z")

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

/** Автоматическая базовая выдача первого запуска: бессрочная и без выдавшего (`plan-free.md` п. 6а). */
function baseGrant(overrides: Record<string, unknown> = {}) {
  return grant({
    id: "grant-base",
    endsAt: null,
    grantedById: null,
    grantedBy: null,
    reason: BASE_AUTHORSHIP_REASON,
    ...overrides
  })
}

function context(
  options: {
    role?: "author" | "analyst" | "admin" | "owner"
    rows?: ReturnType<typeof grant>[]
    recipient?: Record<string, unknown> | null
    existing?: ReturnType<typeof grant> | null
    /** Выдачи получателя, по которым пересчитывается кэш плана. */
    userGrants?: Record<string, unknown>[]
    recipientRole?: "reader" | "author" | "editor"
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
      ),
    update: vi.fn().mockResolvedValue({})
  }
  // Пересчёт кэша плана внутри транзакции читает роль получателя и все его выдачи.
  const txUser = {
    findUnique: vi.fn().mockResolvedValue({ role: options.recipientRole ?? "reader", isServiceAccount: false }),
    update: user.update
  }
  const txPlanGrant = {
    ...planGrant,
    findMany: vi.fn(async (args: { select?: Record<string, unknown> }) =>
      args.select && "tier" in args.select ? (options.userGrants ?? []) : (options.rows ?? [])
    )
  }
  const prisma = {
    planGrant,
    auditLog,
    user,
    $transaction: vi.fn(
      async (callback: (tx: { planGrant: typeof txPlanGrant; auditLog: typeof auditLog }) => unknown) =>
        callback({ planGrant: txPlanGrant, auditLog, user: txUser } as never)
    )
  }

  return {
    currentUser: actor(options.role),
    requestId: "req-grants",
    prisma
  } as unknown as GraphQLContext
}

/** Что записано в кэш плана получателя внутри транзакции. */
const planCacheWrite = (ctx: GraphQLContext) =>
  (ctx.prisma.user.update as unknown as { mock: { calls: [{ data: unknown }][] } }).mock.calls.at(-1)?.[0].data

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
    // Кэш пересчитывается по выдачам получателя — созданная выдача уже среди них.
    const ctx = context({
      userGrants: [{ tier: "standard", startsAt: PAST, endsAt: SOON, revokedAt: null }]
    })

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
    // AC-1: роль и кэш плана меняются в той же транзакции, иначе читатель с действующей
    // выдачей продолжал бы получать `PLAN_LIMIT` (`role-derivation.md` §2 п. 2).
    expect(planCacheWrite(ctx)).toEqual({ role: "author", planTier: "standard", planUntil: SOON })
  })

  it("revokes an active grant and records plan.revoke atomically", async () => {
    const ctx = context({
      existing: grant(),
      userGrants: [{ tier: "standard", startsAt: PAST, endsAt: SOON, revokedAt: now }]
    })

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
    // AC-2: после отзыва единственной выдачи кэш возвращается к `free`/`reader`.
    expect(planCacheWrite(ctx)).toEqual({ role: "reader", planTier: "free", planUntil: null })
  })

  it("оставляет действующей вторую выдачу: кэш идёт по оставшимся, а не по отозванной (AC-2)", async () => {
    const ctx = context({
      existing: grant(),
      userGrants: [
        { tier: "standard", startsAt: PAST, endsAt: SOON, revokedAt: now },
        { tier: "pro", startsAt: PAST, endsAt: LATER, revokedAt: null }
      ]
    })

    await revokePlan(ctx, { grantId: "grant-1", reason: "Решение редакции" }, now)

    expect(planCacheWrite(ctx)).toEqual({ role: "author", planTier: "pro", planUntil: LATER })
  })

  it("служебной роли план роль не меняет (role-derivation.md п. 6)", async () => {
    const ctx = context({
      recipientRole: "editor",
      userGrants: [{ tier: "pro", startsAt: PAST, endsAt: SOON, revokedAt: null }]
    })

    await grantPlan(
      ctx,
      {
        userHandle: "ivan",
        tier: "pro",
        startsAt: "2026-09-19T00:00:00.000Z",
        endsAt: "2026-10-19T00:00:00.000Z",
        reason: "Редакционная выдача"
      },
      now
    )

    expect(planCacheWrite(ctx)).toEqual({ planTier: "pro", planUntil: SOON })
  })
})

// Базовая выдача первого запуска в раздел грантов не попадает и вручную не отзывается: закрытие
// доступа — только согласованное архивирование аккаунта (журнал §27.1).
describe("базовые выдачи вне раздела грантов", () => {
  it("список запрашивает только ручные выдачи (AC-4)", async () => {
    const ctx = context({ rows: [grant()] })

    await listAdminGrants(ctx, now)

    expect(ctx.prisma.planGrant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { NOT: { endsAt: null, grantedById: null } } })
    )
  })

  it("карточка базовой выдачи по прямому идентификатору не открывается (AC-4)", async () => {
    const ctx = context({ existing: baseGrant() })

    await expect(getAdminGrant(ctx, "grant-base", now)).resolves.toBeNull()
  })

  it("отзыв базовой выдачи — FORBIDDEN, выдача остаётся действующей (AC-4)", async () => {
    const ctx = context({ existing: baseGrant() })

    await expect(revokePlan(ctx, { grantId: "grant-base", reason: "Отзыв" }, now)).rejects.toMatchObject<
      Partial<GraphQLError>
    >({ extensions: { code: "FORBIDDEN", action: "plan.revoke" } })

    expect(ctx.prisma.planGrant.update).not.toHaveBeenCalled()
    expect(ctx.prisma.auditLog.create).not.toHaveBeenCalled()
    expect(ctx.prisma.user.update).not.toHaveBeenCalled()
  })
})
