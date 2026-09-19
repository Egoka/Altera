/**
 * Фильтры раздела аудита живут в адресе страницы: серверных сохранённых представлений нет
 * (`docs/spec/40-admin/audit-log.md` §5 — «Сохранить фильтр»). Здесь разбор и сборка `?…`.
 */
import type { AuditLogFilters, AuditZone } from "~/graphql/generated/graphql"

export const AUDIT_ZONES: readonly AuditZone[] = ["editorial", "moderation", "financeAndPd"]
/** `audit-log.md` §4: период по умолчанию — 7 дней `[ДОПУЩЕНИЕ]`. */
export const AUDIT_PERIOD_PRESETS = ["7d", "30d", "90d"] as const
export const AUDIT_DEFAULT_PERIOD = "7d"

export type AuditPeriodPreset = (typeof AUDIT_PERIOD_PRESETS)[number]

export interface AuditQueryState {
  zone: AuditZone | null
  action: string
  actor: string
  /** Только автоматические записи («система»). */
  system: boolean
  entityType: string
  entityId: string
  subject: string
  requestId: string
  /** Пресет `7d` / `30d` / `90d` либо диапазон `ГГГГ-ММ-ДД..ГГГГ-ММ-ДД`. */
  period: string
  entryId: string
}

const DATE_RANGE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

const isPreset = (value: string): value is AuditPeriodPreset =>
  (AUDIT_PERIOD_PRESETS as readonly string[]).includes(value)

export const isAuditZone = (value: unknown): value is AuditZone =>
  typeof value === "string" && (AUDIT_ZONES as readonly string[]).includes(value)

export const parseAuditQuery = (query: Record<string, unknown>): AuditQueryState => {
  const period = text(query.period)

  return {
    zone: isAuditZone(query.zone) ? query.zone : null,
    action: text(query.action),
    actor: text(query.actor),
    system: text(query.actor) === "system" || query.system === "1",
    entityType: text(query.entity).split(":")[0] ?? "",
    entityId: text(query.entity).includes(":") ? text(query.entity).slice(text(query.entity).indexOf(":") + 1) : "",
    subject: text(query.subject),
    requestId: text(query.requestId),
    period: isPreset(period) || DATE_RANGE.test(period) ? period : AUDIT_DEFAULT_PERIOD,
    entryId: text(query.id)
  }
}

/** Адрес страницы: пустые фильтры в запрос не попадают, чтобы ссылку можно было передать. */
export const buildAuditQuery = (state: AuditQueryState): Record<string, string> => {
  const query: Record<string, string> = {}
  if (state.zone) query.zone = state.zone
  if (state.action) query.action = state.action
  if (state.system) query.actor = "system"
  else if (state.actor) query.actor = state.actor
  if (state.entityType) query.entity = state.entityId ? `${state.entityType}:${state.entityId}` : state.entityType
  if (state.subject) query.subject = state.subject
  if (state.requestId) query.requestId = state.requestId
  if (state.period && state.period !== AUDIT_DEFAULT_PERIOD) query.period = state.period
  if (state.entryId) query.id = state.entryId
  return query
}

export const auditPeriodRange = (period: string, now: Date): { from: string; to: string | null } => {
  const range = DATE_RANGE.exec(period)
  if (range) {
    return { from: `${range[1]}T00:00:00.000Z`, to: `${range[2]}T23:59:59.999Z` }
  }

  const days = period === "30d" ? 30 : period === "90d" ? 90 : 7
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: null }
}

export const toAuditFilters = (state: AuditQueryState, now: Date): AuditLogFilters => {
  const { from, to } = auditPeriodRange(state.period, now)

  return {
    zone: state.zone,
    action: state.action || null,
    actorId: state.system ? null : state.actor || null,
    actorSystem: state.system ? true : null,
    entityType: state.entityType || null,
    entityId: state.entityId || null,
    subject: state.subject || null,
    requestId: state.requestId || null,
    from,
    to
  }
}

/** Ссылка «перейти к сущности» из карточки записи; неизвестный тип ссылки не получает. */
export const auditEntityLink = (entityType: string, entityId: string): string | null => {
  const routes: Record<string, string> = {
    user: "/admin/users",
    planGrant: "/admin/grants",
    subscription: "/admin/subscriptions",
    payment: "/admin/payments",
    section: "/admin/sections",
    format: "/admin/sections?tab=formats",
    tag: "/admin/tags",
    article: "/admin/articles"
  }
  const base = routes[entityType]
  if (!base) return null
  return entityType === "user" ? `${base}/${entityId}` : base
}
