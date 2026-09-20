import type { Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, hasActiveAuthorPlan } from "../exceptions/permissions"
import type { GraphQLContext } from "../prisma"

// Бессрочная базовая выдача первого запуска (plan-free.md п. 6а, журнал §25.1):
// tier standard, без срока и без выдавшего сотрудника — автоматическая разблокировка, а не тариф.
export const BASE_AUTHORSHIP_REASON = "base authorship: first article"

type AuthorshipActor = NonNullable<GraphQLContext["currentUser"]>
type BaseAuthorshipContext = Pick<GraphQLContext, "prisma" | "currentUser" | "requestId">

const personalAuthoringRoles = new Set<Role>(["reader", "author"])

/**
 * Первое «Создать статью» бессрочно открывает базовые авторские возможности без оплаты и
 * ручного одобрения (become-author.md шаг 1, ADR-0052 п. 2).
 *
 * «Первое нажатие» — аккаунт, у которого ещё не было ни одного `PlanGrant`: повторное нажатие
 * не выдаёт вторую выдачу и не пишет второе событие `author.enabled` (#87), а истёкшая или
 * отозванная выдача не превращается в бессрочную — создание остаётся закрытым `PLAN_LIMIT`
 * до продления (plan-free.md п. 3–4).
 */
export async function enableBaseAuthorship(
  ctx: BaseAuthorshipContext,
  action: string,
  now = new Date()
): Promise<AuthorshipActor> {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)

  // Служебные роли ведут материалы по роли, а не по плану (role-derivation.md п. 6).
  if (!personalAuthoringRoles.has(user.role)) return user

  // Служебные записи изолированы от читательского и авторского контура (журнал §25.2).
  if (user.isServiceAccount) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action })
  }

  // Архивированный аккаунт авторства не получает; отказ даёт следующая проверка прав.
  if (user.archivedAt) return user

  // Действующий план — авторские возможности уже открыты, включать нечего.
  if (hasActiveAuthorPlan(user, now)) return user

  const enabled = await ctx.prisma.$transaction(async (tx) => {
    const grants = await tx.planGrant.findMany({
      where: { userId: user.id },
      select: { id: true, endsAt: true, revokedAt: true }
    })

    const lifelong = grants.find((grant) => grant.endsAt === null && grant.revokedAt === null)
    if (lifelong) {
      // Источник истины — выдача, а не кэш плана (role-derivation.md п. 1, 9): расхождение
      // чинится без второй выдачи и без второго события.
      await syncPlanCache(tx, user.id)
      return true
    }

    // Выдача уже была: это не первое нажатие, базовое авторство второй раз не открывается.
    if (grants.length > 0) return false

    const grant = await tx.planGrant.create({
      data: { userId: user.id, tier: "standard", endsAt: null, grantedById: null, reason: BASE_AUTHORSHIP_REASON },
      select: { id: true }
    })
    await syncPlanCache(tx, user.id)
    await tx.auditLog.create({
      data: {
        action: "author.enabled",
        actorId: user.id,
        actorRole: user.role,
        entityType: "user",
        entityId: user.id,
        diff: { userId: user.id, grantId: grant.id, enabledAt: now.toISOString() },
        requestId: ctx.requestId
      }
    })
    return true
  })

  if (!enabled) return user
  return { ...user, role: "author", planTier: "standard", planUntil: null }
}

interface PlanCacheClient {
  user: { update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown> }
}

// Инвариант «роль author ⇔ действующий план или выдача» (role-derivation.md п. 1, 7).
async function syncPlanCache(tx: PlanCacheClient, userId: string): Promise<void> {
  await tx.user.update({ where: { id: userId }, data: { role: "author", planTier: "standard", planUntil: null } })
}
