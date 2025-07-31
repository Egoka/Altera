import { GraphQLContext } from "../../prisma"

const TAG_CACHE_PREFIX = "tag:"
const TAG_ARTICLES_CACHE_PREFIX = "tag_articles:"
const TAG_STATS_CACHE_PREFIX = "tag_stats:"
const CACHE_TTL = 120 // 2 minutes in seconds

export default {
  Query: {
    sectionTags: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      return ctx.prisma.sectionTag.findMany()
    },

    tag: async (_parent: any, args: { slug: string }, ctx: GraphQLContext) => {
      const cacheKey = `${TAG_CACHE_PREFIX}slug:${args.slug}`
      const cachedTag = await ctx.redis.get(cacheKey)

      if (cachedTag) {
        console.log("CACHE: Returning tag by slug from cache")
        return JSON.parse(cachedTag)
      }

      console.log("DATABASE: Tag by slug not in cache, fetching from database")
      const tag = await ctx.prisma.sectionTag.findUnique({
        where: { slug: args.slug }
      })

      if (tag) {
        await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(tag))
      }

      return tag
    },

    articlesByTag: async (
      _parent: any,
      { tagSlug, page = 1, limit = 10 }: { tagSlug: string; page: number; limit: number },
      ctx: GraphQLContext
    ) => {
      const cacheKey = `${TAG_ARTICLES_CACHE_PREFIX}${tagSlug}:${page}:${limit}`
      const cachedData = await ctx.redis.get(cacheKey)

      if (cachedData) {
        console.log("CACHE: Returning articles by tag from cache")
        return JSON.parse(cachedData)
      }

      console.log("DATABASE: Articles by tag not in cache, fetching from database")

      const tag = await ctx.prisma.sectionTag.findUnique({ where: { slug: tagSlug } })
      if (!tag) {
        throw new Error("Tag not found")
      }

      const totalCount = await ctx.prisma.article.count({
        where: {
          sectionTags: { some: { slug: tagSlug } },
          status: "published"
        }
      })
      const articles = await ctx.prisma.article.findMany({
        where: {
          sectionTags: { some: { slug: tagSlug } },
          status: "published"
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { publishedAt: "desc" },
        include: {
          author: true,
          contentType: true,
          sectionTags: true
        }
      })

      const response = {
        articles,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: page
      }

      await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(response))
      return response
    },

    tagStats: async (_parent: any, { tagSlug }: { tagSlug: string }, ctx: GraphQLContext) => {
      const cacheKey = `${TAG_STATS_CACHE_PREFIX}${tagSlug}`
      const cachedStats = await ctx.redis.get(cacheKey)

      if (cachedStats) {
        console.log("CACHE: Returning tag stats from cache")
        return JSON.parse(cachedStats)
      }

      console.log("DATABASE: Tag stats not in cache, calculating from database")

      const tag = await ctx.prisma.sectionTag.findUnique({ where: { slug: tagSlug } })
      if (!tag) {
        throw new Error("Tag not found")
      }

      const totalArticles = await ctx.prisma.article.count({
        where: {
          sectionTags: { some: { slug: tagSlug } },
          status: "published"
        }
      })

      const oneMonthAgo = new Date()
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)

      const articlesThisMonth = await ctx.prisma.article.count({
        where: {
          sectionTags: { some: { slug: tagSlug } },
          status: "published",
          publishedAt: { gte: oneMonthAgo }
        }
      })

      // Получаем популярных авторов для этого тега
      const popularAuthors = await ctx.prisma.user.findMany({
        where: {
          articles: {
            some: {
              sectionTags: { some: { slug: tagSlug } },
              status: "published"
            }
          }
        },
        take: 5,
        orderBy: {
          articles: {
            _count: "desc"
          }
        }
      })

      // Рассчитываем среднее время чтения (примерная оценка)
      const articlesWithBody = await ctx.prisma.article.findMany({
        where: {
          sectionTags: { some: { slug: tagSlug } },
          status: "published"
        },
        select: { body: true }
      })

      const totalWords = articlesWithBody.reduce((sum, article) => {
        return sum + (article.body?.split(/\s+/).length || 0)
      }, 0)

      const averageReadTime =
        articlesWithBody.length > 0
          ? totalWords / articlesWithBody.length / 200 // Примерно 200 слов в минуту
          : 0

      const stats = {
        totalArticles,
        articlesThisMonth,
        averageReadTime: Math.round(averageReadTime * 10) / 10, // Округляем до 1 знака
        popularAuthors
      }

      await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(stats))
      return stats
    }
  }
}
