import { GraphQLContext } from "../../prisma"

export default {
  Query: {
    users: async (_parent: any, _args: any, ctx: GraphQLContext) => ctx.prisma.user.findMany()
  }
}
