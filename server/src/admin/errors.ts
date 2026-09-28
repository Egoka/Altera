import { BackendErrorWorkStatus, Prisma } from "../generated/prisma"
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
const ERROR_MAX_PERIOD_MS = 31 * 24 * 60 * 60 * 1000

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
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    from >= to ||
    to.getTime() - from.getTime() > ERROR_MAX_PERIOD_MS
  ) {
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

const projectionWhere = (
  filters: ErrorLogFilters,
  signatures: string[],
  options: { includeDefaultStatus: boolean }
): Prisma.BackendErrorWhereInput => {
  const requestedStatuses = filters.workStatus?.map(toDatabaseStatus)
  const statuses = requestedStatuses?.length
    ? requestedStatuses
    : options.includeDefaultStatus
      ? [BackendErrorWorkStatus.new_record, BackendErrorWorkStatus.in_progress]
      : undefined
  return {
    signature: { in: signatures },
    ...(statuses ? { workStatus: { in: statuses } } : {})
  }
}

const eventWhere = (
  filters: ErrorLogFilters,
  stream: "backend" | "page",
  period: { from: Date; to: Date },
  requestId: string
): Prisma.BackendErrorEventWhereInput => {
  const service = parseService(filters.service, requestId)
  const q = filters.q?.trim()
  return {
    stream,
    occurredAt: { gte: period.from, lt: period.to },
    ...(service ? { service } : {}),
    ...(filters.code ? { code: filters.code } : {}),
    ...(filters.route ? { route: filters.route } : {}),
    ...(q
      ? {
          OR: [
            { requestId: q },
            { code: { contains: q, mode: "insensitive" } },
            { route: { contains: q, mode: "insensitive" } },
            { message: { contains: q, mode: "insensitive" } }
          ]
        }
      : {})
  }
}

const presentLogItem = (
  record: {
    id: string
    signature: string
    service: string
    code: string
    route: string | null
    requestId: string | null
    occurrenceCount: number
    workStatus: BackendErrorWorkStatus
    assignedActorId: string | null
    assignedActorRole: string | null
    firstSeenAt: Date
    lastSeenAt: Date
    updatedAt: Date
  },
  period?: { occurrences: number; firstSeenAt: Date; lastSeenAt: Date }
) => ({
  id: record.id,
  signature: record.signature,
  stream: "backend" as const,
  service: record.service,
  code: record.code,
  route: record.route,
  requestId: record.requestId,
  occurrences: period?.occurrences ?? record.occurrenceCount,
  workStatus: presentErrorWorkStatus(record.workStatus),
  assignedActorId: record.assignedActorId,
  assignedActorRole: record.assignedActorRole,
  firstSeenAt: period?.firstSeenAt ?? record.firstSeenAt,
  lastSeenAt: period?.lastSeenAt ?? record.lastSeenAt,
  updatedAt: record.updatedAt
})

const loadGroupedEvents = (ctx: AdminErrorsContext, filters: ErrorLogFilters, stream: "backend" | "page") => {
  const period = parsePeriod(filters.period, ctx.requestId)
  return ctx.prisma.backendErrorEvent.groupBy({
    by: ["signature", "stream", "service", "code", "route"],
    where: eventWhere(filters, stream, period, ctx.requestId),
    _count: { _all: true },
    _min: { occurredAt: true },
    _max: { occurredAt: true }
  })
}

async function loadBackendLogItems(ctx: AdminErrorsContext, filters: ErrorLogFilters, includeDefaultStatus: boolean) {
  const groups = await loadGroupedEvents(ctx, filters, "backend")
  if (groups.length === 0) return []
  const stats = new Map(
    groups.map((group) => [
      group.signature,
      {
        occurrences: group._count._all,
        firstSeenAt: group._min.occurredAt!,
        lastSeenAt: group._max.occurredAt!
      }
    ])
  )
  const records = await ctx.prisma.backendError.findMany({
    where: projectionWhere(
      filters,
      groups.map((group) => group.signature),
      { includeDefaultStatus }
    )
  })
  return records
    .map((record) => presentLogItem(record, stats.get(record.signature)))
    .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())
}

export async function listErrorLog(ctx: AdminErrorsContext, args: ErrorLogArgs = {}) {
  requireViewer(ctx, "admin.errors.read")
  const filters = args.filters ?? {}
  const page = args.pagination?.page ?? 1
  const limit = args.pagination?.limit ?? ERROR_DEFAULT_LIMIT
  validatePagination({ page, limit }, ctx.requestId)
  const skip = (page - 1) * limit
  const take = limit

  if (filters.stream === "page") {
    const groups = await loadGroupedEvents(ctx, filters, "page")
    const all = groups.sort(
      (left, right) => (right._max.occurredAt?.getTime() ?? 0) - (left._max.occurredAt?.getTime() ?? 0)
    )
    return {
      items: all.slice(skip, skip + take).map((group) => ({
        id: group.signature,
        signature: group.signature,
        stream: "page" as const,
        service: group.service,
        code: group.code,
        route: group.route,
        requestId: null,
        occurrences: group._count._all,
        workStatus: null,
        assignedActorId: null,
        assignedActorRole: null,
        firstSeenAt: group._min.occurredAt!,
        lastSeenAt: group._max.occurredAt!,
        updatedAt: group._max.occurredAt!
      })),
      pagination: calculatePagination(page, limit, all.length).pagination
    }
  }

  const items = await loadBackendLogItems(ctx, filters, true)
  return {
    items: items.slice(skip, skip + take),
    pagination: calculatePagination(page, limit, items.length).pagination
  }
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
  const currentWhere = { stream: "backend" as const, occurredAt: { gte: period.from, lt: period.to } }
  const previousWhere = { stream: "backend" as const, occurredAt: { gte: previousFrom, lt: period.from } }
  const granularity = duration <= 48 * 60 * 60 * 1000 ? "hour" : "day"
  const [currentTotal, previousTotal, services, codes, timelineRows] = await Promise.all([
    ctx.prisma.backendErrorEvent.count({ where: currentWhere }),
    ctx.prisma.backendErrorEvent.count({ where: previousWhere }),
    ctx.prisma.backendErrorEvent.groupBy({ by: ["service"], where: currentWhere, _count: { _all: true } }),
    ctx.prisma.backendErrorEvent.groupBy({ by: ["code"], where: currentWhere, _count: { _all: true } }),
    ctx.prisma.$queryRaw<Array<{ bucket: Date; count: number }>>(Prisma.sql`
      SELECT date_trunc(${granularity}, "occurredAt") AS "bucket", COUNT(*)::int AS "count"
      FROM "backend_error_events"
      WHERE "stream" = 'backend'::"ErrorStream"
        AND "occurredAt" >= ${period.from}
        AND "occurredAt" < ${period.to}
      GROUP BY 1
      ORDER BY 1
    `)
  ])
  const buckets = <T extends { _count: { _all: number } }>(rows: T[], key: keyof T) =>
    rows
      .map((row) => ({ key: String(row[key]), count: row._count._all }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
  return {
    currentTotal,
    previousTotal,
    timeline: timelineRows.map((row) => ({ bucket: row.bucket.toISOString(), count: row.count })),
    byService: buckets(services, "service"),
    byCode: buckets(codes, "code")
  }
}

export async function listHealthHistory(ctx: AdminErrorsContext, periodInput: ErrorPeriodInput) {
  requireViewer(ctx, "admin.errors.read")
  const period = parsePeriod(periodInput, ctx.requestId)
  const [rows, previous] = await Promise.all([
    ctx.prisma.systemHealthSnapshot.findMany({
      where: { checkedAt: { gte: period.from, lt: period.to } },
      orderBy: { checkedAt: "desc" },
      take: 500
    }),
    ctx.prisma.systemHealthSnapshot.findFirst({
      where: { checkedAt: { lt: period.from } },
      orderBy: { checkedAt: "desc" }
    })
  ])
  return rows.length > 0 ? rows : previous ? [previous] : []
}

export async function resolveErrors(ctx: AdminErrorsContext, ids: string[]) {
  const actor = requireViewer(ctx, "admin.errors.status")
  validateBulkOperation(ids, ctx.requestId)
  return ctx.prisma.$transaction(async (tx) => {
    const records = await tx.backendError.findMany({
      where: { id: { in: ids } },
      select: { id: true, updatedAt: true }
    })
    if (records.length !== ids.length) {
      throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "errorWorkItem" })
    }
    const results = []
    for (const record of records) {
      results.push(
        await setErrorWorkStatusWithClient(tx, ctx, actor, {
          id: record.id,
          status: "resolved",
          expectedUpdatedAt: record.updatedAt,
          comment: null,
          nextStatus: BackendErrorWorkStatus.resolved
        })
      )
    }
    return results
  })
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

  const records = (await loadBackendLogItems(ctx, filters, false)).slice(0, ERROR_EXPORT_MAX_ROWS)
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
    csv: buildErrorsCsv(records)
  }
}

interface PreparedStatusChange {
  id: string
  status: ErrorWorkStatus
  expectedUpdatedAt: Date
  comment: string | null
  nextStatus: BackendErrorWorkStatus
}

const prepareStatusChange = (input: SetErrorWorkStatusInput, requestId: string): PreparedStatusChange => ({
  id: input.id,
  status: input.status,
  expectedUpdatedAt: parseExpectedUpdatedAt(input.expectedUpdatedAt, requestId),
  comment: normalizeComment(input.comment, requestId),
  nextStatus: toDatabaseStatus(input.status)
})

async function setErrorWorkStatusWithClient(
  tx: Prisma.TransactionClient,
  ctx: AdminErrorsContext,
  actor: NonNullable<AdminErrorsContext["currentUser"]>,
  input: PreparedStatusChange
) {
  const current = await tx.backendError.findUnique({
    where: { id: input.id },
    include: { statusHistory: { orderBy: { createdAt: "asc" } } }
  })
  if (!current) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "errorWorkItem" })

  if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "errorWorkItem",
      expected: input.expectedUpdatedAt.toISOString(),
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
    where: { id: input.id, updatedAt: input.expectedUpdatedAt, workStatus: current.workStatus },
    data: {
      workStatus: input.nextStatus,
      assignedActorId: input.nextStatus === BackendErrorWorkStatus.new_record ? null : actor.id,
      assignedActorRole: input.nextStatus === BackendErrorWorkStatus.new_record ? null : actor.role
    }
  })
  if (changed.count !== 1) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "errorWorkItem",
      expected: input.expectedUpdatedAt.toISOString(),
      actual: "changed"
    })
  }

  await tx.backendErrorStatusHistory.create({
    data: {
      backendErrorId: input.id,
      fromStatus: current.workStatus,
      toStatus: input.nextStatus,
      changedByActorId: actor.id,
      changedByActorRole: actor.role,
      comment: input.comment
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
        ...(input.comment ? { comment: input.comment } : {})
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
}

/**
 * Меняет только рабочую проекцию группы. Неизменяемые `backend_error_events` эта транзакция не
 * затрагивает. `updatedAt` — optimistic lock: карточка другого сотрудника не перетирается.
 */
export async function setErrorWorkStatus(ctx: AdminErrorsContext, input: SetErrorWorkStatusInput) {
  const actor = requireViewer(ctx, "admin.errors.status")
  const prepared = prepareStatusChange(input, ctx.requestId)
  return ctx.prisma.$transaction((tx) => setErrorWorkStatusWithClient(tx, ctx, actor, prepared))
}
