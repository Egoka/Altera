import { PERMISSION_CODES, type PermissionCode, type PermissionExceptionKind } from "../exceptions/permissions"
import { createApiError } from "../errors/graphql-error"
import type { Role } from "../generated/prisma"

interface PermissionActor {
  id: string
  role: Role
}

export interface StoredPermissionException {
  id: string
  userId: string
  role: Role
  permission: PermissionCode
  kind: PermissionExceptionKind
  grantedById: string
  reason: string
  startsAt: Date
  endsAt: Date | null
  revokedAt: Date | null
  revokedById: string | null
  expiredAt: Date | null
}

interface PermissionExceptionTransaction {
  user: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; role: Role; isServiceAccount: boolean } | null>
  }
  permissionException: {
    create(args: { data: Omit<StoredPermissionException, "id"> }): Promise<StoredPermissionException>
    findUnique(args: { where: { id: string } }): Promise<StoredPermissionException | null>
    findMany(args: {
      where: { expiredAt: null; revokedAt: null; endsAt: { lte: Date } }
    }): Promise<StoredPermissionException[]>
    updateMany(args: {
      where: { id: string; expiredAt?: null; revokedAt?: null }
      data: Partial<StoredPermissionException>
    }): Promise<{ count: number }>
  }
  auditLog: { create(args: { data: Record<string, unknown> }): Promise<unknown> }
}

export interface PermissionExceptionClient extends PermissionExceptionTransaction {
  $transaction<T>(run: (tx: PermissionExceptionTransaction) => Promise<T>): Promise<T>
}

interface GrantPermissionExceptionInput {
  actor: PermissionActor
  userId: string
  permission: PermissionCode
  kind: PermissionExceptionKind
  reason: string
  endsAt: Date | null
  requestId: string
  now: Date
}

interface RevokePermissionExceptionInput {
  actor: PermissionActor
  id: string
  reason: string
  requestId: string
  now: Date
}

const exceptionRoles = new Set<Role>(["editor", "moderator", "analyst", "admin"])

function ensureOwner(actor: PermissionActor, action: string, requestId: string): void {
  if (actor.role !== "owner") throw createApiError("FORBIDDEN", { requestId, action })
}

function ensureReason(reason: string, requestId: string): string {
  const normalized = reason.trim()
  if (!normalized) throw createApiError("VALIDATION_ERROR", { requestId, field: "reason", rule: "non-empty" })
  return normalized
}

export async function grantPermissionException(
  client: PermissionExceptionClient,
  input: GrantPermissionExceptionInput
): Promise<StoredPermissionException> {
  ensureOwner(input.actor, "permission.exception.grant", input.requestId)
  const reason = ensureReason(input.reason, input.requestId)
  if (!PERMISSION_CODES.includes(input.permission) || input.permission === "owner") {
    throw createApiError("VALIDATION_ERROR", { requestId: input.requestId, field: "permission", rule: "grantable" })
  }
  if (input.endsAt !== null && input.endsAt <= input.now) {
    throw createApiError("VALIDATION_ERROR", { requestId: input.requestId, field: "endsAt", rule: "future" })
  }

  return client.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.userId } })
    if (!target) throw createApiError("NOT_FOUND", { requestId: input.requestId, entity: "user" })
    if (!target.isServiceAccount || !exceptionRoles.has(target.role)) {
      throw createApiError("VALIDATION_ERROR", { requestId: input.requestId, field: "userId", rule: "service-role" })
    }
    const exception = await tx.permissionException.create({
      data: {
        userId: target.id,
        role: target.role,
        permission: input.permission,
        kind: input.kind,
        grantedById: input.actor.id,
        reason,
        startsAt: input.now,
        endsAt: input.endsAt,
        revokedAt: null,
        revokedById: null,
        expiredAt: null
      }
    })
    await tx.auditLog.create({
      data: {
        action: "permission.exception.grant",
        actorId: input.actor.id,
        actorRole: input.actor.role,
        entityType: "permission_exception",
        entityId: exception.id,
        diff: {
          userId: target.id,
          role: target.role,
          permission: input.permission,
          kind: input.kind,
          reason,
          endsAt: input.endsAt?.toISOString() ?? null
        },
        requestId: input.requestId
      }
    })
    return exception
  })
}

export async function revokePermissionException(
  client: PermissionExceptionClient,
  input: RevokePermissionExceptionInput
): Promise<StoredPermissionException> {
  ensureOwner(input.actor, "permission.exception.revoke", input.requestId)
  const reason = ensureReason(input.reason, input.requestId)
  return client.$transaction(async (tx) => {
    const existing = await tx.permissionException.findUnique({ where: { id: input.id } })
    if (!existing) throw createApiError("NOT_FOUND", { requestId: input.requestId, entity: "permission_exception" })
    const updated = await tx.permissionException.updateMany({
      where: { id: input.id, revokedAt: null },
      data: { revokedAt: input.now, revokedById: input.actor.id }
    })
    if (updated.count !== 1) {
      throw createApiError("CONFLICT", {
        requestId: input.requestId,
        entity: "permission_exception",
        expected: "active",
        actual: "revoked"
      })
    }
    await tx.auditLog.create({
      data: {
        action: "permission.exception.revoke",
        actorId: input.actor.id,
        actorRole: input.actor.role,
        entityType: "permission_exception",
        entityId: input.id,
        diff: { permission: existing.permission, reason },
        requestId: input.requestId
      }
    })
    return (await tx.permissionException.findUnique({ where: { id: input.id } }))!
  })
}

export async function expirePermissionExceptions(
  client: PermissionExceptionClient,
  input: { now: Date; requestId: string }
): Promise<number> {
  const candidates = await client.permissionException.findMany({
    where: { expiredAt: null, revokedAt: null, endsAt: { lte: input.now } }
  })
  let expired = 0
  for (const candidate of candidates) {
    expired += await client.$transaction(async (tx) => {
      const updated = await tx.permissionException.updateMany({
        where: { id: candidate.id, expiredAt: null, revokedAt: null },
        data: { expiredAt: input.now }
      })
      if (updated.count !== 1) return 0
      await tx.auditLog.create({
        data: {
          action: "permission.exception.expire",
          actorId: null,
          actorRole: null,
          entityType: "permission_exception",
          entityId: candidate.id,
          diff: {
            userId: candidate.userId,
            permission: candidate.permission,
            endsAt: candidate.endsAt?.toISOString() ?? null
          },
          requestId: input.requestId
        }
      })
      return 1
    })
  }
  return expired
}
