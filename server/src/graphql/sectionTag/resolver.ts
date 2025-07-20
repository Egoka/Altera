import { GraphQLContext } from "../../context"

export default {
  Query: {
    sectionTags: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      return ctx.prisma.sectionTag.findMany()
    }
  }
}
