import { GraphQLContext } from "../../context"

export default {
  Query: {
    users: async (_parent: any, _args: any, ctx: GraphQLContext) => ctx.prisma.user.findMany()
  }
}
