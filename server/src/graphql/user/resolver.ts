import { GraphQLContext } from "../../prisma"
import { GraphQLError } from "graphql"

export default {
  Query: {
    users: async (_parent: any, _args: any, ctx: GraphQLContext) => ctx.prisma.user.findMany(),

    me: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      if (!ctx.currentUser) {
        throw new GraphQLError("Authentication required.")
      }
      return ctx.currentUser
    }
  }
}
