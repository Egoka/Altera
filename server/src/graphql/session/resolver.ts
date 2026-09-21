import type { GraphQLContext } from "../../prisma"
import { createApiError } from "../../errors/graphql-error"
import { ensureAuthenticated } from "../../exceptions/permissions"
import {
  listAccountSessions,
  revokeOtherSessions,
  revokeOwnSession,
  type AccountSessionStore,
  type AccountSessionView
} from "../../auth/account-sessions"

/**
 * Страница «Сессии и устройства» (`docs/spec/30-account/reader/sessions.md`).
 *
 * Доступ — только к своим сессиям (матрица #47: «свои» у каждой роли, включая `analyst`);
 * чужие сессии не отдаёт ни один резолвер этого модуля, поэтому запрет аналитику на активные
 * сессии пользователей (журнал §26.6) выполняется отсутствием такого поля.
 */
interface SessionActor {
  userId: string
  currentSessionId: string | null
  store: AccountSessionStore
}

function sessionActor(ctx: GraphQLContext, action: string): SessionActor {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  // Ограниченная сессия самостоятельно архивированной записи видит только экран состояния
  // (`50-access/session-lifecycle.md` п. 7): страница сессий уводит её на `/me/archived`.
  if (user.archivedAt) throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action })

  return {
    userId: user.id,
    currentSessionId: ctx.sessionId,
    store: ctx.prisma as unknown as AccountSessionStore
  }
}

const toPayload = (view: AccountSessionView) => ({
  id: view.id,
  deviceClass: view.deviceClass,
  browserClass: view.browserClass,
  createdAt: view.createdAt.toISOString(),
  lastActiveAt: view.lastActiveAt.toISOString(),
  isCurrent: view.isCurrent
})

export default {
  AccountUser: {
    sessions: async (parent: { id: string }, _args: unknown, ctx: GraphQLContext) => {
      const actor = sessionActor(ctx, "session.list")
      if (parent.id !== actor.userId) {
        throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "session.list" })
      }

      const sessions = await listAccountSessions(actor.store, actor.userId, actor.currentSessionId)
      return sessions.map(toPayload)
    }
  },
  Mutation: {
    revokeSession: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const actor = sessionActor(ctx, "session.revoke")
      const outcome = await revokeOwnSession(actor.store, {
        userId: actor.userId,
        sessionId: id,
        currentSessionId: actor.currentSessionId
      })

      if (outcome.status === "current") {
        throw createApiError("CONFLICT", {
          requestId: ctx.requestId,
          entity: "session",
          expected: "other session",
          actual: "current session"
        })
      }
      if (outcome.status === "not_found") {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "session" })
      }

      ctx.logger.log({
        level: "info",
        event: "session.revoked",
        requestId: ctx.requestId,
        message: "Session revoked by its owner",
        data: { userId: actor.userId, sessionId: id, reason: "user_revoke", revokedCount: 1 }
      })

      return { revoked: true }
    },

    revokeAllSessions: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const actor = sessionActor(ctx, "session.revoke")
      const revokedCount = await revokeOtherSessions(actor.store, {
        userId: actor.userId,
        currentSessionId: actor.currentSessionId
      })

      ctx.logger.log({
        level: "info",
        event: "session.revoked",
        requestId: ctx.requestId,
        message: "Other sessions revoked by their owner",
        data: { userId: actor.userId, sessionId: actor.currentSessionId, reason: "user_revoke_all", revokedCount }
      })

      return { revokedCount }
    }
  }
}
