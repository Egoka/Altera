import type { PlanTier, Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import type { AppLogger } from "../observability/logger"

export const PERMISSION_CODES = [
  "admin.enter",
  "publish",
  "review",
  "moderate",
  "editorial",
  "taxonomy",
  "finance",
  "accounts",
  "ai.read",
  "job.retry",
  "job.cancel",
  "user",
  "owner"
] as const

export type PermissionCode = (typeof PERMISSION_CODES)[number]
export type PermissionExceptionKind = "grant" | "deny"

export interface PermissionUser {
  id: string
  role: Role
  archivedAt: Date | null
  planTier: PlanTier
  planUntil: Date | null
  permissionExceptions?: readonly PermissionException[]
}

export interface PermissionException {
  userId: string
  role: Role
  permission: string
  kind: PermissionExceptionKind
  startsAt: Date
  endsAt: Date | null
  revokedAt: Date | null
}

interface PermissionOptions {
  exceptions?: readonly PermissionException[]
  now?: Date
}

interface ActiveAuthorOptions {
  logger?: AppLogger
  now?: Date
}

export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<PermissionCode, readonly Role[]>> = {
  "admin.enter": ["editor", "moderator", "analyst", "admin", "owner"],
  publish: ["editor", "moderator", "owner"],
  review: ["moderator", "owner"],
  moderate: ["moderator", "admin", "owner"],
  editorial: ["editor", "owner"],
  taxonomy: ["admin", "owner"],
  finance: ["analyst", "admin", "owner"],
  accounts: ["admin", "owner"],
  "ai.read": ["moderator", "analyst", "admin", "owner"],
  "job.retry": ["owner"],
  "job.cancel": ["owner"],
  user: ["reader", "author"],
  owner: ["owner"]
}

const exceptionRoles = new Set<Role>(["editor", "moderator", "analyst", "admin"])

export function ensureAuthenticated<T extends PermissionUser>(currentUser: T | null, requestId: string): T {
  if (!currentUser) {
    throw createApiError("UNAUTHENTICATED", { requestId })
  }
  return currentUser
}

function ensureAccountActive(user: PermissionUser, action: string, requestId: string): void {
  if (user.archivedAt) {
    throw createApiError("FORBIDDEN", { requestId, action })
  }
}

export function ensureRole(
  currentUser: PermissionUser | null,
  requiredRole: Role,
  action: string,
  requestId: string
): void {
  const user = ensureAuthenticated(currentUser, requestId)
  ensureAccountActive(user, action, requestId)

  if (user.role !== requiredRole && user.role !== "owner") {
    throw createApiError("FORBIDDEN", { requestId, action })
  }
}

function isActiveException(
  exception: PermissionException,
  user: PermissionUser,
  permission: PermissionCode,
  now: Date
): boolean {
  return (
    exceptionRoles.has(user.role) &&
    exception.userId === user.id &&
    exception.role === user.role &&
    exception.permission === permission &&
    exception.revokedAt === null &&
    exception.startsAt <= now &&
    (exception.endsAt === null || exception.endsAt > now)
  )
}

export function ensurePermission(
  currentUser: PermissionUser | null,
  permission: PermissionCode,
  action: string,
  requestId: string,
  options: PermissionOptions = {}
): void {
  const user = ensureAuthenticated(currentUser, requestId)
  ensureAccountActive(user, action, requestId)

  const hasDefaultPermission = DEFAULT_ROLE_PERMISSIONS[permission].includes(user.role)
  if (permission === "owner" || !exceptionRoles.has(user.role)) {
    if (!hasDefaultPermission) {
      throw createApiError("FORBIDDEN", { requestId, action })
    }
    return
  }

  const now = options.now ?? new Date()
  const exceptions = (options.exceptions ?? user.permissionExceptions ?? []).filter((exception) =>
    isActiveException(exception, user, permission, now)
  )
  const hasGrant = exceptions.some(({ kind }) => kind === "grant")
  const hasDeny = exceptions.some(({ kind }) => kind === "deny")

  if (!hasGrant && (!hasDefaultPermission || hasDeny)) {
    throw createApiError("FORBIDDEN", { requestId, action })
  }
}

export function ensureActiveAuthor(
  currentUser: PermissionUser | null,
  action: string,
  requestId: string,
  options: ActiveAuthorOptions = {}
): void {
  const user = ensureAuthenticated(currentUser, requestId)
  ensureAccountActive(user, action, requestId)

  if (user.role !== "author" && user.role !== "reader") {
    throw createApiError("FORBIDDEN", { requestId, action })
  }

  const now = options.now ?? new Date()
  const hasActivePlan = user.planTier !== "free" && user.planUntil !== null && user.planUntil > now
  if (hasActivePlan) return

  options.logger?.log({
    level: "warn",
    event: "plan.action.rejected",
    message: "Author action rejected because the plan is inactive",
    requestId,
    data: { action, role: user.role, requiredTier: "standard" }
  })
  throw createApiError("PLAN_LIMIT", {
    requestId,
    requiredTier: "standard",
    limit: 1,
    current: 0
  })
}
