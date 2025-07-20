import { GraphQLContext } from "../../prisma"

export default {
  Query: {
    sectionTags: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      return ctx.prisma.sectionTag.findMany()
    }
  }
}
