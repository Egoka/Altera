import type { GraphQLContext } from "../../prisma"
import { createApiError } from "../../errors/graphql-error"
import { ensureAuthenticated } from "../../exceptions/permissions"
import {
  cancelEmailChange,
  confirmEmailChange,
  readEmailChangeState,
  requestEmailChange,
  type EmailChangeContext,
  type EmailChangeStateView,
  type EmailChangeStore
} from "../../auth/email-change"

/**
 * Смена адреса своей записи (матрица #49): `admin`/`owner` меняет чужой адрес в карточке
 * пользователя (#50, заход 7), а не через это поле.
 */
function emailChangeContext(ctx: GraphQLContext, action: string): EmailChangeContext {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  // Ограниченная сессия выдаётся только самостоятельно архивированной записи
  // (`session-lifecycle.md` п. 7): ей доступен лишь экран состояния.
  if (user.archivedAt) throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action })

  return {
    store: ctx.prisma as unknown as EmailChangeStore,
    actor: { id: user.id, email: user.email, role: user.role, locale: user.locale },
    requestId: ctx.requestId,
    mail: ctx.mail,
    rateLimiter: ctx.rateLimiter,
    ip: ctx.requestMeta?.ip
  }
}

const toState = (state: EmailChangeStateView) => ({
  currentEmailMasked: state.currentEmailMasked,
  pending: state.pending
    ? {
        newEmailMasked: state.pending.newEmailMasked,
        expiresAt: state.pending.expiresAt.toISOString(),
        attemptsLeft: state.pending.attemptsLeft
      }
    : null
})

export default {
  AccountUser: {
    emailChange: async (parent: { id: string }, _args: unknown, ctx: GraphQLContext) => {
      const context = emailChangeContext(ctx, "email.change")
      if (parent.id !== context.actor.id) {
        throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "email.change" })
      }

      return toState(await readEmailChangeState(context))
    }
  },
  Mutation: {
    requestEmailChange: async (_: unknown, { newEmail }: { newEmail: string }, ctx: GraphQLContext) =>
      toState(await requestEmailChange(emailChangeContext(ctx, "email.change"), newEmail)),

    confirmEmailChange: async (_: unknown, { code }: { code: string }, ctx: GraphQLContext) => {
      const result = await confirmEmailChange(emailChangeContext(ctx, "email.change"), code)
      return { email: result.email, changedAt: result.changedAt.toISOString() }
    },

    cancelEmailChange: async (_: unknown, __: unknown, ctx: GraphQLContext) =>
      toState(await cancelEmailChange(emailChangeContext(ctx, "email.change")))
  }
}
