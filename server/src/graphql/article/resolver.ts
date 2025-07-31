import { GraphQLError } from "graphql"
import { GraphQLContext } from "../../prisma"
import { ensureAuthenticated, ensureHasRole } from "../../exceptions/permissions"

// Константы для кэширования
const FEATURED_ARTICLES_CACHE_KEY = "featured_articles"
const LATEST_ARTICLES_CACHE_PREFIX = "latest_articles:"
const POPULAR_ARTICLES_CACHE_PREFIX = "popular_articles:"

const ARTICLE_DETAIL_CACHE_PREFIX = "article_detail:"
const RECOMMENDED_ARTICLES_CACHE_PREFIX = "recommended_articles:"
const RELATED_ARTICLES_CACHE_PREFIX = "related_articles:"
const ARTICLE_STATS_CACHE_PREFIX = "article_stats:"

const CACHE_TTL = 120 // 2 минуты

export default {
  Query: {
    articles: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      return ctx.prisma.article.findMany({
        include: { author: true, contentType: true, sectionTags: true }
      })
    },

    article: async (_parent: any, args: { slug: string }, ctx: GraphQLContext) => {
      const cacheKey = `article:${args.slug}`
      const cachedArticle = await ctx.redis.get(cacheKey)

      if (cachedArticle) {
        console.log("CACHE: Returning article from cache")
        return JSON.parse(cachedArticle)
      }

      console.log("DATABASE: Article not in cache, fetching from database")
      const article = await ctx.prisma.article.findUnique({
        where: { slug: args.slug },
        include: { author: true, contentType: true, sectionTags: true }
      })

      if (article) {
        await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(article))
      }

      return article
    },

    articleDetail: async (_parent: any, args: { slug: string }, ctx: GraphQLContext) => {
      const cacheKey = `${ARTICLE_DETAIL_CACHE_PREFIX}${args.slug}`
      const cachedDetail = await ctx.redis.get(cacheKey)

      if (cachedDetail) {
        console.log("CACHE: Returning article detail from cache")
        return JSON.parse(cachedDetail)
      }

      console.log("DATABASE: Article detail not in cache, fetching from database")

      const article = await ctx.prisma.article.findUnique({
        where: { slug: args.slug, status: "published" },
        include: { author: true, contentType: true, sectionTags: true }
      })

      if (!article) {
        throw new GraphQLError("Article not found", { extensions: { code: "NOT_FOUND" } })
      }

      // Получаем рекомендуемые статьи (похожие по тегам)
      const recommendedArticles = await ctx.prisma.article.findMany({
        where: {
          status: "published",
          slug: { not: args.slug },
          sectionTags: {
            some: {
              slug: { in: article.sectionTags.map((tag) => tag.slug) }
            }
          }
        },
        take: 5,
        orderBy: { publishedAt: "desc" },
        include: { author: true, contentType: true, sectionTags: true }
      })

      // Получаем связанные статьи (по автору и типу контента)
      const relatedArticles = await ctx.prisma.article.findMany({
        where: {
          status: "published",
          slug: { not: args.slug },
          OR: [{ authorId: article.authorId }, { typeId: article.typeId }]
        },
        take: 10,
        orderBy: { publishedAt: "desc" },
        include: { author: true, contentType: true, sectionTags: true }
      })

      // Рассчитываем статистику статьи
      const wordCount = article.body.split(/\s+/).length
      const readTime = Math.ceil(wordCount / 200) // Примерно 200 слов в минуту

      const articleStats = {
        readTime,
        wordCount,
        viewCount: 0, // В будущем можно добавить аналитику
        shareCount: 0 // В будущем можно добавить аналитику
      }

      const detail = {
        article,
        recommendedArticles,
        relatedArticles,
        articleStats
      }

      await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(detail))
      return detail
    },

    recommendedArticles: async (
      _parent: any,
      { articleSlug, limit = 5 }: { articleSlug: string; limit: number },
      ctx: GraphQLContext
    ) => {
      const cacheKey = `${RECOMMENDED_ARTICLES_CACHE_PREFIX}${articleSlug}:${limit}`
      const cachedArticles = await ctx.redis.get(cacheKey)

      if (cachedArticles) {
        console.log("CACHE: Returning recommended articles from cache")
        return JSON.parse(cachedArticles)
      }

      console.log("DATABASE: Recommended articles not in cache, fetching from database")

      const article = await ctx.prisma.article.findUnique({
        where: { slug: articleSlug, status: "published" },
        include: { sectionTags: true }
      })

      if (!article) {
        throw new GraphQLError("Article not found", { extensions: { code: "NOT_FOUND" } })
      }

      const articles = await ctx.prisma.article.findMany({
        where: {
          status: "published",
          slug: { not: articleSlug },
          sectionTags: {
            some: {
              slug: { in: article.sectionTags.map((tag) => tag.slug) }
            }
          }
        },
        take: limit,
        orderBy: { publishedAt: "desc" },
        include: { author: true, contentType: true, sectionTags: true }
      })

      await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(articles))
      return articles
    },

    relatedArticles: async (
      _parent: any,
      { articleSlug, limit = 10 }: { articleSlug: string; limit: number },
      ctx: GraphQLContext
    ) => {
      const cacheKey = `${RELATED_ARTICLES_CACHE_PREFIX}${articleSlug}:${limit}`
      const cachedArticles = await ctx.redis.get(cacheKey)

      if (cachedArticles) {
        console.log("CACHE: Returning related articles from cache")
        return JSON.parse(cachedArticles)
      }

      console.log("DATABASE: Related articles not in cache, fetching from database")

      const article = await ctx.prisma.article.findUnique({
        where: { slug: articleSlug, status: "published" },
        select: { authorId: true, typeId: true }
      })

      if (!article) {
        throw new GraphQLError("Article not found", { extensions: { code: "NOT_FOUND" } })
      }

      const articles = await ctx.prisma.article.findMany({
        where: {
          status: "published",
          slug: { not: articleSlug },
          OR: [{ authorId: article.authorId }, { typeId: article.typeId }]
        },
        take: limit,
        orderBy: { publishedAt: "desc" },
        include: { author: true, contentType: true, sectionTags: true }
      })

      await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(articles))
      return articles
    },

    articleStats: async (_parent: any, { slug }: { slug: string }, ctx: GraphQLContext) => {
      const cacheKey = `${ARTICLE_STATS_CACHE_PREFIX}${slug}`
      const cachedStats = await ctx.redis.get(cacheKey)

      if (cachedStats) {
        console.log("CACHE: Returning article stats from cache")
        return JSON.parse(cachedStats)
      }

      console.log("DATABASE: Article stats not in cache, calculating from database")

      const article = await ctx.prisma.article.findUnique({
        where: { slug, status: "published" },
        select: { body: true }
      })

      if (!article) {
        throw new GraphQLError("Article not found", { extensions: { code: "NOT_FOUND" } })
      }

      const wordCount = article.body.split(/\s+/).length
      const readTime = Math.ceil(wordCount / 200) // Примерно 200 слов в минуту

      const stats = {
        readTime,
        wordCount,
        viewCount: 0, // В будущем можно добавить аналитику
        shareCount: 0 // В будущем можно добавить аналитику
      }

      await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(stats))
      return stats
    },

    featuredArticles: async (_parent: any, args: { limit?: number }, ctx: GraphQLContext) => {
      const limit = args.limit || 5
      const cacheKey = `${FEATURED_ARTICLES_CACHE_KEY}:${limit}`
      const cachedArticles = await ctx.redis.get(cacheKey)

      if (cachedArticles) {
        console.log("CACHE: Returning featured articles from cache")
        return JSON.parse(cachedArticles)
      }

      console.log("DATABASE: Featured articles not in cache, fetching from database")
      // Получаем последние опубликованные статьи как "featured"
      // В будущем можно добавить поле isFeatured в модель Article
      const articles = await ctx.prisma.article.findMany({
        where: { status: "published" },
        orderBy: { publishedAt: "desc" },
        take: limit,
        include: { author: true, contentType: true, sectionTags: true }
      })

      await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(articles))
      return articles
    },

    latestArticles: async (_parent: any, args: { limit?: number; excludeFeatured?: boolean }, ctx: GraphQLContext) => {
      const limit = args.limit || 20
      const excludeFeatured = args.excludeFeatured || false
      const cacheKey = `${LATEST_ARTICLES_CACHE_PREFIX}${limit}:${excludeFeatured}`
      const cachedArticles = await ctx.redis.get(cacheKey)

      if (cachedArticles) {
        console.log("CACHE: Returning latest articles from cache")
        return JSON.parse(cachedArticles)
      }

      console.log("DATABASE: Latest articles not in cache, fetching from database")

      const where: any = { status: "published" }

      if (excludeFeatured) {
        // Сначала получаем ID "featured" статей, чтобы исключить их
        const featuredArticles = await ctx.prisma.article.findMany({
          where: { status: "published" },
          orderBy: { publishedAt: "desc" },
          take: 5, // Стандартное количество для featured
          select: { id: true }
        })
        const featuredIds = featuredArticles.map((a) => a.id)
        if (featuredIds.length > 0) {
          where.id = { notIn: featuredIds }
        }
      }

      const articles = await ctx.prisma.article.findMany({
        where: where,
        orderBy: { publishedAt: "desc" },
        take: limit,
        include: { author: true, contentType: true, sectionTags: true }
      })

      await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(articles))
      return articles
    },

    popularArticles: async (_parent: any, args: { timeRange?: string; limit?: number }, ctx: GraphQLContext) => {
      const timeRange = args.timeRange || "week"
      const limit = args.limit || 10
      const cacheKey = `${POPULAR_ARTICLES_CACHE_PREFIX}${timeRange}:${limit}`
      const cachedArticles = await ctx.redis.get(cacheKey)

      if (cachedArticles) {
        console.log("CACHE: Returning popular articles from cache")
        return JSON.parse(cachedArticles)
      }

      console.log("DATABASE: Popular articles not in cache, fetching from database")

      // Рассчитываем дату для фильтрации
      const now = new Date()
      let dateFilter = new Date()

      switch (timeRange) {
        case "day":
          dateFilter.setDate(now.getDate() - 1)
          break
        case "week":
          dateFilter.setDate(now.getDate() - 7)
          break
        case "month":
          dateFilter.setMonth(now.getMonth() - 1)
          break
        default:
          dateFilter.setDate(now.getDate() - 7) // по умолчанию неделя
      }

      // Пока просто возвращаем последние статьи
      // В будущем можно добавить аналитику просмотров
      const articles = await ctx.prisma.article.findMany({
        where: {
          status: "published",
          publishedAt: {
            gte: dateFilter
          }
        },
        orderBy: { publishedAt: "desc" },
        take: limit,
        include: { author: true, contentType: true, sectionTags: true }
      })

      await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(articles))
      return articles
    }
  },
  Mutation: {
    createArticle: async (_parent: any, { input }: { input: any }, ctx: GraphQLContext) => {
      ensureAuthenticated(ctx.currentUser)
      if (!ctx.currentUser) throw new Error("Authentication required.") // Redundant but good for TS

      const { sectionTags, ...articleData } = input

      const newArticle = await ctx.prisma.article.create({
        data: {
          ...articleData,
          authorId: ctx.currentUser.id,
          status: "draft", // Always create as a draft
          // Note: publishedAt is not set here
          sectionTags: sectionTags
            ? {
                connect: sectionTags.map((id: string) => ({ id }))
              }
            : undefined
        },
        include: { author: true, contentType: true, sectionTags: true }
      })

      // No cache invalidation is needed because drafts are not public.
      return newArticle
    },

    updateArticle: async (_parent: any, { id, input }: { id: string; input: any }, ctx: GraphQLContext) => {
      const user = ensureAuthenticated(ctx.currentUser)

      const article = await ctx.prisma.article.findUnique({ where: { id } })
      if (!article) {
        throw new GraphQLError("Article not found.", { extensions: { code: "NOT_FOUND" } })
      }
      if (article.authorId !== user.id) {
        throw new GraphQLError("You are not authorized to edit this article.", { extensions: { code: "FORBIDDEN" } })
      }

      const { sectionTags, ...articleData } = input

      const updatedArticle = await ctx.prisma.article.update({
        where: { id: id },
        data: {
          ...articleData,
          sectionTags: sectionTags
            ? {
                set: sectionTags.map((id: string) => ({ id }))
              }
            : undefined
        },
        include: { author: true, contentType: true, sectionTags: true }
      })

      const cacheKey = `article:${updatedArticle.slug}`
      console.log(`CACHE: Invalidating article cache for ${cacheKey}`)
      await ctx.redis.del(cacheKey)

      return updatedArticle
    },

    archiveArticle: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      const user = ensureAuthenticated(ctx.currentUser)

      const article = await ctx.prisma.article.findUnique({ where: { id } })
      if (!article) throw new GraphQLError("Article not found.", { extensions: { code: "NOT_FOUND" } })
      if (article.authorId !== user.id) {
        throw new GraphQLError("You are not authorized to archive this article.", { extensions: { code: "FORBIDDEN" } })
      }

      const updatedArticle = await ctx.prisma.article.update({
        where: { id },
        data: { status: "archived" },
        include: { author: true, contentType: true, sectionTags: true }
      })

      const articleCacheKey = `article:${updatedArticle.slug}`
      console.log(`CACHE: Invalidating caches for archived article`)
      const keysToDelete = await ctx.redis.keys(`${FEATURED_ARTICLES_CACHE_KEY}:*`)
      keysToDelete.push(...(await ctx.redis.keys(`${LATEST_ARTICLES_CACHE_PREFIX}*`)))
      keysToDelete.push(...(await ctx.redis.keys(`${POPULAR_ARTICLES_CACHE_PREFIX}*`)))
      keysToDelete.push(articleCacheKey)
      if (keysToDelete.length > 0) {
        await ctx.redis.del(keysToDelete)
      }

      return updatedArticle
    },

    requestReview: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      const user = ensureAuthenticated(ctx.currentUser)

      const article = await ctx.prisma.article.findUnique({ where: { id } })
      if (!article) throw new GraphQLError("Article not found.", { extensions: { code: "NOT_FOUND" } })
      if (article.authorId !== user.id) {
        throw new GraphQLError("You are not authorized to manage this article.", { extensions: { code: "FORBIDDEN" } })
      }
      if (article.status !== "draft") {
        throw new GraphQLError("Article must be a draft to request a review.", { extensions: { code: "BAD_REQUEST" } })
      }

      return ctx.prisma.article.update({
        where: { id },
        data: { status: "review" },
        include: { author: true, contentType: true, sectionTags: true }
      })
    },

    revertToDraft: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      const user = ensureAuthenticated(ctx.currentUser)

      const article = await ctx.prisma.article.findUnique({ where: { id } })
      if (!article) throw new GraphQLError("Article not found.", { extensions: { code: "NOT_FOUND" } })
      if (article.authorId !== user.id) {
        throw new GraphQLError("You are not authorized to manage this article.", { extensions: { code: "FORBIDDEN" } })
      }
      if (article.status !== "review") {
        throw new GraphQLError("Article must be in review to revert to a draft.", {
          extensions: { code: "BAD_REQUEST" }
        })
      }

      return ctx.prisma.article.update({
        where: { id },
        data: { status: "draft" },
        include: { author: true, contentType: true, sectionTags: true }
      })
    },

    setArticleStatus: async (_parent: any, { id, status }: { id: string; status: any }, ctx: GraphQLContext) => {
      ensureHasRole(ctx.currentUser, ["admin"])

      const article = await ctx.prisma.article.findUnique({ where: { id } })
      if (!article) throw new GraphQLError("Article not found.", { extensions: { code: "NOT_FOUND" } })

      const updatedArticle = await ctx.prisma.article.update({
        where: { id },
        data: {
          status,
          publishedAt: status === "published" && article.status !== "published" ? new Date() : article.publishedAt
        },
        include: { author: true, contentType: true, sectionTags: true }
      })

      const articleCacheKey = `article:${updatedArticle.slug}`
      console.log(`CACHE: Invalidating all public caches for status change`)
      const keysToDelete = await ctx.redis.keys(`${FEATURED_ARTICLES_CACHE_KEY}:*`)
      keysToDelete.push(...(await ctx.redis.keys(`${LATEST_ARTICLES_CACHE_PREFIX}*`)))
      keysToDelete.push(...(await ctx.redis.keys(`${POPULAR_ARTICLES_CACHE_PREFIX}*`)))
      keysToDelete.push(articleCacheKey)
      if (keysToDelete.length > 0) {
        await ctx.redis.del(keysToDelete)
      }

      return updatedArticle
    }
  }
}
