import { Prisma, type JobStatus, type Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { ensurePermission, hasPermission } from "../exceptions/permissions"
import { cancelJob, retryJob } from "../jobs/job-actions"
import { createPrismaJobStore } from "../jobs/prisma-job-store"
import type { GraphQLContext } from "../prisma"

export const ADMIN_JOB_STATUSES = ["queued", "running", "completed", "failed", "cancelled", "stuck"] as const
// `jobs.md` §4: по умолчанию показываются ошибка и зависло.
export const DEFAULT_JOB_STATUS_FILTER: readonly JobStatus[] = ["failed", "stuck"]
// `jobs.md` §4 [ДОПУЩЕНИЕ]: период по умолчанию — 24 часа.
export const DEFAULT_JOB_PERIOD_HOURS = 24
// `jobs.md` §6 [ДОПУЩЕНИЕ]: максимум 100 заданий в массовом повторе.
export const JOB_BULK_RETRY_LIMIT = 100
export const JOB_PAGE_LIMIT = 20
export const JOB_MAX_PAGE_LIMIT = 100
// Журнал §27.3: ручного повтора расчёта рейтинга нет.
export const NON_RETRYABLE_JOB_KIND = "ranking.recompute"

// `jobs.md` §3 [ДОПУЩЕНИЕ: перечень видов]; фактические виды очереди добавляются к списку.
export const KNOWN_JOB_KINDS = [
  "ai.check",
  "ai.translate",
  "ai.alt",
  "media.process",
  "media.purge",
  "subscription.renewal",
  "subscription.expire",
  "ranking.recompute",
  "export",
  "mail",
  "engagement.aggregate"
] as const

const PENDING_STATUSES: readonly JobStatus[] = ["queued", "running"]
const FINISHED_STATUSES: readonly JobStatus[] = ["completed", "failed", "stuck"]
const FAILED_STATUSES: readonly JobStatus[] = ["failed", "stuck"]

export type JobSortField = "createdAt" | "duration" | "attempts"
export type SortDirection = "ASC" | "DESC"

export interface AdminJobsFiltersInput {
  kinds?: readonly string[] | null
  statuses?: readonly JobStatus[] | null
  from?: string | null
  to?: string | null
  objectId?: string | null
  stuckOnly?: boolean | null
}

export interface AdminJobsQueryInput {
  filters?: AdminJobsFiltersInput | null
  sort?: { field: JobSortField; direction: SortDirection } | null
  page?: number | null
  limit?: number | null
}

interface NormalizedFilters {
  kinds: string[]
  statuses: JobStatus[]
  from: Date
  to: Date
  objectId: string | null
}

export interface AdminJobRow {
  id: string
  kind: string
  status: JobStatus
  objectType: string | null
  objectId: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  cancelledAt: Date | null
  attemptCount: number
  maxAttempts: number
  durationMs: number | null
  manualRetryAllowed: boolean
  retryable: boolean
  cancellable: boolean
  lastErrorClass: string | null
  lastErrorRequestId: string | null
}

export interface AdminJobsViewer {
  canRetry: boolean
  canCancel: boolean
}

export interface AdminJobsPage {
  jobs: AdminJobRow[]
  pagination: {
    currentPage: number
    totalPages: number
    totalItems: number
    itemsPerPage: number
    hasNextPage: boolean
    hasPreviousPage: boolean
  }
  kinds: string[]
  viewer: AdminJobsViewer
  appliedFrom: Date
  appliedTo: Date
}

export interface AdminJobParameter {
  key: string
  value: string
}

export interface AdminJobAttempt {
  number: number
  status: JobStatus
  startedAt: Date | null
  finishedAt: Date | null
  errorClass: string | null
  errorRequestId: string | null
}

export interface AdminJobAction {
  action: string
  actorId: string | null
  actorRole: Role | null
  actorName: string | null
  reason: string | null
  createdAt: Date
}

export interface AdminJobCard {
  job: AdminJobRow
  parameters: AdminJobParameter[]
  attempts: AdminJobAttempt[]
  actions: AdminJobAction[]
  objectHref: string | null
  viewer: AdminJobsViewer
}

export interface AdminJobsSummary {
  depthByKind: { kind: string; depth: number }[]
  oldestPendingAgeSec: number | null
  finishedInPeriod: number
  failedInPeriod: number
  failureRate: number
  periodFrom: Date
  periodTo: Date
}

const rowSelect = {
  id: true,
  kind: true,
  status: true,
  objectType: true,
  objectId: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  cancelledAt: true,
  attemptCount: true,
  maxAttempts: true,
  manualRetryAllowed: true,
  attempts: {
    where: { errorClass: { not: null } },
    orderBy: { number: "desc" },
    take: 1,
    select: { errorClass: true, errorRequestId: true }
  }
} satisfies Prisma.JobSelect

type JobRecord = Prisma.JobGetPayload<{ select: typeof rowSelect }>

function ensureJobRead(ctx: GraphQLContext, action: string): void {
  ensurePermission(ctx.currentUser, "job.list", action, ctx.requestId)
}

function viewerActions(ctx: GraphQLContext, now: Date): AdminJobsViewer {
  return {
    canRetry: hasPermission(ctx.currentUser, "job.retry", { now }),
    canCancel: hasPermission(ctx.currentUser, "job.cancel", { now })
  }
}

function parseDate(value: string | null | undefined, field: string, requestId: string, fallback: Date): Date {
  if (value === null || value === undefined || value === "") return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw createApiError("VALIDATION_ERROR", { requestId, field, rule: "iso-date" })
  }
  return parsed
}

export function normalizeFilters(
  filters: AdminJobsFiltersInput | null | undefined,
  requestId: string,
  now: Date
): NormalizedFilters {
  const to = parseDate(filters?.to, "to", requestId, now)
  const from = parseDate(
    filters?.from,
    "from",
    requestId,
    new Date(to.getTime() - DEFAULT_JOB_PERIOD_HOURS * 3_600_000)
  )
  if (from > to) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "from", rule: "from-before-to" })
  }

  const requested = filters?.statuses?.length ? [...filters.statuses] : [...DEFAULT_JOB_STATUS_FILTER]
  const invalid = requested.filter((status) => !ADMIN_JOB_STATUSES.includes(status))
  if (invalid.length > 0) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "statuses", rule: "enum" })
  }

  const objectId = filters?.objectId?.trim()
  return {
    // `stuck=1` из адреса сужает список независимо от выбранного статуса.
    statuses: filters?.stuckOnly ? ["stuck"] : requested,
    kinds: filters?.kinds?.length ? [...filters.kinds] : [],
    from,
    to,
    objectId: objectId ? objectId : null
  }
}

function whereFromFilters(filters: NormalizedFilters): Prisma.JobWhereInput {
  return {
    createdAt: { gte: filters.from, lte: filters.to },
    ...(filters.statuses.length ? { status: { in: filters.statuses } } : {}),
    ...(filters.kinds.length ? { kind: { in: filters.kinds } } : {}),
    ...(filters.objectId ? { objectId: filters.objectId } : {})
  }
}

// Длительность — производная величина, поэтому порядок по ней считает база, а не страница выдачи.
function durationOrderedIds(
  ctx: GraphQLContext,
  filters: NormalizedFilters,
  direction: SortDirection,
  skip: number,
  take: number
): Promise<{ id: string }[]> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`"createdAt" >= ${filters.from}`,
    Prisma.sql`"createdAt" <= ${filters.to}`
  ]
  if (filters.statuses.length) {
    conditions.push(Prisma.sql`"status"::text IN (${Prisma.join(filters.statuses.map((status) => `${status}`))})`)
  }
  if (filters.kinds.length) conditions.push(Prisma.sql`"kind" IN (${Prisma.join(filters.kinds)})`)
  if (filters.objectId) conditions.push(Prisma.sql`"objectId" = ${filters.objectId}`)

  const order = Prisma.raw(direction === "ASC" ? "ASC" : "DESC")
  return ctx.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "jobs"
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY (COALESCE("finishedAt", NOW()) - "startedAt") ${order} NULLS LAST, "createdAt" DESC
    OFFSET ${skip} LIMIT ${take}
  `)
}

function presentRow(job: JobRecord): AdminJobRow {
  const attempt = job.attempts[0]
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    objectType: job.objectType,
    objectId: job.objectId,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    cancelledAt: job.cancelledAt,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    durationMs: job.startedAt && job.finishedAt ? job.finishedAt.getTime() - job.startedAt.getTime() : null,
    manualRetryAllowed: job.manualRetryAllowed,
    retryable: isRetryable(job),
    cancellable: PENDING_STATUSES.includes(job.status),
    lastErrorClass: attempt?.errorClass ?? null,
    lastErrorRequestId: attempt?.errorRequestId ?? null
  }
}

export function isRetryable(job: Pick<JobRecord, "status" | "kind" | "manualRetryAllowed">): boolean {
  return FAILED_STATUSES.includes(job.status) && job.manualRetryAllowed && job.kind !== NON_RETRYABLE_JOB_KIND
}

export async function listAdminJobs(
  ctx: GraphQLContext,
  input: AdminJobsQueryInput = {},
  now = new Date()
): Promise<AdminJobsPage> {
  ensureJobRead(ctx, "job.list")

  const page = input.page ?? 1
  const limit = input.limit ?? JOB_PAGE_LIMIT
  if (page < 1) throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "page", rule: "min:1" })
  if (limit < 1) throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "limit", rule: "min:1" })
  if (limit > JOB_MAX_PAGE_LIMIT) {
    throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "limit", rule: "max:100" })
  }

  const filters = normalizeFilters(input.filters, ctx.requestId, now)
  const sort = input.sort ?? { field: "createdAt" as const, direction: "DESC" as const }
  const where = whereFromFilters(filters)
  const skip = (page - 1) * limit

  const [totalItems, kindGroups] = await Promise.all([
    ctx.prisma.job.count({ where }),
    ctx.prisma.job.groupBy({ by: ["kind"] })
  ])

  let jobs: JobRecord[]
  if (sort.field === "duration") {
    const ordered = await durationOrderedIds(ctx, filters, sort.direction, skip, limit)
    const rows = await ctx.prisma.job.findMany({
      where: { id: { in: ordered.map((row) => row.id) } },
      select: rowSelect
    })
    const byId = new Map(rows.map((row) => [row.id, row]))
    jobs = ordered.flatMap(({ id }) => {
      const row = byId.get(id)
      return row ? [row] : []
    })
  } else {
    const orderBy: Prisma.JobOrderByWithRelationInput =
      sort.field === "attempts"
        ? { attemptCount: sort.direction === "ASC" ? "asc" : "desc" }
        : { createdAt: sort.direction === "ASC" ? "asc" : "desc" }
    jobs = await ctx.prisma.job.findMany({ where, orderBy, skip, take: limit, select: rowSelect })
  }

  const totalPages = Math.ceil(totalItems / limit)
  return {
    jobs: jobs.map(presentRow),
    pagination: {
      currentPage: page,
      totalPages,
      totalItems,
      itemsPerPage: limit,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    },
    kinds: [...new Set([...KNOWN_JOB_KINDS, ...kindGroups.map((group) => group.kind)])].sort(),
    viewer: viewerActions(ctx, now),
    appliedFrom: filters.from,
    appliedTo: filters.to
  }
}

// `jobs.md` §3: в карточке допустимы параметры без персональных данных.
export function presentParameters(parameters: Prisma.JsonValue | null): AdminJobParameter[] {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) return []
  return Object.entries(parameters).map(([key, value]) => {
    if (value === null) return { key, value: "—" }
    // Вложенные структуры могут содержать персональные данные, поэтому заменяются пометкой о типе.
    if (typeof value === "object") return { key, value: Array.isArray(value) ? "[…]" : "{…}" }
    return { key, value: String(value) }
  })
}

function actionReason(diff: Prisma.JsonValue | null): string | null {
  if (typeof diff !== "object" || diff === null || Array.isArray(diff)) return null
  const reason = (diff as Record<string, unknown>).reason
  return typeof reason === "string" ? reason : null
}

export async function getAdminJob(ctx: GraphQLContext, id: string, now = new Date()): Promise<AdminJobCard | null> {
  ensureJobRead(ctx, "job.list")

  const job = await ctx.prisma.job.findUnique({
    where: { id },
    select: { ...rowSelect, parameters: true }
  })
  if (!job) return null

  const [attempts, auditEntries] = await Promise.all([
    ctx.prisma.jobAttempt.findMany({
      where: { jobId: id },
      orderBy: { number: "asc" },
      select: { number: true, status: true, startedAt: true, finishedAt: true, errorClass: true, errorRequestId: true }
    }),
    ctx.prisma.auditLog.findMany({
      where: { entityType: "Job", entityId: id, action: { in: ["job.retry", "job.cancel"] } },
      orderBy: { createdAt: "desc" },
      select: { action: true, actorId: true, actorRole: true, diff: true, createdAt: true }
    })
  ])

  const actorIds = [...new Set(auditEntries.flatMap((entry) => (entry.actorId ? [entry.actorId] : [])))]
  const actors = actorIds.length
    ? await ctx.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : []
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]))

  return {
    job: presentRow(job),
    parameters: presentParameters(job.parameters),
    attempts,
    actions: auditEntries.map((entry) => ({
      action: entry.action,
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      actorName: entry.actorId ? (actorNames.get(entry.actorId) ?? null) : null,
      reason: actionReason(entry.diff),
      createdAt: entry.createdAt
    })),
    objectHref: await resolveObjectHref(ctx, job.objectType, job.objectId),
    viewer: viewerActions(ctx, now)
  }
}

// Профильные разделы #14/#21/#22 ещё не реализованы, а админские маршруты адресуются слагом.
async function resolveObjectHref(
  ctx: GraphQLContext,
  objectType: string | null,
  objectId: string | null
): Promise<string | null> {
  if (objectType !== "Article" || !objectId) return null
  const article = await ctx.prisma.article.findUnique({ where: { id: objectId }, select: { slug: true } })
  return article ? `/admin/articles/${article.slug}` : null
}

export async function getJobsSummary(ctx: GraphQLContext, now = new Date()): Promise<AdminJobsSummary> {
  ensureJobRead(ctx, "job.summary")

  const periodFrom = new Date(now.getTime() - DEFAULT_JOB_PERIOD_HOURS * 3_600_000)
  const [depth, oldest, finishedInPeriod, failedInPeriod] = await Promise.all([
    ctx.prisma.job.groupBy({
      by: ["kind"],
      where: { status: { in: [...PENDING_STATUSES] } },
      _count: { _all: true }
    }),
    ctx.prisma.job.findFirst({
      where: { status: { in: [...PENDING_STATUSES] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true }
    }),
    ctx.prisma.job.count({ where: { status: { in: [...FINISHED_STATUSES] }, createdAt: { gte: periodFrom } } }),
    ctx.prisma.job.count({ where: { status: { in: [...FAILED_STATUSES] }, createdAt: { gte: periodFrom } } })
  ])

  return {
    depthByKind: depth
      .map((group) => ({ kind: group.kind, depth: group._count._all }))
      .sort((left, right) => right.depth - left.depth || left.kind.localeCompare(right.kind)),
    oldestPendingAgeSec: oldest ? Math.max(0, Math.floor((now.getTime() - oldest.createdAt.getTime()) / 1_000)) : null,
    finishedInPeriod,
    failedInPeriod,
    failureRate: finishedInPeriod > 0 ? failedInPeriod / finishedInPeriod : 0,
    periodFrom,
    periodTo: now
  }
}

async function loadRow(ctx: GraphQLContext, id: string): Promise<AdminJobRow> {
  const job = await ctx.prisma.job.findUnique({ where: { id }, select: rowSelect })
  if (!job) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "Job" })
  return presentRow(job)
}

export async function retryAdminJob(ctx: GraphQLContext, id: string, now = new Date()): Promise<AdminJobRow> {
  await retryJob({
    store: createPrismaJobStore(ctx.prisma),
    currentUser: ctx.currentUser,
    jobId: id,
    requestId: ctx.requestId,
    now
  })
  return loadRow(ctx, id)
}

export async function cancelAdminJob(
  ctx: GraphQLContext,
  id: string,
  reason: string,
  now = new Date()
): Promise<AdminJobRow> {
  await cancelJob({
    store: createPrismaJobStore(ctx.prisma),
    currentUser: ctx.currentUser,
    jobId: id,
    requestId: ctx.requestId,
    reason,
    now
  })
  return loadRow(ctx, id)
}

export interface AdminJobsBulkRetryResult {
  requested: number
  retried: string[]
  skipped: string[]
}

export async function retryAdminJobs(
  ctx: GraphQLContext,
  ids: readonly string[],
  now = new Date()
): Promise<AdminJobsBulkRetryResult> {
  if (ids.length === 0) {
    throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "ids", rule: "required" })
  }
  if (ids.length > JOB_BULK_RETRY_LIMIT) {
    throw createApiError("VALIDATION_ERROR", {
      requestId: ctx.requestId,
      field: "ids",
      rule: `maxItems:${JOB_BULK_RETRY_LIMIT}`
    })
  }

  const store = createPrismaJobStore(ctx.prisma)
  const retried: string[] = []
  const skipped: string[] = []
  for (const id of ids) {
    try {
      await retryJob({ store, currentUser: ctx.currentUser, jobId: id, requestId: ctx.requestId, now })
      retried.push(id)
    } catch (error: unknown) {
      // Право проверяется одинаково для всех, поэтому FORBIDDEN останавливает всю операцию,
      // а несовпавшее предусловие конкретного задания только исключает его из результата.
      if (error instanceof Error && "extensions" in error) {
        const code = (error as { extensions?: { code?: unknown } }).extensions?.code
        if (code === "CONFLICT") {
          skipped.push(id)
          continue
        }
      }
      throw error
    }
  }
  return { requested: ids.length, retried, skipped }
}
