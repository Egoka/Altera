import { Prisma, type AiProcessKind, type AiProcessStatus, type Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, ensurePermission } from "../exceptions/permissions"
import type { GraphQLContext } from "../prisma"
import { calculatePagination, validatePagination, type PaginationInfo } from "../utils/admin"

export const ADMIN_AI_PAGE_SIZE = 20
export const ADMIN_AI_MAX_PAGE_SIZE = 100
export const ADMIN_AI_DEFAULT_PERIOD_DAYS = 7

const ARTICLE_OBJECT_TYPES = ["ArticleTranslation", "article_translation"] as const
const USER_OBJECT_TYPES = ["User", "user"] as const
const MEDIA_OBJECT_TYPES = ["mediaAsset", "media_asset"] as const
const REVIEW_ARTICLE_STATUSES = ["review", "in_review", "rework"] as const

export type AdminAiSort = "createdAt" | "duration"

export interface AdminAiPeriodInput {
  from?: string | null
  to?: string | null
}

export interface AdminAiFiltersInput {
  kind?: AiProcessKind | null
  status?: AiProcessStatus | null
  verdict?: string | null
  reason?: string | null
  period?: AdminAiPeriodInput | null
  query?: string | null
  ownZone?: boolean | null
}

export interface AdminAiQueryInput {
  filters?: AdminAiFiltersInput | null
  sort?: AdminAiSort | null
  page?: number | null
  limit?: number | null
}

export interface NormalizedAdminAiQuery {
  filters: Omit<AdminAiFiltersInput, "period" | "query"> & { query: string | null }
  sort: AdminAiSort
  page: number
  limit: number
  from: Date
  to: Date
}

export interface AdminAiObject {
  id: string
  type: string
  title: string
  subtitle: string | null
  href: string | null
}

export interface AdminAiReason {
  category: string
  text: string | null
}

export interface AdminAiProcess {
  id: string
  kind: AiProcessKind
  status: AiProcessStatus
  verdict: string | null
  object: AdminAiObject
  reasons: AdminAiReason[]
  providerErrorClass: string | null
  model: string | null
  promptVersion: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  durationMs: number | null
  jobHref: string | null
}

export interface AdminAiRecordsPage {
  items: AdminAiProcess[]
  pagination: PaginationInfo
  viewerRole: Role
}

export interface AdminAiStats {
  processCount: number
  totalCostMinor: string
  medianDurationMs: number | null
  planSharePercent: number | null
  kinds: Array<{ kind: AiProcessKind; count: number }>
  statuses: Array<{ status: AiProcessStatus; count: number }>
  rejectionReasons: Array<{ category: string; count: number; share: number }>
  providerErrors: number
  periodFrom: Date
  periodTo: Date
}

const processSelect = {
  id: true,
  jobId: true,
  kind: true,
  status: true,
  objectType: true,
  objectId: true,
  verdict: true,
  reasons: true,
  providerErrorClass: true,
  model: true,
  promptVersion: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  durationMs: true
} as const satisfies Prisma.AiProcessSelect

type ProcessRecord = Prisma.AiProcessGetPayload<{ select: typeof processSelect }>

interface AiViewer {
  role: Role
  scoped: boolean
}

function parseDate(value: string | null | undefined, field: string, requestId: string, fallback: Date): Date {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw createApiError("VALIDATION_ERROR", { requestId, field, rule: "iso-date" })
  }
  return parsed
}

export function normalizeAdminAiQuery(
  input: AdminAiQueryInput,
  requestId: string,
  now = new Date()
): NormalizedAdminAiQuery {
  const page = input.page ?? 1
  const limit = input.limit ?? ADMIN_AI_PAGE_SIZE
  validatePagination({ page, limit }, requestId)
  if (limit > ADMIN_AI_MAX_PAGE_SIZE) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "limit", rule: "max:100" })
  }

  const to = parseDate(input.filters?.period?.to, "period.to", requestId, now)
  const defaultFrom = new Date(to)
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - ADMIN_AI_DEFAULT_PERIOD_DAYS)
  const from = parseDate(input.filters?.period?.from, "period.from", requestId, defaultFrom)
  if (from > to) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "period.from", rule: "from-before-to" })
  }

  const query = input.filters?.query?.trim() || null
  if (query && query.length < 3) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "query", rule: "min-length:3" })
  }

  return {
    filters: {
      kind: input.filters?.kind ?? null,
      status: input.filters?.status ?? null,
      verdict: input.filters?.verdict?.trim() || null,
      reason: input.filters?.reason?.trim() || null,
      ownZone: input.filters?.ownZone ?? null,
      query
    },
    sort: input.sort ?? "createdAt",
    page,
    limit,
    from,
    to
  }
}

function ensureAiViewer(ctx: GraphQLContext, action: string): AiViewer {
  ensurePermission(ctx.currentUser, "ai.read", action, ctx.requestId)
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  return { role: user.role, scoped: user.role === "moderator" }
}

async function scopedObjectIds(ctx: GraphQLContext): Promise<string[]> {
  const [translations, users] = await Promise.all([
    ctx.prisma.articleTranslation.findMany({
      where: { article: { status: { in: [...REVIEW_ARTICLE_STATUSES] } } },
      select: { id: true }
    }),
    // Проверки имени и аватара входят в рабочую зону модератора (`ai-processes.md` §1, §3).
    ctx.prisma.user.findMany({ select: { id: true } })
  ])
  return [...translations.map(({ id }) => id), ...users.map(({ id }) => id)]
}

async function searchedObjectIds(ctx: GraphQLContext, query: string): Promise<string[]> {
  const [translations, users, media] = await Promise.all([
    ctx.prisma.articleTranslation.findMany({
      where: { title: { contains: query, mode: "insensitive" } },
      select: { id: true }
    }),
    ctx.prisma.user.findMany({
      where: {
        OR: [{ handle: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }]
      },
      select: { id: true }
    }),
    ctx.prisma.mediaAsset.findMany({
      where: { attribution: { contains: query, mode: "insensitive" } },
      select: { id: true }
    })
  ])
  return [...translations, ...users, ...media].map(({ id }) => id)
}

async function buildWhere(
  ctx: GraphQLContext,
  viewer: AiViewer,
  query: NormalizedAdminAiQuery
): Promise<Prisma.AiProcessWhereInput> {
  const conditions: Prisma.AiProcessWhereInput[] = [{ createdAt: { gte: query.from, lte: query.to } }]
  const { filters } = query
  if (filters.kind) conditions.push({ kind: filters.kind })
  if (filters.status) conditions.push({ status: filters.status })
  if (filters.verdict) conditions.push({ verdict: filters.verdict })
  if (filters.reason) conditions.push({ reasons: { path: ["categories"], array_contains: [filters.reason] } })
  if (filters.query) conditions.push({ objectId: { in: await searchedObjectIds(ctx, filters.query) } })
  if (viewer.scoped) {
    conditions.push({
      objectType: { in: [...ARTICLE_OBJECT_TYPES, ...USER_OBJECT_TYPES] },
      objectId: { in: await scopedObjectIds(ctx) }
    })
  }
  return { AND: conditions }
}

function reasonRows(value: Prisma.JsonValue | null): AdminAiReason[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") return [{ category: item, text: null }]
      if (!item || typeof item !== "object" || Array.isArray(item)) return []
      const category = typeof item.category === "string" ? item.category : null
      if (!category) return []
      return [{ category, text: typeof item.text === "string" ? item.text : null }]
    })
  }
  if (typeof value !== "object") return []
  const categories = Array.isArray(value.categories)
    ? value.categories.filter((category): category is string => typeof category === "string")
    : []
  const details =
    value.details && typeof value.details === "object" && !Array.isArray(value.details) ? value.details : {}
  return categories.map((category) => ({
    category,
    text: typeof details[category] === "string" ? details[category] : null
  }))
}

async function resolveObjects(
  ctx: GraphQLContext,
  records: readonly ProcessRecord[],
  viewer: AiViewer
): Promise<Map<string, AdminAiObject>> {
  const translationIds = records
    .filter(({ objectType }) => (ARTICLE_OBJECT_TYPES as readonly string[]).includes(objectType))
    .map(({ objectId }) => objectId)
  const userIds = records
    .filter(({ objectType }) => (USER_OBJECT_TYPES as readonly string[]).includes(objectType))
    .map(({ objectId }) => objectId)
  const mediaIds = records
    .filter(({ objectType }) => (MEDIA_OBJECT_TYPES as readonly string[]).includes(objectType))
    .map(({ objectId }) => objectId)

  const [translations, users, media] = await Promise.all([
    translationIds.length
      ? ctx.prisma.articleTranslation.findMany({
          where: { id: { in: translationIds } },
          select: {
            id: true,
            title: true,
            slug: true,
            locale: true,
            article: { select: { id: true, slug: true, status: true } }
          }
        })
      : [],
    userIds.length && viewer.role !== "analyst"
      ? ctx.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, handle: true }
        })
      : [],
    mediaIds.length
      ? ctx.prisma.mediaAsset.findMany({
          where: { id: { in: mediaIds } },
          select: { id: true, attribution: true, owner: { select: { handle: true } } }
        })
      : []
  ])

  const result = new Map<string, AdminAiObject>()
  for (const item of translations) {
    result.set(item.id, {
      id: item.id,
      type: "ArticleTranslation",
      title: item.title,
      subtitle: item.locale,
      href: `/admin/articles/${item.article.slug}`
    })
  }
  for (const item of users) {
    result.set(item.id, {
      id: item.id,
      type: "User",
      title: item.name,
      subtitle: `@${item.handle}`,
      href: viewer.role === "admin" || viewer.role === "owner" ? `/admin/users/${item.id}` : null
    })
  }
  for (const item of media) {
    result.set(item.id, {
      id: item.id,
      type: "MediaAsset",
      title: item.attribution,
      subtitle: `@${item.owner.handle}`,
      href: null
    })
  }
  return result
}

function presentProcess(record: ProcessRecord, objects: Map<string, AdminAiObject>, viewer: AiViewer): AdminAiProcess {
  const object =
    objects.get(record.objectId) ??
    (viewer.role === "analyst" && (USER_OBJECT_TYPES as readonly string[]).includes(record.objectType)
      ? { id: record.objectId, type: "User", title: "Profile check", subtitle: null, href: null }
      : { id: record.objectId, type: record.objectType, title: record.objectId, subtitle: null, href: null })

  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    verdict: record.verdict,
    object,
    reasons: reasonRows(record.reasons),
    providerErrorClass: record.providerErrorClass,
    model: record.model,
    promptVersion: record.promptVersion,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    durationMs: record.durationMs,
    jobHref:
      record.jobId && (viewer.role === "admin" || viewer.role === "owner")
        ? `/admin/jobs?id=${encodeURIComponent(record.jobId)}`
        : null
  }
}

export async function listAdminAiRecords(
  ctx: GraphQLContext,
  input: AdminAiQueryInput = {},
  now = new Date()
): Promise<AdminAiRecordsPage> {
  const viewer = ensureAiViewer(ctx, "admin.ai.read")
  const normalized = normalizeAdminAiQuery(input, ctx.requestId, now)
  const where = await buildWhere(ctx, viewer, normalized)
  const total = await ctx.prisma.aiProcess.count({ where })
  const { skip, take, pagination } = calculatePagination(normalized.page, normalized.limit, total)
  const records = await ctx.prisma.aiProcess.findMany({
    where,
    select: processSelect,
    orderBy:
      normalized.sort === "duration"
        ? [{ durationMs: "desc" }, { createdAt: "desc" }, { id: "desc" }]
        : [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take
  })
  const objects = await resolveObjects(ctx, records, viewer)
  return {
    items: records.map((record) => presentProcess(record, objects, viewer)),
    pagination,
    viewerRole: viewer.role
  }
}

export async function getAdminAiRecord(ctx: GraphQLContext, id: string): Promise<AdminAiProcess | null> {
  const viewer = ensureAiViewer(ctx, "admin.ai.read")
  const where: Prisma.AiProcessWhereInput = { id }
  if (viewer.scoped) {
    where.objectType = { in: [...ARTICLE_OBJECT_TYPES, ...USER_OBJECT_TYPES] }
    where.objectId = { in: await scopedObjectIds(ctx) }
  }
  const record = await ctx.prisma.aiProcess.findFirst({ where, select: processSelect })
  if (!record) return null
  const objects = await resolveObjects(ctx, [record], viewer)
  return presentProcess(record, objects, viewer)
}

export async function getAdminAiStats(
  ctx: GraphQLContext,
  period: AdminAiPeriodInput = {},
  now = new Date()
): Promise<AdminAiStats> {
  ensurePermission(ctx.currentUser, "finance", "admin.ai.stats", ctx.requestId)
  const normalized = normalizeAdminAiQuery({ filters: { period } }, ctx.requestId, now)
  const where: Prisma.AiProcessWhereInput = { createdAt: { gte: normalized.from, lte: normalized.to } }

  const [processCount, kindGroups, statusGroups, rows, cost] = await Promise.all([
    ctx.prisma.aiProcess.count({ where }),
    ctx.prisma.aiProcess.groupBy({ by: ["kind"], where, _count: { _all: true } }),
    ctx.prisma.aiProcess.groupBy({ by: ["status"], where, _count: { _all: true } }),
    ctx.prisma.aiProcess.findMany({
      where,
      select: { durationMs: true, reasons: true, providerErrorClass: true }
    }),
    ctx.prisma.aiCostAggregate.aggregate({
      where: { bucketStart: { gte: normalized.from }, bucketEnd: { lte: normalized.to } },
      _sum: { totalCostMinor: true, processCount: true }
    })
  ])

  const durations = rows
    .flatMap(({ durationMs }) => (typeof durationMs === "number" ? [durationMs] : []))
    .sort((left, right) => left - right)
  const middle = Math.floor(durations.length / 2)
  const medianDurationMs =
    durations.length === 0
      ? null
      : durations.length % 2 === 1
        ? durations[middle]!
        : Math.round((durations[middle - 1]! + durations[middle]!) / 2)

  const reasonCounts = new Map<string, number>()
  for (const row of rows) {
    for (const reason of reasonRows(row.reasons)) {
      reasonCounts.set(reason.category, (reasonCounts.get(reason.category) ?? 0) + 1)
    }
  }
  const rejectionReasons = [...reasonCounts.entries()]
    .map(([category, count]) => ({ category, count, share: processCount === 0 ? 0 : count / processCount }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category))
  const statuses = statusGroups.map((row) => ({ status: row.status, count: row._count._all }))

  return {
    processCount,
    totalCostMinor: (cost._sum.totalCostMinor ?? 0n).toString(),
    medianDurationMs,
    // Цена планов отложена до платного запуска; долю нельзя вычислять из неутверждённой цены.
    planSharePercent: null,
    kinds: kindGroups.map((row) => ({ kind: row.kind, count: row._count._all })),
    statuses,
    rejectionReasons,
    providerErrors: rows.filter(({ providerErrorClass }) => providerErrorClass !== null).length,
    periodFrom: normalized.from,
    periodTo: normalized.to
  }
}
