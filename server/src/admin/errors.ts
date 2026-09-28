import { BackendErrorWorkStatus, type Prisma } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { ensureRole } from "../exceptions/permissions"
import type { GraphQLContext } from "../prisma"
import { RATE_LIMIT_RULES } from "../rate-limits"
import { calculatePagination, validateBulkOperation, validatePagination, type PaginationInput } from "../utils/admin"

export type ErrorWorkStatus = "new" | "in_progress" | "resolved"
export type AdminErrorsContext = Pick<GraphQLContext, "prisma" | "currentUser" | "requestId">

export interface SetErrorWorkStatusInput {
  id: string
  status: ErrorWorkStatus
  expectedUpdatedAt: string
  comment?: string | null
}

export interface ErrorPeriodInput {
  from: string
  to: string
}

export interface ErrorLogFilters {
  stream?: "backend" | "page" | null
  service?: string | null
  code?: string | null
  route?: string | null
  workStatus?: ErrorWorkStatus[] | null
  q?: string | null
  period?: ErrorPeriodInput | null
}

export interface ErrorLogArgs {
  filters?: ErrorLogFilters | null
  pagination?: PaginationInput | null
}

const ERROR_DEFAULT_LIMIT = 20
const ERROR_EXPORT_MAX_ROWS = 1000
const ERROR_EXPORT_ACTION = "stats.export"
const ERROR_EXPORT_RULE = RATE_LIMIT_RULES["admin.export.user"]
const ERROR_SERVICES = ["api", "web", "worker"] as const

const toDatabaseStatus = (status: ErrorWorkStatus): BackendErrorWorkStatus =>
  status === "new" ? BackendErrorWorkStatus.new_record : status

export const presentErrorWorkStatus = (status: BackendErrorWorkStatus): ErrorWorkStatus =>
  status === BackendErrorWorkStatus.new_record ? "new" : status

const parseExpectedUpdatedAt = (value: string, requestId: string): Date => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "expectedUpdatedAt", rule: "iso-date" })
  }
  return parsed
}

const normalizeComment = (value: string | null | undefined, requestId: string): string | null => {
  const comment = value?.trim() || null
  if (comment && comment.length > 1000) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "comment", rule: "max:1000" })
  }
  return comment
}

const present = <T extends { workStatus: BackendErrorWorkStatus }>(record: T) => ({
  ...record,
  workStatus: presentErrorWorkStatus(record.workStatus)
})

const requireViewer = (ctx: AdminErrorsContext, action: string) => {
  ensureRole(ctx.currentUser, "admin", action, ctx.requestId)
  return ctx.currentUser!
}

const parsePeriod = (period: ErrorPeriodInput | null | undefined, requestId: string) => {
  const to = period ? new Date(period.to) : new Date()
  const from = period ? new Date(period.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000)
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "period", rule: "from<to" })
  }
  return { from, to }
}

const parseService = (service: string | null | undefined, requestId: string) => {
  if (!service) return undefined
  if (!(ERROR_SERVICES as readonly string[]).includes(service)) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "service", rule: "api|web|worker" })
  }
  return service as (typeof ERROR_SERVICES)[number]
}

const backendWhere = (
  filters: ErrorLogFilters,
  requestId: string,
  options: { includeDefaultStatus: boolean }
): Prisma.BackendErrorWhereInput => {
  const period = parsePeriod(filters.period, requestId)
  const requestedStatuses = filters.workStatus?.map(toDatabaseStatus)
  const service = parseService(filters.service, requestId)
  const statuses = requestedStatuses?.length
    ? requestedStatuses
    : options.includeDefaultStatus
      ? [BackendErrorWorkStatus.new_record, BackendErrorWorkStatus.in_progress]
      : undefined
  const q = filters.q?.trim()
  return {
    lastSeenAt: { gte: period.from, lt: period.to },
    ...(service ? { service } : {}),
    ...(filters.code ? { code: filters.code } : {}),
    ...(filters.route ? { route: filters.route } : {}),
    ...(statuses ? { workStatus: { in: statuses } } : {}),
    ...(q
      ? {
          OR: [
            { requestId: { equals: q } },
            { code: { contains: q, mode: "insensitive" as const } },
            { route: { contains: q, mode: "insensitive" as const } },
            { sanitizedMessage: { contains: q, mode: "insensitive" as const } }
          ]
        }
      : {})
  }
}

const presentLogItem = (record: {
  id: string
  signature: string
  service: string
  code: string
  route: string | null
  requestId: string | null
  occurrenceCount: number
  workStatus: BackendErrorWorkStatus
  assignedActorRole: string | null
  firstSeenAt: Date
  lastSeenAt: Date
  updatedAt: Date
}) => ({
  id: record.id,
  signature: record.signature,
  stream: "backend" as const,
  service: record.service,
  code: record.code,
  route: record.route,
  requestId: record.requestId,
  occurrences: record.occurrenceCount,
  workStatus: presentErrorWorkStatus(record.workStatus),
  assignedActorRole: record.assignedActorRole,
  firstSeenAt: record.firstSeenAt,
  lastSeenAt: record.lastSeenAt,
  updatedAt: record.updatedAt
})

export async function listErrorLog(ctx: AdminErrorsContext, args: ErrorLogArgs = {}) {
  requireViewer(ctx, "admin.errors.read")
  const filters = args.filters ?? {}
  const page = args.pagination?.page ?? 1
  const limit = args.pagination?.limit ?? ERROR_DEFAULT_LIMIT
  validatePagination({ page, limit }, ctx.requestId)
  const skip = (page - 1) * limit
  const take = limit
  const period = parsePeriod(filters.period, ctx.requestId)

  if (filters.stream === "page") {
    const events = await ctx.prisma.backendErrorEvent.findMany({
      where: {
        stream: "page",
        occurredAt: { gte: period.from, lt: period.to },
        ...(filters.service ? { service: filters.service } : {}),
        ...(filters.code ? { code: filters.code } : {}),
        ...(filters.route ? { route: filters.route } : {}),
        ...(filters.q
          ? {
              OR: [
                { requestId: filters.q.trim() },
                { code: { contains: filters.q.trim(), mode: "insensitive" } },
                { route: { contains: filters.q.trim(), mode: "insensitive" } }
              ]
            }
          : {})
      },
      orderBy: { occurredAt: "desc" }
    })
    const groups = new Map<
      string,
      (typeof events)[number] & { occurrences: number; firstSeenAt: Date; lastSeenAt: Date }
    >()
    for (const event of events) {
      const current = groups.get(event.signature)
      if (current) {
        current.occurrences += 1
        if (event.occurredAt < current.firstSeenAt) current.firstSeenAt = event.occurredAt
        if (event.occurredAt > current.lastSeenAt) current.lastSeenAt = event.occurredAt
      } else {
        groups.set(event.signature, {
          ...event,
          occurrences: 1,
          firstSeenAt: event.occurredAt,
          lastSeenAt: event.occurredAt
        })
      }
    }
    const all = [...groups.values()].sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())
    return {
      items: all.slice(skip, skip + take).map((event) => ({
        id: event.signature,
        signature: event.signature,
        stream: "page" as const,
        service: event.service,
        code: event.code,
        route: event.route,
        requestId: event.requestId,
        occurrences: event.occurrences,
        workStatus: null,
        assignedActorRole: null,
        firstSeenAt: event.firstSeenAt,
        lastSeenAt: event.lastSeenAt,
        updatedAt: event.lastSeenAt
      })),
      pagination: calculatePagination(page, limit, all.length)
    }
  }

  const where = backendWhere(filters, ctx.requestId, { includeDefaultStatus: true })
  const [records, total] = await Promise.all([
    ctx.prisma.backendError.findMany({ where, orderBy: { lastSeenAt: "desc" }, skip, take }),
    ctx.prisma.backendError.count({ where })
  ])
  return { items: records.map(presentLogItem), pagination: calculatePagination(page, limit, total) }
}

export async function getErrorEntry(ctx: AdminErrorsContext, id: string) {
  requireViewer(ctx, "admin.errors.read")
  const record = await ctx.prisma.backendError.findUnique({
    where: { id },
    include: { statusHistory: { orderBy: { createdAt: "asc" } } }
  })
  if (!record) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "errorWorkItem" })
  const occurrences = await ctx.prisma.backendErrorEvent.findMany({
    where: { signature: record.signature },
    orderBy: { occurredAt: "desc" },
    take: 100,
    select: { id: true, requestId: true, jobId: true, occurredAt: true }
  })
  return {
    ...present(record),
    message: record.sanitizedMessage,
    stack: record.sanitizedStack,
    occurrencesCount: record.occurrenceCount,
    occurrences,
    statusHistory: record.statusHistory.map((entry) => ({
      ...entry,
      fromStatus: entry.fromStatus ? presentErrorWorkStatus(entry.fromStatus) : null,
      toStatus: presentErrorWorkStatus(entry.toStatus)
    }))
  }
}

export async function getErrorStats(ctx: AdminErrorsContext, periodInput: ErrorPeriodInput) {
  requireViewer(ctx, "admin.errors.read")
  const period = parsePeriod(periodInput, ctx.requestId)
  const duration = period.to.getTime() - period.from.getTime()
  const previousFrom = new Date(period.from.getTime() - duration)
  const events = await ctx.prisma.backendErrorEvent.findMany({
    where: { stream: "backend", occurredAt: { gte: previousFrom, lt: period.to } },
    select: { service: true, code: true, occurredAt: true }
  })
  const current = events.filter((event) => event.occurredAt >= period.from)
  const bucket = (rows: typeof current, key: "service" | "code") =>
    [...rows.reduce((map, row) => map.set(row[key], (map.get(row[key]) ?? 0) + 1), new Map<string, number>())]
      .map(([value, count]) => ({ key: value, count }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
  const timeline = [
    ...current.reduce((map, row) => {
      const key = row.occurredAt.toISOString().slice(0, 13) + ":00:00.000Z"
      return map.set(key, (map.get(key) ?? 0) + 1)
    }, new Map<string, number>())
  ].map(([value, count]) => ({ bucket: value, count }))
  return {
    currentTotal: current.length,
    previousTotal: events.length - current.length,
    timeline,
    byService: bucket(current, "service"),
    byCode: bucket(current, "code")
  }
}

export async function listHealthHistory(ctx: AdminErrorsContext, periodInput: ErrorPeriodInput) {
  requireViewer(ctx, "admin.errors.read")
  const period = parsePeriod(periodInput, ctx.requestId)
  return ctx.prisma.systemHealthSnapshot.findMany({
    where: { checkedAt: { gte: period.from, lt: period.to } },
    orderBy: { checkedAt: "desc" },
    take: 500
  })
}

export async function resolveErrors(ctx: AdminErrorsContext, ids: string[]) {
  requireViewer(ctx, "admin.errors.status")
  validateBulkOperation(ids, ctx.requestId)
  const records = await ctx.prisma.backendError.findMany({
    where: { id: { in: ids } },
    select: { id: true, updatedAt: true }
  })
  if (records.length !== ids.length) {
    throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "errorWorkItem" })
  }
  return Promise.all(
    records.map((record) =>
      setErrorWorkStatus(ctx, { id: record.id, status: "resolved", expectedUpdatedAt: record.updatedAt.toISOString() })
    )
  )
}

const csvCell = (value: string | number | null): string => {
  const raw = value === null ? "" : String(value)
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildErrorsCsv(rows: ReturnType<typeof presentLogItem>[]): string {
  const columns = ["lastSeenAt", "service", "code", "route", "requestId", "occurrences", "workStatus"]
  const lines = rows.map((row) =>
    [row.lastSeenAt.toISOString(), row.service, row.code, row.route, row.requestId, row.occurrences, row.workStatus]
      .map(csvCell)
      .join(",")
  )
  return `${[columns.join(","), ...lines].join("\n")}\n`
}

export async function exportErrors(ctx: AdminErrorsContext, filters: ErrorLogFilters = {}, now = new Date()) {
  const actor = requireViewer(ctx, ERROR_EXPORT_ACTION)
  const windowStart = new Date(now.getTime() - ERROR_EXPORT_RULE.windowSeconds * 1000)
  const recent = await ctx.prisma.auditLog.findMany({
    where: {
      action: ERROR_EXPORT_ACTION,
      actorId: actor.id,
      entityType: "backendErrorExport",
      createdAt: { gte: windowStart }
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true }
  })
  if (recent.length >= ERROR_EXPORT_RULE.limit) {
    const retryAfter = Math.max(
      1,
      Math.ceil(
        ((recent[0]?.createdAt ?? windowStart).getTime() + ERROR_EXPORT_RULE.windowSeconds * 1000 - now.getTime()) /
          1000
      )
    )
    throw createApiError("RATE_LIMITED", { requestId: ctx.requestId, retryAfter })
  }

  const where = backendWhere(filters, ctx.requestId, { includeDefaultStatus: false })
  const records = await ctx.prisma.backendError.findMany({
    where,
    orderBy: { lastSeenAt: "desc" },
    take: ERROR_EXPORT_MAX_ROWS
  })
  await ctx.prisma.auditLog.create({
    data: {
      action: ERROR_EXPORT_ACTION,
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "backendErrorExport",
      entityId: now.toISOString(),
      diff: { rows: records.length },
      requestId: ctx.requestId
    }
  })
  return {
    filename: `errors-${now.toISOString().slice(0, 10)}.csv`,
    contentType: "text/csv",
    rows: records.length,
    csv: buildErrorsCsv(records.map(presentLogItem))
  }
}

/**
 * Меняет только рабочую проекцию группы. Неизменяемые `backend_error_events` эта транзакция не
 * затрагивает. `updatedAt` — optimistic lock: карточка другого сотрудника не перетирается.
 */
export async function setErrorWorkStatus(ctx: AdminErrorsContext, input: SetErrorWorkStatusInput) {
  ensureRole(ctx.currentUser, "admin", "admin.errors.status", ctx.requestId)
  const actor = ctx.currentUser!
  const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt, ctx.requestId)
  const comment = normalizeComment(input.comment, ctx.requestId)
  const nextStatus = toDatabaseStatus(input.status)

  return ctx.prisma.$transaction(async (tx) => {
    const current = await tx.backendError.findUnique({
      where: { id: input.id },
      include: { statusHistory: { orderBy: { createdAt: "asc" } } }
    })
    if (!current) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "errorWorkItem" })

    if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "errorWorkItem",
        expected: expectedUpdatedAt.toISOString(),
        actual: current.updatedAt.toISOString()
      })
    }

    const currentStatus = presentErrorWorkStatus(current.workStatus)
    const allowedTransitions: Record<ErrorWorkStatus, readonly ErrorWorkStatus[]> = {
      new: ["in_progress", "resolved"],
      in_progress: ["new", "resolved"],
      resolved: ["new"]
    }
    if (!allowedTransitions[currentStatus].includes(input.status)) {
      throw createApiError("VALIDATION_ERROR", {
        requestId: ctx.requestId,
        field: "status",
        rule: `${currentStatus}->${allowedTransitions[currentStatus].join("|")}`
      })
    }

    const changed = await tx.backendError.updateMany({
      where: { id: input.id, updatedAt: expectedUpdatedAt, workStatus: current.workStatus },
      data: {
        workStatus: nextStatus,
        assignedActorId: nextStatus === BackendErrorWorkStatus.new_record ? null : actor.id,
        assignedActorRole: nextStatus === BackendErrorWorkStatus.new_record ? null : actor.role
      }
    })
    if (changed.count !== 1) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "errorWorkItem",
        expected: expectedUpdatedAt.toISOString(),
        actual: "changed"
      })
    }

    await tx.backendErrorStatusHistory.create({
      data: {
        backendErrorId: input.id,
        fromStatus: current.workStatus,
        toStatus: nextStatus,
        changedByActorId: actor.id,
        changedByActorRole: actor.role,
        comment
      }
    })
    await tx.auditLog.create({
      data: {
        action: "admin.change",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "errorWorkItem",
        entityId: input.id,
        diff: {
          status: { from: presentErrorWorkStatus(current.workStatus), to: input.status },
          ...(comment ? { comment } : {})
        } satisfies Prisma.InputJsonValue,
        requestId: ctx.requestId
      }
    })

    const updated = await tx.backendError.findUnique({
      where: { id: input.id },
      include: { statusHistory: { orderBy: { createdAt: "asc" } } }
    })
    if (!updated) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "errorWorkItem" })
    return present(updated)
  })
}
