import type { Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, hasActiveAuthorPlan } from "../exceptions/permissions"
import { syncPlanCache } from "../plans/plan-cache"
import { isBaseGrant } from "../plans/plan-state"
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
 * «Первое нажатие» — аккаунт, у которого ещё не было базовой выдачи: повторное нажатие не
 * выдаёт вторую выдачу и не пишет второе событие `author.enabled` (#87).
 *
 * Прошлая админская выдача первому нажатию не мешает: на первом запуске платности нет, базовое
 * авторство доступно любому зарегистрированному читателю (журнал §24.1, §25.1), а запрет
 * `plan-free.md` п. 3 начинает действовать только после включения платности. Отозванная же
 * базовая выдача остаётся закрытой — её снимает согласованное архивирование аккаунта (§27.1).
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

  const cache = await ctx.prisma.$transaction(async (tx) => {
    const grants = await tx.planGrant.findMany({
      where: { userId: user.id },
      select: { id: true, endsAt: true, grantedById: true, revokedAt: true }
    })

    const base = grants.find(isBaseGrant)
    if (base) {
      // Базовая выдача уже есть: второй раз она не открывается и второго события не пишет.
      // Действующая выдача только чинит расхождение кэша (role-derivation.md п. 1, 9);
      // отозванная оставляет доступ закрытым (§27.1).
      if (base.revokedAt) return null
      return syncPlanCache(tx, user.id, now)
    }

    // `startsAt` задаётся явно: со значением по умолчанию его выставила бы база уже после `now`,
    // и пересчёт кэша в этой же транзакции счёл бы свежую выдачу будущей, а план — отсутствующим.
    const grant = await tx.planGrant.create({
      data: {
        userId: user.id,
        tier: "standard",
        startsAt: now,
        endsAt: null,
        grantedById: null,
        reason: BASE_AUTHORSHIP_REASON
      },
      select: { id: true }
    })
    const synced = await syncPlanCache(tx, user.id, now)
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
    return synced
  })

  // Дальнейшие проверки этого же запроса идут по свежему кэшу, а не по прочитанному до записи:
  // при действующей админской выдаче уровень выше базового (журнал §8.22).
  if (!cache) return user
  return { ...user, role: cache.role ?? user.role, planTier: cache.planTier, planUntil: cache.planUntil }
}
