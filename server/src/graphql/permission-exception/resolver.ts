import {
  ensureRole,
  PERMISSION_CODES,
  type PermissionCode,
  type PermissionExceptionKind
} from "../../exceptions/permissions"
import { createApiError } from "../../errors/graphql-error"
import type { GraphQLContext } from "../../prisma"
import {
  grantPermissionException,
  revokePermissionException,
  type PermissionExceptionClient
} from "../../permission-exceptions/service"

function parseEndsAt(value: string | null | undefined, requestId: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "endsAt", rule: "iso-date" })
  }
  return parsed
}

export default {
  Query: {
    permissionExceptions: async (_parent: unknown, args: { userId?: string }, ctx: GraphQLContext) => {
      ensureRole(ctx.currentUser, "admin", "permission.exception.read", ctx.requestId)
      return ctx.prisma.permissionException.findMany({
        where: args.userId ? { userId: args.userId } : undefined,
        orderBy: { createdAt: "desc" }
      })
    }
  },
  Mutation: {
    grantException: async (
      _parent: unknown,
      args: {
        input: {
          userId: string
          permission: string
          kind: PermissionExceptionKind
          endsAt?: string | null
          reason: string
        }
      },
      ctx: GraphQLContext
    ) => {
      ensureRole(ctx.currentUser, "owner", "permission.exception.grant", ctx.requestId)
      if (!PERMISSION_CODES.includes(args.input.permission as PermissionCode)) {
        throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "permission", rule: "known" })
      }
      return grantPermissionException(ctx.prisma as unknown as PermissionExceptionClient, {
        actor: ctx.currentUser!,
        userId: args.input.userId,
        permission: args.input.permission as PermissionCode,
        kind: args.input.kind,
        reason: args.input.reason,
        endsAt: parseEndsAt(args.input.endsAt, ctx.requestId),
        requestId: ctx.requestId,
        now: new Date()
      })
    },
    revokeException: async (_parent: unknown, args: { id: string; reason: string }, ctx: GraphQLContext) => {
      ensureRole(ctx.currentUser, "owner", "permission.exception.revoke", ctx.requestId)
      return revokePermissionException(ctx.prisma as unknown as PermissionExceptionClient, {
        actor: ctx.currentUser!,
        id: args.id,
        reason: args.reason,
        requestId: ctx.requestId,
        now: new Date()
      })
    }
  }
}
