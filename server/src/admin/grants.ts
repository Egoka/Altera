import type { PlanTier, Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, ensurePermission } from "../exceptions/permissions"
import type { GraphQLContext } from "../prisma"

export type AdminGrantStatus = "queued" | "active" | "ended" | "revoked"

interface GrantPerson {
  id: string
  name: string
  handle: string
}

interface GrantRecord {
  id: string
  userId: string
  tier: PlanTier
  startsAt: Date
  endsAt: Date | null
  grantedById: string | null
  reason: string
  revokedAt: Date | null
  createdAt: Date
  user: GrantPerson
  grantedBy: GrantPerson | null
}

export interface AdminGrant extends GrantRecord {
  status: AdminGrantStatus
}

export interface GrantPlanInput {
  userHandle: string
  tier: PlanTier
  startsAt: string
  endsAt: string | null
  reason: string
}

export interface RevokePlanInput {
  grantId: string
  reason: string
}

const grantInclude = {
  user: { select: { id: true, name: true, handle: true } },
  grantedBy: { select: { id: true, name: true, handle: true } }
} as const

export function deriveGrantStatus(grant: Pick<GrantRecord, "startsAt" | "endsAt" | "revokedAt">, now: Date) {
  if (grant.revokedAt) return "revoked" as const
  if (grant.startsAt > now) return "queued" as const
  if (grant.endsAt && grant.endsAt <= now) return "ended" as const
  return "active" as const
}

function toAdminGrant(grant: GrantRecord, now: Date): AdminGrant {
  return { ...grant, status: deriveGrantStatus(grant, now) }
}

function requiredText(value: string, field: string, requestId: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw createApiError("VALIDATION_ERROR", { requestId, field, rule: "required" })
  }
  return normalized
}

function requiredDate(value: string, field: string, requestId: string): Date {
  const parsed = new Date(value)
  if (!value || Number.isNaN(parsed.getTime())) {
    throw createApiError("VALIDATION_ERROR", { requestId, field, rule: "iso-date" })
  }
  return parsed
}

function ensureFinance(ctx: GraphQLContext, action: string) {
  ensurePermission(ctx.currentUser, "finance", action, ctx.requestId)
  return ensureAuthenticated(ctx.currentUser, ctx.requestId)
}

export async function listAdminGrants(ctx: GraphQLContext, now = new Date()): Promise<AdminGrant[]> {
  ensureFinance(ctx, "plan.read")
  const grants = await ctx.prisma.planGrant.findMany({ include: grantInclude, orderBy: { createdAt: "desc" } })
  return grants.map((grant) => toAdminGrant(grant, now))
}

export async function getAdminGrant(ctx: GraphQLContext, id: string, now = new Date()): Promise<AdminGrant | null> {
  ensureFinance(ctx, "plan.read")
  const grant = await ctx.prisma.planGrant.findUnique({ where: { id }, include: grantInclude })
  return grant ? toAdminGrant(grant, now) : null
}

export async function grantPlan(ctx: GraphQLContext, input: GrantPlanInput, now = new Date()): Promise<AdminGrant> {
  const actor = ensureFinance(ctx, "plan.grant")
  const userHandle = requiredText(input.userHandle, "userHandle", ctx.requestId)
  const reason = requiredText(input.reason, "reason", ctx.requestId)
  const startsAt = requiredDate(input.startsAt, "startsAt", ctx.requestId)
  if (!input.endsAt) {
    throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "endsAt", rule: "required" })
  }
  const endsAt = requiredDate(input.endsAt, "endsAt", ctx.requestId)
  if (endsAt <= startsAt) {
    throw createApiError("VALIDATION_ERROR", {
      requestId: ctx.requestId,
      field: "endsAt",
      rule: "after-startsAt"
    })
  }
  if (input.tier !== "standard" && input.tier !== "pro") {
    throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "tier", rule: "enum" })
  }

  const recipient = await ctx.prisma.user.findUnique({
    where: { handle: userHandle },
    select: { id: true, archivedAt: true, isServiceAccount: true }
  })
  if (!recipient) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "user" })
  if (recipient.archivedAt) throw createApiError("ARCHIVED", { requestId: ctx.requestId, entity: "user" })
  if (recipient.isServiceAccount) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "plan.grant" })
  }

  return ctx.prisma.$transaction(async (tx) => {
    const created = await tx.planGrant.create({
      data: {
        userId: recipient.id,
        tier: input.tier,
        startsAt,
        endsAt,
        grantedById: actor.id,
        reason
      },
      include: grantInclude
    })
    await tx.auditLog.create({
      data: {
        action: "plan.grant",
        actorId: actor.id,
        actorRole: actor.role as Role,
        entityType: "planGrant",
        entityId: created.id,
        diff: { tier: input.tier, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason },
        requestId: ctx.requestId
      }
    })
    return toAdminGrant(created, now)
  })
}

export async function revokePlan(ctx: GraphQLContext, input: RevokePlanInput, now = new Date()): Promise<AdminGrant> {
  const actor = ensureFinance(ctx, "plan.revoke")
  const grantId = requiredText(input.grantId, "grantId", ctx.requestId)
  const reason = requiredText(input.reason, "reason", ctx.requestId)

  return ctx.prisma.$transaction(async (tx) => {
    const current = await tx.planGrant.findUnique({ where: { id: grantId }, include: grantInclude })
    if (!current) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "planGrant" })
    const status = deriveGrantStatus(current, now)
    if (status !== "active" && status !== "queued") {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "planGrant",
        expected: "active-or-queued",
        actual: status
      })
    }

    const revoked = await tx.planGrant.update({
      where: { id: grantId },
      data: { revokedAt: now },
      include: grantInclude
    })
    await tx.auditLog.create({
      data: {
        action: "plan.revoke",
        actorId: actor.id,
        actorRole: actor.role as Role,
        entityType: "planGrant",
        entityId: grantId,
        diff: { revokedAt: now.toISOString(), reason },
        requestId: ctx.requestId
      }
    })
    return toAdminGrant(revoked, now)
  })
}
