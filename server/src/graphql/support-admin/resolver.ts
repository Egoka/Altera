import {
  answerSupportRequest,
  getAdminSupportRequest,
  listAdminSupportRequests,
  type AdminSupportRequestFilters,
  type AdminSupportRequestItem
} from "../../admin/support"
import type { GraphQLContext } from "../../prisma"
import type { PaginationInput } from "../../utils/admin"

interface AdminSupportRequestsArgs {
  filters?: AdminSupportRequestFilters | null
  pagination?: PaginationInput | null
}

function present(request: AdminSupportRequestItem) {
  return {
    ...request,
    createdAt: request.createdAt.toISOString(),
    answeredAt: request.answeredAt?.toISOString() ?? null
  }
}

export default {
  Query: {
    adminSupportRequests: async (_parent: unknown, args: AdminSupportRequestsArgs, ctx: GraphQLContext) => {
      const list = await listAdminSupportRequests(ctx, args)
      return { ...list, items: list.items.map(present) }
    },
    adminSupportRequest: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const request = await getAdminSupportRequest(ctx, id)
      return request ? present(request) : null
    }
  },
  Mutation: {
    answerSupportRequest: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      present(await answerSupportRequest(ctx, id))
  }
}
