/**
 * Реестр утверждённых audit-кодов и их зон видимости.
 *
 * Набор кодов повторяет утверждённые строки типа `audit` реестра
 * `docs/spec/00-registries/events-and-logs.md` — биекция проверяется тестом
 * `server/tests/audit-zone-registry.test.ts`, поэтому реестр нельзя рассинхронизировать вручную.
 *
 * Зоны — темы `docs/spec/50-access/visibility.md` п. 10 (журнал #39): `editor` — редакционные
 * статьи, `moderator` — решения по материалам и AI, `analyst` — финансы, чтения ПДн, AI-метрики.
 * Спецификация не перечисляет зону каждого кода по отдельности, поэтому распределение ниже —
 * `[ДОПУЩЕНИЕ]`, выведенное из темы зоны и колонок «Кто инициирует» / «Файл» реестра событий;
 * ссылки на номера строк реестра стоят у каждой группы. Код без зоны закрыт для служебных ролей:
 * его видят только `admin` и `owner` (журнал #39).
 */

export const AUDIT_ZONES = ["editorial", "moderation", "financeAndPd"] as const

export type AuditZone = (typeof AUDIT_ZONES)[number]

const EDITORIAL: readonly AuditZone[] = ["editorial"]
const MODERATION: readonly AuditZone[] = ["moderation"]
const FINANCE_AND_PD: readonly AuditZone[] = ["financeAndPd"]
const EDITORIAL_AND_MODERATION: readonly AuditZone[] = ["editorial", "moderation"]
const MODERATION_AND_FINANCE: readonly AuditZone[] = ["moderation", "financeAndPd"]
const ADMIN_ONLY: readonly AuditZone[] = []

export const AUDIT_CODE_ZONES: Readonly<Record<string, readonly AuditZone[]>> = {
  // Реестр #27: архив и восстановление материала — редакционная зона (`editor` по редакционным
  // статьям) и решение по материалу (`moderator`, журнал #53).
  "article.archive": EDITORIAL_AND_MODERATION,
  "article.restore": EDITORIAL_AND_MODERATION,
  // Реестр #34: замена медиафайла материала — автор и `editor` по своим.
  "media.replace": EDITORIAL,

  // Реестр #24, #25, #69, #70: решения по материалам.
  "translation.publish.manual": MODERATION,
  "translation.rework.request": MODERATION,
  "translation.unpublish": MODERATION,
  "translation.reject.final": MODERATION,
  "review.message": MODERATION,
  // Реестр #85: решение по профилю — `moderator`, `owner`.
  "profile.check": MODERATION,
  // Реестр #71: вердикт AI — решение по материалу и AI-метрика (матрица #8, #75: `ai.read` —
  // `moderator`, `analyst`, `admin`, `owner`).
  "ai.decision": MODERATION_AND_FINANCE,

  // Реестр #18–#23, #40, #73, #74, #90: финансы, планы и платёжные операции.
  "plan.grant": FINANCE_AND_PD,
  "plan.revoke": FINANCE_AND_PD,
  "plan.update": FINANCE_AND_PD,
  "subscription.grant": FINANCE_AND_PD,
  "subscription.change": FINANCE_AND_PD,
  "subscription.cancel": FINANCE_AND_PD,
  "subscription.extend.manual": FINANCE_AND_PD,
  "subscription.price.confirmed": FINANCE_AND_PD,
  "subscription.price.declined": FINANCE_AND_PD,
  "payment.refund": FINANCE_AND_PD,
  "refund.rejected": FINANCE_AND_PD,
  // Строка #21 помечена «audit (лог для `requested`)»: сам `refund.requested` пишется логом и в
  // журнале не появляется. Зона сохранена, чтобы реестр совпадал со строкой спецификации.
  "refund.requested": FINANCE_AND_PD,
  "payment.exclude": FINANCE_AND_PD,
  "payment.include": FINANCE_AND_PD,
  "promo.create": FINANCE_AND_PD,
  "promo.disable": FINANCE_AND_PD,
  "webhook.replay": FINANCE_AND_PD,
  "stats.export": FINANCE_AND_PD,
  // Реестр #67: чтение персональных данных — прямо названная тема зоны `analyst`.
  "admin.read.personal": FINANCE_AND_PD,

  // Ниже — коды без зоны: служебные записи, роли, права, настройки, задания, таксономия и
  // жизненный цикл аккаунтов. Для служебной роли они закрыты, полный журнал — `admin` и `owner`.
  "user.role.change": ADMIN_ONLY,
  "user.archive": ADMIN_ONLY,
  "user.restore": ADMIN_ONLY,
  "user.archive.self": ADMIN_ONLY,
  "user.restore.self": ADMIN_ONLY,
  "user.sessions.revoke": ADMIN_ONLY,
  "user.email.change": ADMIN_ONLY,
  "user.create.staff": ADMIN_ONLY,
  "user.appeal.submit": ADMIN_ONLY,
  "user.appeal.decide": ADMIN_ONLY,
  "author.enabled": ADMIN_ONLY,
  "role.assign.owner": ADMIN_ONLY,
  "role.revoke.owner": ADMIN_ONLY,
  "owner.deactivate": ADMIN_ONLY,
  "permission.exception.grant": ADMIN_ONLY,
  "permission.exception.revoke": ADMIN_ONLY,
  "permission.exception.expire": ADMIN_ONLY,
  "section.update": ADMIN_ONLY,
  "section.archive": ADMIN_ONLY,
  "section.restore": ADMIN_ONLY,
  "format.update": ADMIN_ONLY,
  "tag.merge": ADMIN_ONLY,
  "tag.archive": ADMIN_ONLY,
  "tag.restore": ADMIN_ONLY,
  "job.retry": ADMIN_ONLY,
  "job.cancel": ADMIN_ONLY,
  "legal.update": ADMIN_ONLY,
  "settings.change": ADMIN_ONLY,
  "secrets.rotate": ADMIN_ONLY,
  "entity.delete.permanent": ADMIN_ONLY,
  "revision.restore": ADMIN_ONLY,
  "translation.reedit": ADMIN_ONLY,
  "engagement.exclusion": ADMIN_ONLY,
  "admin.change": ADMIN_ONLY
}

export const AUDIT_EVENT_CODES = Object.keys(AUDIT_CODE_ZONES) as readonly string[]

/** Роль → её зона. `admin` и `owner` зонного ограничения не имеют (журнал #39). */
export const ROLE_AUDIT_ZONE: Readonly<Record<string, AuditZone>> = {
  editor: "editorial",
  moderator: "moderation",
  analyst: "financeAndPd"
}

export function isAuditZone(value: unknown): value is AuditZone {
  return typeof value === "string" && AUDIT_ZONES.includes(value as AuditZone)
}

/** Коды, видимые в зоне. Код без зоны в выдачу не попадает. */
export function auditCodesForZone(zone: AuditZone): string[] {
  return AUDIT_EVENT_CODES.filter((code) => AUDIT_CODE_ZONES[code]?.includes(zone))
}

/** Зона кода для выдачи; неизвестный или незакреплённый код зоны не имеет. */
export function auditZonesForCode(action: string): readonly AuditZone[] {
  return AUDIT_CODE_ZONES[action] ?? []
}
