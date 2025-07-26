import { GraphQLContext } from "../../prisma"

export default {
  Query: {
    users: async (_parent: any, _args: any, ctx: GraphQLContext) => ctx.prisma.user.findMany(),

    me: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      if (!ctx.currentUser) {
        throw new Error("Authentication required.")
      }
      return ctx.currentUser
    }
  }
}
