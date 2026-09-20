import type { Prisma, Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, ensurePermission, ensureRole } from "../exceptions/permissions"
import { createUserWithReservedHandle, isPrismaUniqueConstraint } from "../auth/handle"
import { issueMagicLink } from "../auth/magic-link"
import type { GraphQLContext } from "../prisma"

/**
 * Служебные записи: создание, роли, владельцы и архив (`docs/spec/40-admin/admins.md`,
 * `docs/spec/10-flows/appoint-admin.md`, `docs/spec/50-access/escalation-and-demotion.md`).
 */

/** Роли, которые выдаются служебной записи напрямую; `owner` — только вторым шагом (журнал §26.7). */
export const ASSIGNABLE_STAFF_ROLES = ["editor", "moderator", "analyst", "admin"] as const
export type AssignableStaffRole = (typeof ASSIGNABLE_STAFF_ROLES)[number]

export type StaffStatus = "active" | "archived"
export type StaffExceptionTerm = "indefinite" | "expiring"

/** `[ДОПУЩЕНИЕ]` «Истекающие» исключения — с окончанием в ближайшие 30 дней (`admins.md` п. 4). */
export const EXPIRING_EXCEPTION_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
const MIN_SEARCH_LENGTH = 3
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface StaffExceptionRecord {
  id: string
  userId: string
  role: Role
  permission: string
  kind: "grant" | "deny"
  grantedById: string
  reason: string
  startsAt: Date
  endsAt: Date | null
  revokedAt: Date | null
  revokedById: string | null
  expiredAt: Date | null
}

interface StaffRecord {
  id: string
  name: string
  email: string
  role: Role
  isServiceAccount: boolean
  createdAt: Date
  archivedAt: Date | null
  archiveReason: string | null
  permissionExceptions: StaffExceptionRecord[]
  sessions: Array<{ lastUsedAt: Date }>
}

export interface StaffRoleChange {
  id: string
  action: string
  before: Role | null
  after: Role | null
  actorId: string | null
  actorName: string | null
  reason: string | null
  createdAt: Date
}

export interface AdminStaffMember {
  id: string
  name: string
  /** Маскированный адрес в списке, полный — в карточке (§28.7). */
  email: string
  emailMasked: boolean
  role: Role
  status: StaffStatus
  createdAt: Date
  createdByName: string | null
  lastActiveAt: Date | null
  activeExceptionCount: number
  archivedAt: Date | null
  archiveReason: string | null
  roleHistory: StaffRoleChange[]
  exceptions: StaffExceptionRecord[]
  sessionCount: number
}

export interface AdminOwner {
  id: string
  name: string
  email: string
  status: StaffStatus
  assignedAt: Date | null
}

export interface AdminStaffFilters {
  role?: Role | null
  status?: StaffStatus | null
  hasExceptions?: boolean | null
  term?: StaffExceptionTerm | null
  search?: string | null
}

export interface CreateStaffInput {
  email: string
  role: Role
  name: string
}

const staffInclude = {
  permissionExceptions: true,
  sessions: { select: { lastUsedAt: true }, orderBy: { lastUsedAt: "desc" }, take: 1 }
} as const

const ROLE_HISTORY_ACTIONS = ["user.role.change", "role.assign.owner", "role.revoke.owner"]

/** `a***e@example.com`: домен виден, локальная часть скрыта (§28.7). */
export function maskEmail(email: string): string {
  const separator = email.lastIndexOf("@")
  if (separator <= 0) return "***"
  const local = email.slice(0, separator)
  const domain = email.slice(separator)
  if (local.length <= 2) return `${local.slice(0, 1)}***${domain}`
  return `${local.slice(0, 1)}***${local.slice(-1)}${domain}`
}

export function isActiveStaffException(exception: StaffExceptionRecord, role: Role, now: Date): boolean {
  return (
    exception.role === role &&
    exception.revokedAt === null &&
    exception.expiredAt === null &&
    exception.startsAt <= now &&
    (exception.endsAt === null || exception.endsAt > now)
  )
}

function requiredText(value: string, field: string, requestId: string): string {
  const normalized = value.trim()
  if (!normalized) throw createApiError("VALIDATION_ERROR", { requestId, field, rule: "required" })
  return normalized
}

function ensureAssignableRole(role: Role, requestId: string, action: string): AssignableStaffRole {
  if (role === "owner") throw createApiError("FORBIDDEN", { requestId, action })
  if (!(ASSIGNABLE_STAFF_ROLES as readonly Role[]).includes(role)) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "role", rule: "staff-role" })
  }
  return role as AssignableStaffRole
}

/** Чтение и создание записей — `admin` и `owner` (`accounts`); изменения ролей — только `owner`. */
function ensureAccounts(ctx: GraphQLContext, action: string) {
  ensurePermission(ctx.currentUser, "accounts", action, ctx.requestId)
  return ensureAuthenticated(ctx.currentUser, ctx.requestId)
}

function ensureOwnerActor(ctx: GraphQLContext, action: string) {
  ensureRole(ctx.currentUser, "owner", action, ctx.requestId)
  return ensureAuthenticated(ctx.currentUser, ctx.requestId)
}

function toStatus(record: Pick<StaffRecord, "archivedAt">): StaffStatus {
  return record.archivedAt ? "archived" : "active"
}

function presentMember(
  record: StaffRecord,
  options: {
    now: Date
    revealEmail: boolean
    createdByName?: string | null
    roleHistory?: StaffRoleChange[]
    sessionCount?: number
  }
): AdminStaffMember {
  const active = record.permissionExceptions.filter((exception) =>
    isActiveStaffException(exception, record.role, options.now)
  )
  return {
    id: record.id,
    name: record.name,
    email: options.revealEmail ? record.email : maskEmail(record.email),
    emailMasked: !options.revealEmail,
    role: record.role,
    status: toStatus(record),
    createdAt: record.createdAt,
    createdByName: options.createdByName ?? null,
    lastActiveAt: record.sessions[0]?.lastUsedAt ?? null,
    activeExceptionCount: active.length,
    archivedAt: record.archivedAt,
    archiveReason: record.archiveReason,
    roleHistory: options.roleHistory ?? [],
    exceptions: options.revealEmail ? record.permissionExceptions : [],
    sessionCount: options.sessionCount ?? 0
  }
}

function matchesFilters(member: AdminStaffMember, record: StaffRecord, filters: AdminStaffFilters, now: Date) {
  if (filters.hasExceptions && member.activeExceptionCount === 0) return false
  if (filters.term) {
    const active = record.permissionExceptions.filter((exception) =>
      isActiveStaffException(exception, record.role, now)
    )
    const horizon = new Date(now.getTime() + EXPIRING_EXCEPTION_DAYS * DAY_MS)
    const matches =
      filters.term === "indefinite"
        ? active.some(({ endsAt }) => endsAt === null)
        : active.some(({ endsAt }) => endsAt !== null && endsAt <= horizon)
    if (!matches) return false
  }
  return true
}

async function readCreators(ctx: GraphQLContext, staffIds: string[]): Promise<Map<string, string>> {
  if (staffIds.length === 0) return new Map()
  const records = await ctx.prisma.auditLog.findMany({
    where: { action: "user.create.staff", entityType: "user", entityId: { in: staffIds } },
    orderBy: { createdAt: "asc" },
    select: { entityId: true, actorId: true }
  })
  const actorIds = [...new Set(records.map(({ actorId }) => actorId).filter((id): id is string => Boolean(id)))]
  const actors = await ctx.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
  const names = new Map(actors.map(({ id, name }) => [id, name]))
  const creators = new Map<string, string>()
  for (const record of records) {
    const name = record.actorId ? names.get(record.actorId) : undefined
    if (name && !creators.has(record.entityId)) creators.set(record.entityId, name)
  }
  return creators
}

function readRoleFromDiff(diff: unknown, key: "before" | "after"): Role | null {
  if (typeof diff !== "object" || diff === null) return null
  const value = Reflect.get(diff, key)
  return typeof value === "string" ? (value as Role) : null
}

function readReasonFromDiff(diff: unknown): string | null {
  if (typeof diff !== "object" || diff === null) return null
  const value = Reflect.get(diff, "reason")
  return typeof value === "string" ? value : null
}

async function readRoleHistory(ctx: GraphQLContext, staffId: string): Promise<StaffRoleChange[]> {
  const records = await ctx.prisma.auditLog.findMany({
    where: { action: { in: ROLE_HISTORY_ACTIONS }, entityType: "user", entityId: staffId },
    orderBy: { createdAt: "desc" },
    select: { id: true, action: true, actorId: true, diff: true, createdAt: true }
  })
  const actorIds = [...new Set(records.map(({ actorId }) => actorId).filter((id): id is string => Boolean(id)))]
  const actors = await ctx.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
  const names = new Map(actors.map(({ id, name }) => [id, name]))
  return records.map((record) => ({
    id: record.id,
    action: record.action,
    before: readRoleFromDiff(record.diff, "before"),
    after: readRoleFromDiff(record.diff, "after"),
    actorId: record.actorId,
    actorName: record.actorId ? (names.get(record.actorId) ?? null) : null,
    reason: readReasonFromDiff(record.diff),
    createdAt: record.createdAt
  }))
}

export async function listAdminStaff(
  ctx: GraphQLContext,
  filters: AdminStaffFilters = {},
  now = new Date()
): Promise<AdminStaffMember[]> {
  ensureAccounts(ctx, "staff.read")
  const status = filters.status ?? "active"
  const search = filters.search?.trim() ?? ""
  const where: Prisma.UserWhereInput = {
    isServiceAccount: true,
    archivedAt: status === "archived" ? { not: null } : null,
    ...(filters.role ? { role: filters.role } : {}),
    ...(search.length >= MIN_SEARCH_LENGTH
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } }
          ]
        }
      : {})
  }

  const records = (await ctx.prisma.user.findMany({
    where,
    include: staffInclude,
    orderBy: [{ role: "asc" }, { name: "asc" }]
  })) as unknown as StaffRecord[]

  const creators = await readCreators(
    ctx,
    records.map(({ id }) => id)
  )

  return records
    .map((record) => presentMember(record, { now, revealEmail: false, createdByName: creators.get(record.id) ?? null }))
    .filter((member, index) => matchesFilters(member, records[index]!, filters, now))
}

export async function getAdminStaffMember(
  ctx: GraphQLContext,
  id: string,
  now = new Date()
): Promise<AdminStaffMember | null> {
  const actor = ensureAccounts(ctx, "staff.read")
  const record = (await ctx.prisma.user.findUnique({
    where: { id },
    include: staffInclude
  })) as unknown as StaffRecord | null
  if (!record || !record.isServiceAccount) return null

  // Открытие карточки показывает полный адрес — это чтение персональных данных (§28.7).
  await ctx.prisma.auditLog.create({
    data: {
      action: "admin.read.personal",
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "user",
      entityId: record.id,
      context: "admin.staff.card",
      purpose: "staff-administration",
      requestId: ctx.requestId
    }
  })

  const [creators, roleHistory, sessionCount] = await Promise.all([
    readCreators(ctx, [record.id]),
    readRoleHistory(ctx, record.id),
    ctx.prisma.session.count({ where: { userId: record.id, revokedAt: null } })
  ])

  return presentMember(record, {
    now,
    revealEmail: true,
    createdByName: creators.get(record.id) ?? null,
    roleHistory,
    sessionCount
  })
}

export async function listOwners(ctx: GraphQLContext): Promise<AdminOwner[]> {
  ensureOwnerActor(ctx, "owner.read")
  const owners = await ctx.prisma.user.findMany({
    where: { role: "owner" },
    select: { id: true, name: true, email: true, archivedAt: true },
    orderBy: { name: "asc" }
  })
  const assignments = await ctx.prisma.auditLog.findMany({
    where: { action: "role.assign.owner", entityType: "user", entityId: { in: owners.map(({ id }) => id) } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, createdAt: true }
  })
  const assignedAt = new Map<string, Date>()
  for (const assignment of assignments) {
    if (!assignedAt.has(assignment.entityId)) assignedAt.set(assignment.entityId, assignment.createdAt)
  }
  return owners.map((owner) => ({
    id: owner.id,
    name: owner.name,
    email: owner.email,
    status: toStatus(owner),
    assignedAt: assignedAt.get(owner.id) ?? null
  }))
}

/** Действующие владельцы: роль `owner` и открытый доступ (журнал #10). */
function countActiveOwners(tx: Prisma.TransactionClient): Promise<number> {
  return tx.user.count({ where: { role: "owner", archivedAt: null } })
}

async function reloadMember(
  ctx: GraphQLContext,
  tx: Prisma.TransactionClient,
  id: string,
  now: Date
): Promise<AdminStaffMember> {
  const record = (await tx.user.findUnique({ where: { id }, include: staffInclude })) as unknown as StaffRecord | null
  if (!record) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "user" })
  return presentMember(record, { now, revealEmail: true })
}

export async function createStaff(
  ctx: GraphQLContext,
  input: CreateStaffInput,
  now = new Date()
): Promise<AdminStaffMember> {
  const actor = ensureAccounts(ctx, "staff.create")
  const email = requiredText(input.email, "email", ctx.requestId).toLowerCase()
  const name = requiredText(input.name, "name", ctx.requestId)
  // Владельца нельзя создать записью: он назначается вторым шагом существующей записи (§26.7).
  const role = ensureAssignableRole(input.role, ctx.requestId, "staff.create.owner")
  if (!EMAIL_PATTERN.test(email)) {
    throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "email", rule: "email" })
  }

  const existing = await ctx.prisma.user.findUnique({
    where: { email },
    select: { id: true, isServiceAccount: true }
  })
  if (existing) {
    // Читатель или автор в служебную роль не повышается ни при каких условиях (журнал #46–47).
    if (!existing.isServiceAccount) {
      throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "email", rule: "not-an-account" })
    }
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "user",
      expected: "free",
      actual: "taken"
    })
  }

  let created
  try {
    created = await createUserWithReservedHandle(ctx.prisma, { email, name, locale: "ru" })
  } catch (error: unknown) {
    if (!isPrismaUniqueConstraint(error, "email")) throw error
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "user",
      expected: "free",
      actual: "taken"
    })
  }

  const staff = (await ctx.prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: created.id },
      data: { role, isServiceAccount: true },
      include: staffInclude
    })
    await tx.auditLog.create({
      data: {
        action: "user.create.staff",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: created.id,
        diff: { role, emailHash: ctx.piiHasher.email(email) },
        requestId: ctx.requestId
      }
    })
    return updated
  })) as unknown as StaffRecord

  // Письмо ставится после создания: недоступная почта не отменяет запись — ссылку
  // сотрудник запрашивает заново с `/login` (`appoint-admin.md` §5).
  await issueMagicLink(ctx.prisma, ctx.mail, { email, locale: "ru", requestId: ctx.requestId, now })

  return presentMember(staff, { now, revealEmail: true, createdByName: actor.name ?? null })
}

interface StaffTarget {
  id: string
  role: Role
  isServiceAccount: boolean
  archivedAt: Date | null
}

async function loadTarget(
  ctx: GraphQLContext,
  tx: Prisma.TransactionClient,
  id: string,
  action: string
): Promise<StaffTarget> {
  const target = await tx.user.findUnique({
    where: { id },
    select: { id: true, role: true, isServiceAccount: true, archivedAt: true }
  })
  if (!target) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "user" })
  // Служебный путь и пользовательский не смешиваются (журнал #46–47).
  if (!target.isServiceAccount) {
    throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "id", rule: "service-account" })
  }
  if (target.id === ctx.currentUser?.id) {
    // Никто не снимает и не меняет роль себе (`escalation-and-demotion.md` п. 5).
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action })
  }
  return target
}

async function replaceRole(
  ctx: GraphQLContext,
  tx: Prisma.TransactionClient,
  target: StaffTarget,
  nextRole: Role
): Promise<void> {
  const changed = await tx.user.updateMany({ where: { id: target.id, role: target.role }, data: { role: nextRole } })
  if (changed.count !== 1) {
    // Роль уже изменена другим владельцем (`admins.md` §9).
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "user",
      expected: target.role,
      actual: "changed"
    })
  }
}

export async function changeStaffRole(
  ctx: GraphQLContext,
  input: { id: string; role: Role; reason: string },
  now = new Date()
): Promise<AdminStaffMember> {
  const actor = ensureOwnerActor(ctx, "staff.role.change")
  const reason = requiredText(input.reason, "reason", ctx.requestId)
  const nextRole = ensureAssignableRole(input.role, ctx.requestId, "staff.role.change.owner")

  return ctx.prisma.$transaction(async (tx) => {
    const target = await loadTarget(ctx, tx, input.id, "staff.role.change")
    // Роль владельца снимается отдельным действием (`admins.md` §5, матрица #106).
    if (target.role === "owner") {
      throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "staff.role.change.owner" })
    }
    if (target.role === nextRole) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "user",
        expected: "other-role",
        actual: nextRole
      })
    }
    await replaceRole(ctx, tx, target, nextRole)
    await tx.auditLog.create({
      data: {
        action: "user.role.change",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: target.id,
        diff: { targetId: target.id, before: target.role, after: nextRole, reason },
        requestId: ctx.requestId
      }
    })
    return reloadMember(ctx, tx, target.id, now)
  })
}

export async function revokeStaffRole(
  ctx: GraphQLContext,
  input: { id: string; reason: string },
  now = new Date()
): Promise<AdminStaffMember> {
  const actor = ensureOwnerActor(ctx, "staff.role.revoke")
  const reason = requiredText(input.reason, "reason", ctx.requestId)

  return ctx.prisma.$transaction(async (tx) => {
    const target = await loadTarget(ctx, tx, input.id, "staff.role.revoke")
    if (target.role === "owner") {
      throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "staff.role.revoke.owner" })
    }
    if (target.role === "reader") {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "user",
        expected: "staff-role",
        actual: "reader"
      })
    }
    // `[ДОПУЩЕНИЕ, временное]` Снятая запись остаётся служебной без прав
    // (`escalation-and-demotion.md` п. 6; Q-08 не закрыт).
    await replaceRole(ctx, tx, target, "reader")
    await tx.auditLog.create({
      data: {
        action: "user.role.change",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: target.id,
        diff: { targetId: target.id, before: target.role, after: "reader", reason },
        requestId: ctx.requestId
      }
    })
    return reloadMember(ctx, tx, target.id, now)
  })
}

export async function assignOwner(
  ctx: GraphQLContext,
  input: { id: string },
  now = new Date()
): Promise<AdminStaffMember> {
  const actor = ensureOwnerActor(ctx, "owner.assign")

  return ctx.prisma.$transaction(async (tx) => {
    // Второй шаг: роль выдаётся уже существующей служебной записи (журнал §26.7).
    const target = await loadTarget(ctx, tx, input.id, "owner.assign")
    if (target.archivedAt) throw createApiError("ARCHIVED", { requestId: ctx.requestId, entity: "user" })
    if (target.role === "owner") {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "user",
        expected: "not-owner",
        actual: "owner"
      })
    }
    await replaceRole(ctx, tx, target, "owner")
    const remainingOwners = await countActiveOwners(tx)
    await tx.auditLog.create({
      data: {
        action: "role.assign.owner",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: target.id,
        diff: { targetId: target.id, before: target.role, after: "owner", remainingOwners },
        requestId: ctx.requestId
      }
    })
    return reloadMember(ctx, tx, target.id, now)
  })
}

async function ensureOwnerRemains(ctx: GraphQLContext, tx: Prisma.TransactionClient): Promise<number> {
  const remainingOwners = await countActiveOwners(tx)
  if (remainingOwners < 1) {
    // Система не остаётся без владельца (журнал #10).
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "owner",
      expected: "at-least-one",
      actual: remainingOwners
    })
  }
  return remainingOwners
}

export async function revokeOwner(
  ctx: GraphQLContext,
  input: { id: string; reason: string },
  now = new Date()
): Promise<AdminStaffMember> {
  const actor = ensureOwnerActor(ctx, "owner.revoke")
  const reason = requiredText(input.reason, "reason", ctx.requestId)

  return ctx.prisma.$transaction(async (tx) => {
    const target = await loadTarget(ctx, tx, input.id, "owner.revoke")
    if (target.role !== "owner") {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "user",
        expected: "owner",
        actual: target.role
      })
    }
    await replaceRole(ctx, tx, target, "reader")
    const remainingOwners = await ensureOwnerRemains(ctx, tx)
    await tx.auditLog.create({
      data: {
        action: "role.revoke.owner",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: target.id,
        diff: { targetId: target.id, before: "owner", after: "reader", reason, remainingOwners },
        requestId: ctx.requestId
      }
    })
    return reloadMember(ctx, tx, target.id, now)
  })
}

async function closeAccess(
  ctx: GraphQLContext,
  tx: Prisma.TransactionClient,
  target: StaffTarget,
  actorRole: Role,
  actorId: string,
  reason: string,
  now: Date
): Promise<void> {
  const archived = await tx.user.updateMany({
    where: { id: target.id, archivedAt: null },
    data: {
      archivedAt: now,
      archiveMode: "admin",
      archivedByActorId: actorId,
      archivedByRole: actorRole,
      archiveReason: reason
    }
  })
  if (archived.count !== 1) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "user",
      expected: "active",
      actual: "archived"
    })
  }
  await tx.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now } })
}

export async function deactivateOwner(
  ctx: GraphQLContext,
  input: { id: string; reason: string },
  now = new Date()
): Promise<AdminStaffMember> {
  const actor = ensureOwnerActor(ctx, "owner.deactivate")
  const reason = requiredText(input.reason, "reason", ctx.requestId)

  return ctx.prisma.$transaction(async (tx) => {
    const target = await loadTarget(ctx, tx, input.id, "owner.deactivate")
    if (target.role !== "owner") {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "user",
        expected: "owner",
        actual: target.role
      })
    }
    await closeAccess(ctx, tx, target, actor.role, actor.id, reason, now)
    const remainingOwners = await ensureOwnerRemains(ctx, tx)
    await tx.auditLog.create({
      data: {
        action: "owner.deactivate",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: target.id,
        diff: { targetId: target.id, reason, remainingOwners },
        requestId: ctx.requestId
      }
    })
    return reloadMember(ctx, tx, target.id, now)
  })
}

export async function archiveStaffAccount(
  ctx: GraphQLContext,
  input: { id: string; reason: string },
  now = new Date()
): Promise<AdminStaffMember> {
  // Архив и восстановление служебных записей — только `owner` (журнал §26.7).
  const actor = ensureOwnerActor(ctx, "staff.archive")
  const reason = requiredText(input.reason, "reason", ctx.requestId)

  return ctx.prisma.$transaction(async (tx) => {
    const target = await loadTarget(ctx, tx, input.id, "staff.archive")
    if (target.role === "owner") {
      // Владелец закрывается отдельным действием с проверкой инварианта (`admins.md` §5).
      throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "staff.archive.owner" })
    }
    await closeAccess(ctx, tx, target, actor.role, actor.id, reason, now)
    await tx.auditLog.create({
      data: {
        action: "user.archive",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: target.id,
        diff: { targetId: target.id, reason, mode: "admin" },
        requestId: ctx.requestId
      }
    })
    return reloadMember(ctx, tx, target.id, now)
  })
}

export async function restoreStaffAccount(
  ctx: GraphQLContext,
  input: { id: string; reason: string },
  now = new Date()
): Promise<AdminStaffMember> {
  const actor = ensureOwnerActor(ctx, "staff.restore")
  const reason = requiredText(input.reason, "reason", ctx.requestId)

  return ctx.prisma.$transaction(async (tx) => {
    const target = await loadTarget(ctx, tx, input.id, "staff.restore")
    const restored = await tx.user.updateMany({
      where: { id: target.id, archivedAt: { not: null } },
      data: {
        archivedAt: null,
        archiveMode: null,
        archivedByActorId: null,
        archivedByRole: null,
        archiveReason: null
      }
    })
    if (restored.count !== 1) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "user",
        expected: "archived",
        actual: "active"
      })
    }
    await tx.auditLog.create({
      data: {
        action: "user.restore",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: target.id,
        diff: { targetId: target.id, reason, role: target.role },
        requestId: ctx.requestId
      }
    })
    return reloadMember(ctx, tx, target.id, now)
  })
}
