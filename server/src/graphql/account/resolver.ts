import type { GraphQLContext } from "../../prisma"
import { createApiError } from "../../errors/graphql-error"
import { ensureAuthenticated } from "../../exceptions/permissions"
import { deriveAccountSubscription, type AccountPlanPeriod } from "../../account/dashboard"

/**
 * Сводка кабинета `/me` (`docs/spec/30-account/reader/dashboard.md` §4).
 *
 * Поля висят на `AccountUser` и отдают только свои данные (`me`, матрица #6, #58): сверка
 * `parent.id` с текущим пользователем не даёт прочитать их через `users` или `adminUser`.
 */
const personalRoles = new Set(["reader", "author"])

function accountOwner(parent: { id: string }, ctx: GraphQLContext, action: string) {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  // Ограниченная сессия самостоятельно архивированной записи видит только экран состояния
  // (`50-access/session-lifecycle.md` п. 7): сводка уводит её на `/me/archived`.
  if (user.archivedAt || parent.id !== user.id) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action })
  }
  return user
}

/**
 * Платёжная мутация до включения платности (журнал §24.1, `subscription.md` §12 `[ДОПУЩЕНИЕ]`):
 * гость получает `UNAUTHENTICATED`, любой вошедший — `FORBIDDEN` с правом из матрицы.
 */
const paymentsDisabled = (action: string) => (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
  ensureAuthenticated(ctx.currentUser, ctx.requestId)
  throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action })
}

const toPeriod = (period: AccountPlanPeriod) => ({
  tier: period.tier,
  startsAt: period.startsAt.toISOString(),
  endsAt: period.endsAt?.toISOString() ?? null
})

export default {
  Mutation: {
    startCheckout: paymentsDisabled("checkout.start"),
    cancelSubscription: paymentsDisabled("subscription.cancel"),
    resumeSubscription: paymentsDisabled("subscription.resume"),
    requestRefund: paymentsDisabled("refund.request"),
    confirmPriceChange: paymentsDisabled("subscription.price.confirm")
  },

  AccountUser: {
    hasArticles: async (parent: { id: string }, _args: unknown, ctx: GraphQLContext) => {
      const user = accountOwner(parent, ctx, "account.dashboard")
      const article = await ctx.prisma.article.findFirst({ where: { authorId: user.id }, select: { id: true } })
      return article !== null
    },

    subscription: async (parent: { id: string }, _args: unknown, ctx: GraphQLContext) => {
      const user = accountOwner(parent, ctx, "account.subscription")
      if (user.isServiceAccount || !personalRoles.has(user.role)) return null

      const grants = await ctx.prisma.planGrant.findMany({
        where: { userId: user.id },
        select: { tier: true, startsAt: true, endsAt: true, revokedAt: true }
      })
      const view = deriveAccountSubscription(grants, new Date())

      return {
        state: view.state,
        tier: view.tier,
        until: view.until?.toISOString() ?? null,
        endedAt: view.endedAt?.toISOString() ?? null,
        queue: view.queue.map(toPeriod)
      }
    }
  }
}
