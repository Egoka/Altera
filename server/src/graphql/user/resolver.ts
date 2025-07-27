import { GraphQLContext } from "../../prisma"
import { ensureAuthenticated } from "../../exceptions/permissions"

export default {
  Query: {
    users: async (_parent: any, _args: any, ctx: GraphQLContext) => ctx.prisma.user.findMany(),

    me: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      ensureAuthenticated(ctx.currentUser)
      return ctx.currentUser
    }
  }
}
