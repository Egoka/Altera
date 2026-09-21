import type { PlanTier } from "../generated/prisma"
import { deriveGrantStatus } from "../admin/grants"

/**
 * Карточка плана сводки кабинета (`docs/spec/30-account/reader/dashboard.md` §4, §5 зона 3).
 *
 * Источник истины — выдачи `PlanGrant`, а не кэш `users.planTier`: административная выдача кэш
 * не обновляет, а роль и план выводятся из выдач (role-derivation.md п. 1, 9). Платежей на
 * первом запуске нет (журнал §24.1), поэтому варианты «серия списаний» и `cancelAtPeriodEnd`
 * здесь не появляются: их не из чего вывести.
 */
export type AccountPlanState = "free" | "base" | "active" | "expired"

export interface AccountPlanGrant {
  tier: PlanTier
  startsAt: Date
  endsAt: Date | null
  revokedAt: Date | null
}

export interface AccountPlanPeriod {
  tier: PlanTier
  startsAt: Date
  endsAt: Date | null
}

export interface AccountSubscriptionView {
  state: AccountPlanState
  tier: PlanTier
  until: Date | null
  endedAt: Date | null
  queue: AccountPlanPeriod[]
}

// Порядок приоритета периодов — журнал §8.22: `pro` действует раньше `standard`.
const TIER_PRIORITY: Record<PlanTier, number> = { pro: 2, standard: 1, free: 0 }

const endTime = (value: Date | null) => (value ? value.getTime() : Number.POSITIVE_INFINITY)

const byPriority = (left: AccountPlanGrant, right: AccountPlanGrant) =>
  TIER_PRIORITY[right.tier] - TIER_PRIORITY[left.tier] || endTime(right.endsAt) - endTime(left.endsAt)

const toPeriod = (grant: AccountPlanGrant): AccountPlanPeriod => ({
  tier: grant.tier,
  startsAt: grant.startsAt,
  endsAt: grant.endsAt
})

/**
 * Действует период с наивысшим приоритетом; остальные действующие и будущие выдачи — очередь
 * «затем: …» (журнал §8.22). Бессрочная выдача — базовая выдача первого запуска (plan-free.md
 * п. 6а): административная выдача всегда имеет срок (`grantPlan` требует `endsAt`).
 */
export function deriveAccountSubscription(grants: readonly AccountPlanGrant[], now: Date): AccountSubscriptionView {
  const live = grants.filter((grant) => {
    const status = deriveGrantStatus(grant, now)
    return status === "active" || status === "queued"
  })
  const active = live.filter((grant) => deriveGrantStatus(grant, now) === "active").sort(byPriority)
  const current = active[0] ?? null

  const queue = live
    .filter((grant) => grant !== current)
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime() || byPriority(left, right))
    .map(toPeriod)

  if (current) {
    return {
      state: current.endsAt === null ? "base" : "active",
      tier: current.tier,
      until: current.endsAt,
      endedAt: null,
      queue
    }
  }

  // Истёкшая или отозванная выдача не превращается в бесплатное авторство (plan-free.md п. 3–4).
  // Выдача, отозванная до начала, периодом не была и истёкшим план не делает.
  const endings = grants
    .map((grant) => {
      const ending = grant.revokedAt ?? grant.endsAt
      return ending && ending > grant.startsAt ? ending : null
    })
    .filter((value): value is Date => value !== null && value <= now)
    .sort((left, right) => right.getTime() - left.getTime())

  return {
    state: endings.length > 0 ? "expired" : "free",
    tier: "free",
    until: null,
    endedAt: endings[0] ?? null,
    queue
  }
}
