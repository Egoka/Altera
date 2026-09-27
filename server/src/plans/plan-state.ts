import type { PlanTier } from "../generated/prisma"
import { hasActiveAuthorPlan } from "../exceptions/permissions"

/**
 * Чистые правила плана: состояние выдачи, отличие базовой выдачи первого запуска от админской и
 * публичный бейдж грейда. Модуль не обращается к базе, поэтому им пользуются и раздел грантов, и
 * кабинет, и публичные резолверы без перекрёстных импортов.
 */
export type GrantStatus = "queued" | "active" | "ended" | "revoked"

export interface GrantPeriod {
  startsAt: Date
  endsAt: Date | null
  revokedAt: Date | null
}

export function deriveGrantStatus(grant: GrantPeriod, now: Date): GrantStatus {
  if (grant.revokedAt) return "revoked"
  if (grant.startsAt > now) return "queued"
  if (grant.endsAt && grant.endsAt <= now) return "ended"
  return "active"
}

/**
 * Базовая выдача первого запуска (`plan-free.md` п. 6а): бессрочная и без выдавшего сотрудника —
 * автоматическая разблокировка, а не тариф. Админская выдача всегда срочная (`grantPlan` требует
 * `endsAt`) и всегда хранит сотрудника, поэтому пара признаков их различает однозначно.
 */
export function isBaseGrant(grant: { endsAt: Date | null; grantedById: string | null }): boolean {
  return grant.endsAt === null && grant.grantedById === null
}

/**
 * Фильтр «всё, кроме базовых выдач» для раздела грантов админки (журнал §27.1): отдельных списков
 * автоматических выдач и ручного отзыва в «Грантах» не нужно.
 */
export const adminGrantWhere = () => ({ NOT: { endsAt: null, grantedById: null } })

export type AuthorGrade = "standard" | "pro"

/**
 * Бейдж уровня автора (ADR-0037, журнал §21.18): `pro` показывается только по действующему плану.
 * Истёкшая выдача `pro` бейдж снимает — срок читается вместе с уровнем, поэтому устаревший кэш
 * `planTier` не переживает окончание выдачи (`role-derivation.md` п. 9).
 */
export function authorGradeOf(user: { planTier: PlanTier | string; planUntil: Date | null }, now: Date): AuthorGrade {
  if (user.planTier !== "pro") return "standard"
  return hasActiveAuthorPlan({ planTier: "pro", planUntil: user.planUntil }, now) ? "pro" : "standard"
}
