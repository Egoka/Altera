import type { PlanTier, Role } from "../generated/prisma"
import { deriveAccountSubscription, type AccountPlanGrant } from "../account/dashboard"

/**
 * Кэш плана пользователя (`role-derivation.md` п. 1): источник истины — выдачи `PlanGrant`,
 * а `User.role`, `User.planTier` и `User.planUntil` — производные значения для проверок прав.
 * Расхождение кэша с выдачами — ошибка инварианта (п. 9), поэтому каждая транзакция, меняющая
 * выдачи, пересчитывает кэш здесь, а не своим набором правил.
 */
export interface PlanCacheValue {
  planTier: PlanTier
  planUntil: Date | null
}

export interface PlanCacheUpdate extends PlanCacheValue {
  role?: Role
}

/** Роль от плана зависит только у читателя и автора; служебные роли планом не управляются (п. 6). */
const planDrivenRoles = new Set<Role>(["reader", "author"])

/**
 * Действующий период и его уровень считает `deriveAccountSubscription` (журнал §8.22): приоритет
 * периодов и бессрочная базовая выдача там уже разобраны. Кэш берёт из него уровень и срок:
 * `base` — бессрочная выдача (`planUntil = NULL`), `active` — срочная, остальное — `free`.
 */
export function derivePlanCache(grants: readonly AccountPlanGrant[], now: Date): PlanCacheValue {
  const view = deriveAccountSubscription(grants, now)
  if (view.state === "base" || view.state === "active") {
    return { planTier: view.tier, planUntil: view.until }
  }
  return { planTier: "free", planUntil: null }
}

/**
 * Кэш вместе с ролью для конкретного аккаунта. Инвариант «`role = author` ⇔ действующая выдача»
 * (п. 1, 7) поддерживается только для читателя и автора: у служебной записи роль остаётся своей.
 */
export function derivePlanCacheUpdate(
  current: { role: Role; isServiceAccount?: boolean },
  grants: readonly AccountPlanGrant[],
  now: Date
): PlanCacheUpdate {
  const cache = derivePlanCache(grants, now)
  if (current.isServiceAccount || !planDrivenRoles.has(current.role)) return cache
  return { ...cache, role: cache.planTier === "free" ? "reader" : "author" }
}

interface PlanCacheClient {
  user: {
    findUnique(args: {
      where: { id: string }
      select: { role: true; isServiceAccount: true }
    }): Promise<{ role: Role; isServiceAccount: boolean } | null>
    update(args: { where: { id: string }; data: PlanCacheUpdate }): Promise<unknown>
  }
  planGrant: {
    findMany(args: {
      where: { userId: string }
      select: { tier: true; startsAt: true; endsAt: true; revokedAt: true }
    }): Promise<AccountPlanGrant[]>
  }
}

/**
 * Пересчёт кэша по всем выдачам аккаунта внутри переданной транзакции: выдача, отзыв и
 * автоматическое открытие базового авторства сохраняют кэш согласованным в том же коммите
 * (`role-derivation.md` п. 2–3).
 */
export async function syncPlanCache(tx: PlanCacheClient, userId: string, now: Date): Promise<PlanCacheUpdate | null> {
  const current = await tx.user.findUnique({ where: { id: userId }, select: { role: true, isServiceAccount: true } })
  if (!current) return null

  const grants = await tx.planGrant.findMany({
    where: { userId },
    select: { tier: true, startsAt: true, endsAt: true, revokedAt: true }
  })
  const data = derivePlanCacheUpdate(current, grants, now)
  await tx.user.update({ where: { id: userId }, data })
  return data
}
