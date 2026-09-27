import type { GraphQLContext } from "../../prisma"
import { createApiError } from "../../errors/graphql-error"
import { ensureAuthenticated } from "../../exceptions/permissions"
import { toAccountSubscriptionPayload } from "../../account/dashboard"
import {
  cancelAccountArchive,
  confirmAccountArchive,
  readArchivePreview,
  readArchiveState,
  requestAccountArchive,
  restoreAccountSelf,
  type AccountArchiveContext,
  type AccountArchivePreviewView,
  type AccountArchiveStateView,
  type AccountArchiveStore
} from "../../account/archive"
import type { AccountArchiveMode } from "../../generated/prisma"

/**
 * «Удалить аккаунт» и экран состояния (матрица #51, #116). Оба права — «свои»: поля висят на
 * `AccountUser` и сверяют `parent.id` с текущим пользователем, поэтому через `users` или
 * `adminUser` их не прочитать.
 */
function archiveContext(ctx: GraphQLContext): AccountArchiveContext {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)

  return {
    store: ctx.prisma as unknown as AccountArchiveStore,
    actor: {
      id: user.id,
      email: user.email,
      role: user.role,
      locale: user.locale,
      archivedAt: user.archivedAt,
      archiveMode: user.archiveMode,
      isServiceAccount: user.isServiceAccount
    },
    requestId: ctx.requestId,
    mail: ctx.mail,
    rateLimiter: ctx.rateLimiter,
    requestMeta: ctx.requestMeta ?? { userAgent: null, ip: null },
    ip: ctx.requestMeta?.ip
  }
}

/** Страница «Удалить аккаунт» закрыта для уже архивированной записи: её место — `/me/archived`. */
function activeAccountContext(ctx: GraphQLContext, action: string): AccountArchiveContext {
  const context = archiveContext(ctx)
  if (context.actor.archivedAt) throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action })
  return context
}

function ownAccount(parent: { id: string }, context: AccountArchiveContext, action: string, requestId: string) {
  if (parent.id !== context.actor.id) throw createApiError("FORBIDDEN", { requestId, action })
  return context
}

const toPreview = (view: AccountArchivePreviewView) => ({
  articlesCount: view.articlesCount,
  plan: view.plan ? toAccountSubscriptionPayload(view.plan) : null,
  isLastOwner: view.isLastOwner,
  pending: view.pending
    ? {
        requestedAt: view.pending.requestedAt.toISOString(),
        expiresAt: view.pending.expiresAt.toISOString()
      }
    : null
})

const toState = (view: AccountArchiveStateView) => ({
  archivedAt: view.archivedAt.toISOString(),
  mode: view.mode,
  articlesArchived: view.articlesArchived,
  plan: view.plan ? toAccountSubscriptionPayload(view.plan) : null,
  canRestore: view.canRestore
})

export default {
  AccountUser: {
    archivePreview: async (parent: { id: string }, _args: unknown, ctx: GraphQLContext) => {
      const context = activeAccountContext(ctx, "account.archive.self")
      return toPreview(await readArchivePreview(ownAccount(parent, context, "account.archive.self", ctx.requestId)))
    },

    archiveState: async (parent: { id: string }, _args: unknown, ctx: GraphQLContext) => {
      const context = archiveContext(ctx)
      return toState(await readArchiveState(ownAccount(parent, context, "account.restore.self", ctx.requestId)))
    }
  },

  Mutation: {
    requestAccountArchive: async (_: unknown, { mode }: { mode: AccountArchiveMode }, ctx: GraphQLContext) =>
      toPreview(await requestAccountArchive(activeAccountContext(ctx, "account.archive.self"), mode)),

    cancelAccountArchive: async (_: unknown, __: unknown, ctx: GraphQLContext) =>
      toPreview(await cancelAccountArchive(activeAccountContext(ctx, "account.archive.self"))),

    confirmAccountArchive: async (_: unknown, { token }: { token: string }, ctx: GraphQLContext) => {
      const articlesArchived = await confirmAccountArchive(activeAccountContext(ctx, "account.archive.self"), token)
      return { archived: true, articlesArchived }
    },

    restoreAccountSelf: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const { restored, accessToken, refreshToken, user } = await restoreAccountSelf(archiveContext(ctx))
      return { restored, session: { accessToken, refreshToken, user } }
    }
  }
}
