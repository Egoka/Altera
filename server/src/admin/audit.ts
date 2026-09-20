/**
 * Раздел аудита `/admin/audit` (`docs/spec/40-admin/audit-log.md`).
 *
 * Журнал только читается: список, карточка и сводка не пишут в `AuditLog` — рекурсивного «аудита
 * просмотра аудита» нет (журнал §27.5 п. 5). Единственная запись раздела — `stats.export` (#40)
 * при экспорте CSV. Вся авторизация и все фильтры применяются до запроса в Prisma.
 */
import type { Role } from "../generated/prisma"
import {
  AUDIT_EVENT_CODES,
  auditCodesForZone,
  auditZonesForCode,
  isAuditZone,
  ROLE_AUDIT_ZONE,
  type AuditZone
} from "../audit/registry"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, ensurePermission, ensureRole } from "../exceptions/permissions"
import type { GraphQLContext } from "../prisma"
import { RATE_LIMIT_RULES } from "../rate-limits"

/** `audit-log.md` §4: период по умолчанию — 7 дней `[ДОПУЩЕНИЕ]`. */
export const AUDIT_DEFAULT_PERIOD_DAYS = 7
/** `audit-log.md` §4: `limit` 20, максимум 100. */
export const AUDIT_DEFAULT_LIMIT = 20
export const AUDIT_MAX_LIMIT = 100
/**
 * `rate-limits.md` §2 п. 12: экспорт CSV — 10 в час на сотрудника `[ДОПУЩЕНИЕ]`. Порог и окно
 * берутся из единого реестра корзин: второго числа для того же лимита в проекте нет.
 * Счёт идёт по собственным записям `stats.export` в журнале аудита — это уже неизменяемый след
 * действия, и скользящее окно по нему точнее фиксированного окна счётчика.
 */
export const AUDIT_EXPORT_LIMIT_PER_HOUR = RATE_LIMIT_RULES["admin.export.user"].limit
export const AUDIT_EXPORT_WINDOW_MS = RATE_LIMIT_RULES["admin.export.user"].windowSeconds * 1000
/** Код экспорта аудита — `stats.export` (#40, `audit-log.md` §4 `[ДОПУЩЕНИЕ: тот же]`). */
export const AUDIT_EXPORT_ACTION = "stats.export"
/** Верхняя граница выгрузки одного файла `[ДОПУЩЕНИЕ]`: спецификация числа строк не задаёт. */
export const AUDIT_EXPORT_MAX_ROWS = 1000

export interface AuditFilters {
  zone?: string | null
  action?: string | null
  actorId?: string | null
  /** Только автоматические записи: актора нет («система»). */
  actorSystem?: boolean | null
  entityType?: string | null
  entityId?: string | null
  subject?: string | null
  requestId?: string | null
  from?: string | null
  to?: string | null
}

export interface AuditActor {
  id: string | null
  role: Role | null
  /** Служебное имя актора; `null` — автоматическая запись («система»). */
  name: string | null
  isSystem: boolean
}

export interface AuditListEntry {
  id: string
  action: string
  createdAt: Date
  actor: AuditActor
  entityType: string
  entityId: string
  requestId: string | null
  zones: readonly AuditZone[]
  /** Краткое описание изменения: имена полей `diff` без значений — в списке ПД не показываются. */
  changedFields: string[]
}

export interface AuditEntryDetail extends AuditListEntry {
  diff: unknown
  subject: string | null
  context: string | null
  purpose: string | null
}

export interface AuditLogPage {
  entries: AuditListEntry[]
  nextCursor: string | null
  zone: AuditZone | null
  canExport: boolean
  /** Коды, доступные роли: набор реестра целиком либо коды её зоны (`audit-log.md` §4). */
  availableActions: string[]
}

export interface AuditSummaryBucket {
  key: string
  label: string | null
  count: number
}

export interface AuditSummary {
  total: number
  byAction: AuditSummaryBucket[]
  byActor: AuditSummaryBucket[]
}

export interface AuditExport {
  filename: string
  contentType: string
  rows: number
  csv: string
}

interface AuditRow {
  id: string
  action: string
  actorId: string | null
  actorRole: Role | null
  entityType: string
  entityId: string
  diff: unknown
  subject: string | null
  context: string | null
  purpose: string | null
  requestId: string | null
  createdAt: Date
}

type ServiceRole = Extract<Role, "editor" | "moderator" | "analyst" | "admin" | "owner">

const fullJournalRoles = new Set<Role>(["admin", "owner"])
const exportRoles = new Set<Role>(["admin", "owner"])

function ensureAuditReader(ctx: GraphQLContext, action: string) {
  // Матрица #92 `audit.read`: раздел доступен служебным ролям, ошибка доступа — FORBIDDEN.
  ensurePermission(ctx.currentUser, "admin.enter", action, ctx.requestId)
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  return { ...user, role: user.role as ServiceRole }
}

function parseDate(value: string | null | undefined, field: string, requestId: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw createApiError("VALIDATION_ERROR", { requestId, field, rule: "iso-date" })
  }
  return parsed
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

/** Курсор — пара (`createdAt`, `id`): на равных отметках времени порядок остаётся строгим. */
export function encodeAuditCursor(entry: { createdAt: Date; id: string }): string {
  return `${entry.createdAt.toISOString()}|${entry.id}`
}

function decodeAuditCursor(cursor: string, requestId: string): { createdAt: Date; id: string } {
  const separator = cursor.indexOf("|")
  const createdAt = separator > 0 ? new Date(cursor.slice(0, separator)) : new Date(Number.NaN)
  const id = separator > 0 ? cursor.slice(separator + 1) : ""
  if (Number.isNaN(createdAt.getTime()) || !id) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "cursor", rule: "createdAt-id-pair" })
  }
  return { createdAt, id }
}

function resolveZone(role: ServiceRole, requested: string | null | undefined, requestId: string): AuditZone | null {
  const ownZone = ROLE_AUDIT_ZONE[role] ?? null

  if (requested === undefined || requested === null || requested === "") {
    // По умолчанию служебная роль видит свою зону, `admin` и `owner` — весь журнал (журнал #39).
    return ownZone
  }
  if (!isAuditZone(requested)) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "zone", rule: "known-zone" })
  }
  if (!fullJournalRoles.has(role) && requested !== ownZone) {
    // Запрошенная чужая зона не расширяет видимость: остаётся своя (`audit-log.md` §9).
    return ownZone
  }
  return requested
}

function buildWhere(
  filters: AuditFilters,
  role: ServiceRole,
  zone: AuditZone | null,
  requestId: string,
  now: Date
): Record<string, unknown> {
  const from =
    parseDate(filters.from, "from", requestId) ?? new Date(now.getTime() - AUDIT_DEFAULT_PERIOD_DAYS * 86_400_000)
  const to = parseDate(filters.to, "to", requestId)
  if (to && to < from) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "to", rule: "after-from" })
  }

  const where: Record<string, unknown> = { createdAt: to ? { gte: from, lte: to } : { gte: from } }

  const action = normalizeText(filters.action)
  const zoneCodes = zone ? auditCodesForZone(zone) : null
  if (action && zoneCodes && !zoneCodes.includes(action)) {
    // Код вне зоны не раскрывается: выдача пуста, а не чужая зона.
    where.action = { in: [] as string[] }
  } else if (action) {
    where.action = action
  } else if (zoneCodes) {
    where.action = { in: zoneCodes }
  }

  const actorId = normalizeText(filters.actorId)
  if (filters.actorSystem) where.actorId = null
  else if (actorId) where.actorId = actorId

  const entityType = normalizeText(filters.entityType)
  if (entityType) where.entityType = entityType
  const entityId = normalizeText(filters.entityId)
  if (entityId) where.entityId = entityId
  const subject = normalizeText(filters.subject)
  if (subject) where.subject = subject
  const filterRequestId = normalizeText(filters.requestId)
  if (filterRequestId) where.requestId = filterRequestId

  return where
}

function diffFields(diff: unknown): string[] {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return []
  return Object.keys(diff as Record<string, unknown>)
}

async function loadActorNames(ctx: GraphQLContext, rows: readonly AuditRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap((row) => (row.actorId ? [row.actorId] : [])))]
  if (ids.length === 0) return new Map()

  const actors = await ctx.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
  return new Map(actors.map((actor) => [actor.id, actor.name]))
}

function toListEntry(row: AuditRow, actorNames: Map<string, string>): AuditListEntry {
  return {
    id: row.id,
    action: row.action,
    createdAt: row.createdAt,
    actor: {
      id: row.actorId,
      role: row.actorRole,
      name: row.actorId ? (actorNames.get(row.actorId) ?? null) : null,
      isSystem: row.actorId === null
    },
    entityType: row.entityType,
    entityId: row.entityId,
    requestId: row.requestId,
    zones: auditZonesForCode(row.action),
    changedFields: diffFields(row.diff)
  }
}

export async function listAuditLog(
  ctx: GraphQLContext,
  filters: AuditFilters = {},
  pagination: { limit?: number | null; cursor?: string | null } = {},
  now = new Date()
): Promise<AuditLogPage> {
  const actor = ensureAuditReader(ctx, "audit.read")
  const zone = resolveZone(actor.role, filters.zone, ctx.requestId)

  const limit = pagination.limit ?? AUDIT_DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_MAX_LIMIT) {
    throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "limit", rule: "1-100" })
  }

  const where = buildWhere(filters, actor.role, zone, ctx.requestId, now)
  if (pagination.cursor) {
    const cursor = decodeAuditCursor(pagination.cursor, ctx.requestId)
    where.OR = [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }]
  }

  const rows = (await ctx.prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1
  })) as AuditRow[]

  const page = rows.slice(0, limit)
  const actorNames = await loadActorNames(ctx, page)
  const last = page[page.length - 1]

  return {
    entries: page.map((row) => toListEntry(row, actorNames)),
    nextCursor: rows.length > limit && last ? encodeAuditCursor(last) : null,
    zone,
    canExport: exportRoles.has(actor.role),
    availableActions: (zone ? auditCodesForZone(zone) : [...AUDIT_EVENT_CODES]).sort()
  }
}

export async function getAuditEntry(ctx: GraphQLContext, id: string): Promise<AuditEntryDetail> {
  const actor = ensureAuditReader(ctx, "audit.read")
  const row = (await ctx.prisma.auditLog.findUnique({ where: { id } })) as AuditRow | null

  // Запись вне зоны служебной роли неотличима от несуществующей (`audit-log.md` §2 `[ДОПУЩЕНИЕ]`).
  const zone = ROLE_AUDIT_ZONE[actor.role] ?? null
  const visible = row && (fullJournalRoles.has(actor.role) || (zone && auditZonesForCode(row.action).includes(zone)))
  if (!row || !visible) {
    throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "auditEntry" })
  }

  const actorNames = await loadActorNames(ctx, [row])
  return {
    ...toListEntry(row, actorNames),
    diff: row.diff ?? null,
    subject: row.subject,
    context: row.context,
    purpose: row.purpose
  }
}

export async function getAuditSummary(
  ctx: GraphQLContext,
  filters: AuditFilters = {},
  now = new Date()
): Promise<AuditSummary> {
  const actor = ensureAuditReader(ctx, "audit.read")
  const zone = resolveZone(actor.role, filters.zone, ctx.requestId)
  const where = buildWhere(filters, actor.role, zone, ctx.requestId, now)

  const [byAction, byActor] = await Promise.all([
    ctx.prisma.auditLog.groupBy({ by: ["action"], where, _count: { _all: true } }),
    ctx.prisma.auditLog.groupBy({ by: ["actorId"], where, _count: { _all: true } })
  ])

  const actorIds = byActor.flatMap((bucket) => (bucket.actorId ? [bucket.actorId] : []))
  const actorNames =
    actorIds.length > 0
      ? new Map(
          (await ctx.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map(
            (row) => [row.id, row.name]
          )
        )
      : new Map<string, string>()

  const actionBuckets = byAction
    .map((bucket) => ({ key: bucket.action, label: null, count: bucket._count._all }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
  const actorBuckets = byActor
    .map((bucket) => ({
      key: bucket.actorId ?? "system",
      label: bucket.actorId ? (actorNames.get(bucket.actorId) ?? null) : null,
      count: bucket._count._all
    }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))

  return {
    total: actionBuckets.reduce((sum, bucket) => sum + bucket.count, 0),
    byAction: actionBuckets,
    byActor: actorBuckets
  }
}

/**
 * CSV без полей с персональными данными: время, код, роль актора, признак «система», тип сущности и
 * `requestId`. `actorId`, `entityId`, `subject`, `context`, `purpose` и `diff` в файл не попадают
 * (`audit-log.md` §5, критерий задачи «экспорт без полей с ПД»).
 */
export const AUDIT_CSV_COLUMNS = ["createdAt", "action", "actorRole", "actorKind", "entityType", "requestId"] as const

function csvCell(value: string | null): string {
  const text = value ?? ""
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildAuditCsv(rows: readonly AuditRow[]): string {
  const lines = [AUDIT_CSV_COLUMNS.join(",")]
  for (const row of rows) {
    lines.push(
      [
        row.createdAt.toISOString(),
        row.action,
        row.actorRole ?? "",
        row.actorId ? "staff" : "system",
        row.entityType,
        row.requestId ?? ""
      ]
        .map((value) => csvCell(value))
        .join(",")
    )
  }
  return `${lines.join("\n")}\n`
}

export async function exportAuditCsv(
  ctx: GraphQLContext,
  filters: AuditFilters = {},
  now = new Date()
): Promise<AuditExport> {
  // `audit-log.md` §1, §5, §9: экспорт — только `admin` и `owner` (`[ДОПУЩЕНИЕ: analyst без экспорта]`).
  ensureRole(ctx.currentUser, "admin", AUDIT_EXPORT_ACTION, ctx.requestId)
  const actor = ensureAuditReader(ctx, AUDIT_EXPORT_ACTION)

  const windowStart = new Date(now.getTime() - AUDIT_EXPORT_WINDOW_MS)
  const recentExports = await ctx.prisma.auditLog.findMany({
    where: { action: AUDIT_EXPORT_ACTION, actorId: actor.id, createdAt: { gte: windowStart } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true }
  })
  if (recentExports.length >= AUDIT_EXPORT_LIMIT_PER_HOUR) {
    const oldest = recentExports[0]?.createdAt ?? windowStart
    const retryAfter = Math.max(1, Math.ceil((oldest.getTime() + AUDIT_EXPORT_WINDOW_MS - now.getTime()) / 1000))
    // Попадание в корзину логируется так же, как у остальных лимитов (`rate-limits.md` §2 п. 1,
    // реестр событий #44). Адреса у административного действия в корзине нет: ключ — сотрудник.
    ctx.logger.log({
      level: "warn",
      event: "rate_limit.hit",
      requestId: ctx.requestId,
      message: "Rate limit exceeded",
      data: { bucket: RATE_LIMIT_RULES["admin.export.user"].bucket, ipHash: null }
    })
    throw createApiError("RATE_LIMITED", { requestId: ctx.requestId, retryAfter })
  }

  const zone = resolveZone(actor.role, filters.zone, ctx.requestId)
  const where = buildWhere(filters, actor.role, zone, ctx.requestId, now)
  const rows = (await ctx.prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: AUDIT_EXPORT_MAX_ROWS
  })) as AuditRow[]

  const csv = buildAuditCsv(rows)
  await ctx.prisma.auditLog.create({
    data: {
      action: AUDIT_EXPORT_ACTION,
      actorId: actor.id,
      actorRole: actor.role as Role,
      entityType: "auditLog",
      entityId: "export",
      // Поля строки #40 реестра: отчёт и число строк. Значения фильтра с ПД не сохраняются.
      diff: { report: "audit", rows: rows.length },
      requestId: ctx.requestId
    }
  })

  return {
    filename: `audit-${now.toISOString().slice(0, 10)}.csv`,
    contentType: "text/csv",
    rows: rows.length,
    csv
  }
}
