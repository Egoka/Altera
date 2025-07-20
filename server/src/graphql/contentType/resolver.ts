import { GraphQLContext } from "../../context"

export default {
  Query: {
    contentTypes: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      return ctx.prisma.contentType.findMany()
    }
  }
}
