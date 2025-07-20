import { GraphQLContext } from "../../prisma"

export default {
  Query: {
    articles: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      return ctx.prisma.article.findMany({
        include: { author: true, contentType: true, sectionTags: true }
      })
    },
    article: async (_parent: any, args: { slug: string }, ctx: GraphQLContext) => {
      return ctx.prisma.article.findUnique({
        where: { slug: args.slug },
        include: { author: true, contentType: true, sectionTags: true }
      })
    }
  }
}
