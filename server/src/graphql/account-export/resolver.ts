import { ACCOUNT_EXPORT_SCOPES } from "../../account-export"
import { createApiError } from "../../errors/graphql-error"
import { ensureAuthenticated } from "../../exceptions/permissions"
import type { GraphQLContext } from "../../prisma"

function currentOwner(ctx: GraphQLContext, action: string) {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  if (user.archivedAt) throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action })
  return user
}

function exportService(ctx: GraphQLContext) {
  if (!ctx.accountExports) throw new Error("Account export service is not configured")
  return ctx.accountExports
}

export default {
  Mutation: {
    requestExport: async (
      _parent: unknown,
      args: { scope?: (typeof ACCOUNT_EXPORT_SCOPES)[number][] | null },
      ctx: GraphQLContext
    ) => {
      const user = currentOwner(ctx, "account.export")
      return exportService(ctx).request(user.id, args.scope ?? ACCOUNT_EXPORT_SCOPES, ctx.requestId)
    },

    exportDownload: async (_parent: unknown, args: { id: string }, ctx: GraphQLContext) => {
      const user = currentOwner(ctx, "account.export.download")
      return exportService(ctx).download(user.id, args.id, ctx.requestId)
    }
  },

  AccountUser: {
    exports: async (parent: { id: string }, _args: unknown, ctx: GraphQLContext) => {
      const user = currentOwner(ctx, "account.export")
      if (parent.id !== user.id)
        throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "account.export" })
      return exportService(ctx).list(user.id)
    }
  }
}
