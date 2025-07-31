import { GraphQLContext } from "../../prisma"

const CONTENT_TYPE_CACHE_PREFIX = "content_type:"
const CONTENT_TYPE_ARTICLES_CACHE_PREFIX = "content_type_articles:"
const CONTENT_TYPE_STATS_CACHE_PREFIX = "content_type_stats:"
const CACHE_TTL = 120 // 2 minutes in seconds

export default {
  Query: {
    contentTypes: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      return ctx.prisma.contentType.findMany({
        where: { status: "active" },
        orderBy: { order: "asc" }
      })
    },

    contentType: async (_parent: any, args: { slug: string }, ctx: GraphQLContext) => {
      const cacheKey = `${CONTENT_TYPE_CACHE_PREFIX}slug:${args.slug}`
      const cachedContentType = await ctx.redis.get(cacheKey)

      if (cachedContentType) {
        console.log("CACHE: Returning content type by slug from cache")
        return JSON.parse(cachedContentType)
      }

      console.log("DATABASE: Content type by slug not in cache, fetching from database")
      const contentType = await ctx.prisma.contentType.findUnique({
        where: { slug: args.slug }
      })

      if (contentType) {
        await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(contentType))
      }

      return contentType
    },

    articlesByContentType: async (
      _parent: any,
      { contentTypeSlug, page = 1, limit = 10 }: { contentTypeSlug: string; page: number; limit: number },
      ctx: GraphQLContext
    ) => {
      const cacheKey = `${CONTENT_TYPE_ARTICLES_CACHE_PREFIX}${contentTypeSlug}:${page}:${limit}`
      const cachedData = await ctx.redis.get(cacheKey)

      if (cachedData) {
        console.log("CACHE: Returning articles by content type from cache")
        return JSON.parse(cachedData)
      }

      console.log("DATABASE: Articles by content type not in cache, fetching from database")

      const contentType = await ctx.prisma.contentType.findUnique({ where: { slug: contentTypeSlug } })
      if (!contentType) {
        throw new Error("Content type not found")
      }

      const totalCount = await ctx.prisma.article.count({
        where: {
          contentType: { slug: contentTypeSlug },
          status: "published"
        }
      })
      const articles = await ctx.prisma.article.findMany({
        where: {
          contentType: { slug: contentTypeSlug },
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

    contentTypeStats: async (_parent: any, { contentTypeSlug }: { contentTypeSlug: string }, ctx: GraphQLContext) => {
      const cacheKey = `${CONTENT_TYPE_STATS_CACHE_PREFIX}${contentTypeSlug}`
      const cachedStats = await ctx.redis.get(cacheKey)

      if (cachedStats) {
        console.log("CACHE: Returning content type stats from cache")
        return JSON.parse(cachedStats)
      }

      console.log("DATABASE: Content type stats not in cache, calculating from database")

      const contentType = await ctx.prisma.contentType.findUnique({ where: { slug: contentTypeSlug } })
      if (!contentType) {
        throw new Error("Content type not found")
      }

      const totalArticles = await ctx.prisma.article.count({
        where: {
          contentType: { slug: contentTypeSlug },
          status: "published"
        }
      })

      const oneMonthAgo = new Date()
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)

      const articlesThisMonth = await ctx.prisma.article.count({
        where: {
          contentType: { slug: contentTypeSlug },
          status: "published",
          publishedAt: { gte: oneMonthAgo }
        }
      })

      // Получаем популярные теги для этого типа контента
      const articlesWithTags = await ctx.prisma.article.findMany({
        where: {
          contentType: { slug: contentTypeSlug },
          status: "published"
        },
        select: { sectionTags: { select: { name: true, slug: true } } }
      })

      const tagCounts: { [slug: string]: { name: string; slug: string; count: number } } = {}
      articlesWithTags
        .flatMap((a) => a.sectionTags)
        .forEach((tag) => {
          if (!tagCounts[tag.slug]) {
            tagCounts[tag.slug] = { ...tag, count: 0 }
          }
          tagCounts[tag.slug].count++
        })

      const popularTags = Object.values(tagCounts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5) // Top 5 tags

      // Получаем топ авторов для этого типа контента
      const topAuthors = await ctx.prisma.user.findMany({
        where: {
          articles: {
            some: {
              contentType: { slug: contentTypeSlug },
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

      // Рассчитываем среднее время чтения
      const articlesWithBody = await ctx.prisma.article.findMany({
        where: {
          contentType: { slug: contentTypeSlug },
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
        popularTags,
        topAuthors
      }

      await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(stats))
      return stats
    }
  }
}
