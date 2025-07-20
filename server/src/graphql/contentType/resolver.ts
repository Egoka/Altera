import { GraphQLContext } from "../../prisma"

export default {
  Query: {
    contentTypes: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      return ctx.prisma.contentType.findMany()
    }
  }
}
