import { GraphQLError } from "graphql"
import { GraphQLContext } from "../../prisma"
import { ensureAuthenticated, ensureHasRole } from "../../exceptions/permissions"
import {
  validatePagination,
  validateSort,
  buildBaseWhereClause,
  buildOrderBy,
  calculatePagination,
  getCacheKey,
  getCachedOrFetch,
  handleAdminError,
  validateDateRange,
  validateSearchInput,
  validateBulkOperation,
  logAdminOperation,
  ADMIN_CACHE_PREFIX,
  PaginationInput,
  SortInput,
  BaseFilters,
  SearchInput
} from "../../utils/admin"

// Константы для кэширования
const FEATURED_ARTICLES_CACHE_KEY = "featured_articles"
const LATEST_ARTICLES_CACHE_PREFIX = "latest_articles:"
const POPULAR_ARTICLES_CACHE_PREFIX = "popular_articles:"

const ARTICLE_DETAIL_CACHE_PREFIX = "article_detail:"
const RECOMMENDED_ARTICLES_CACHE_PREFIX = "recommended_articles:"
const RELATED_ARTICLES_CACHE_PREFIX = "related_articles:"
const ARTICLE_STATS_CACHE_PREFIX = "article_stats:"

const CACHE_TTL = parseInt(process.env.CACHE_TTL || "21600") // время жизни кэша в секундах (по умолчанию 6 часов)

export default {
  Query: {
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
    },

    // Запрос для управления статьями (требует права admin)
    articles: async (
      _parent: any,
      args: {
        pagination: PaginationInput
        sort: SortInput
        filters: {
          base: BaseFilters
          status?: string[]
          authorId?: string[]
          typeId?: string[]
          tagIds?: string[]
          publishedAt?: { from?: string; to?: string }
        }
        search?: SearchInput
      },
      ctx: GraphQLContext
    ) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin")

      const { pagination, sort, filters, search } = args

      // Валидация входных параметров
      validatePagination(pagination)
      validateSort(sort, [
        "id",
        "title",
        "slug",
        "status",
        "publishedAt",
        "createdAt",
        "updatedAt",
        "author.name",
        "contentType.name"
      ])

      if (search) {
        validateSearchInput(search, ["title", "body", "excerpt", "dek"])
      }

      if (filters.base.createdAt) {
        validateDateRange(filters.base.createdAt)
      }

      if (filters.base.updatedAt) {
        validateDateRange(filters.base.updatedAt)
      }

      if (filters.publishedAt) {
        validateDateRange(filters.publishedAt)
      }

      // Строим WHERE условие
      const where: any = buildBaseWhereClause(filters.base, search)

      // Добавляем специфичные фильтры для статей
      if (filters.status?.length) {
        where.status = { in: filters.status }
      }

      if (filters.authorId?.length) {
        where.authorId = { in: filters.authorId }
      }

      if (filters.typeId?.length) {
        where.typeId = { in: filters.typeId }
      }

      if (filters.tagIds?.length) {
        where.sectionTags = {
          some: { id: { in: filters.tagIds } }
        }
      }

      if (filters.publishedAt) {
        where.publishedAt = {}
        if (filters.publishedAt.from) {
          where.publishedAt.gte = new Date(filters.publishedAt.from)
        }
        if (filters.publishedAt.to) {
          where.publishedAt.lte = new Date(filters.publishedAt.to)
        }
      }

      // Создаем ключ кеша
      const cacheKey = getCacheKey("admin_articles", { pagination, sort, filters })

      // Получаем данные с кешированием
      const result = await getCachedOrFetch(ctx, cacheKey, async () => {
        // Получаем общее количество
        const total = await ctx.prisma.article.count({ where })

        // Рассчитываем пагинацию
        const { skip, take, pagination: paginationInfo } = calculatePagination(pagination.page, pagination.limit, total)

        // Получаем данные
        const articles = await ctx.prisma.article.findMany({
          where,
          skip,
          take,
          orderBy: buildOrderBy(sort),
          include: {
            author: true,
            contentType: true,
            sectionTags: true
          }
        })

        return {
          articles,
          pagination: paginationInfo,
          filters: {
            base: {
              createdAt: filters.base.createdAt,
              updatedAt: filters.base.updatedAt
            },
            status: filters.status,
            authorId: filters.authorId,
            typeId: filters.typeId,
            tagIds: filters.tagIds,
            publishedAt: filters.publishedAt
          },
          sort: {
            field: sort.field,
            direction: sort.direction
          },
          search: search
            ? {
                query: search.query,
                fields: search.fields
              }
            : null
        }
      })

      // Логируем операцию
      logAdminOperation("admin_articles", ctx.currentUser?.id || "unknown", {
        pagination,
        sort,
        filters
      })

      return result
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
    },

    // Админ мутации для массовых операций
    bulkDeleteArticles: async (_parent: any, { ids }: { ids: string[] }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin")

      // Валидация входных параметров
      validateBulkOperation(ids, 100)

      try {
        // Получаем статьи для логирования
        const articlesToDelete = await ctx.prisma.article.findMany({
          where: { id: { in: ids } },
          include: { author: true, contentType: true, sectionTags: true }
        })

        if (articlesToDelete.length !== ids.length) {
          throw new GraphQLError("Some articles not found", { extensions: { code: "NOT_FOUND" } })
        }

        // Удаляем статьи
        const deletedArticles = await ctx.prisma.article.deleteMany({
          where: { id: { in: ids } }
        })

        // Инвалидируем кеш
        const keysToDelete = await ctx.redis.keys(`${FEATURED_ARTICLES_CACHE_KEY}:*`)
        keysToDelete.push(...(await ctx.redis.keys(`${LATEST_ARTICLES_CACHE_PREFIX}*`)))
        keysToDelete.push(...(await ctx.redis.keys(`${POPULAR_ARTICLES_CACHE_PREFIX}*`)))
        keysToDelete.push(...(await ctx.redis.keys(`${ADMIN_CACHE_PREFIX}*`)))
        if (keysToDelete.length > 0) {
          await ctx.redis.del(keysToDelete)
        }

        // Логируем операцию
        logAdminOperation("bulk_delete_articles", ctx.currentUser?.id || "unknown", {
          deletedCount: deletedArticles.count,
          articleIds: ids
        })

        return articlesToDelete
      } catch (error) {
        handleAdminError(error)
      }
    },

    bulkUpdateArticleStatus: async (
      _parent: any,
      { ids, status }: { ids: string[]; status: any },
      ctx: GraphQLContext
    ) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin")

      // Валидация входных параметров
      validateBulkOperation(ids, 100)

      if (!["draft", "review", "published", "archived"].includes(status)) {
        throw new GraphQLError("Invalid status", { extensions: { code: "VALIDATION_ERROR" } })
      }

      try {
        // Получаем статьи для обновления
        const articlesToUpdate = await ctx.prisma.article.findMany({
          where: { id: { in: ids } },
          include: { author: true, contentType: true, sectionTags: true }
        })

        if (articlesToUpdate.length !== ids.length) {
          throw new GraphQLError("Some articles not found", { extensions: { code: "NOT_FOUND" } })
        }

        // Обновляем статус статей
        const updateData: any = { status }
        if (status === "published") {
          updateData.publishedAt = new Date()
        }

        await ctx.prisma.article.updateMany({
          where: { id: { in: ids } },
          data: updateData
        })

        // Получаем обновленные статьи
        const updatedArticles = await ctx.prisma.article.findMany({
          where: { id: { in: ids } },
          include: { author: true, contentType: true, sectionTags: true }
        })

        // Инвалидируем кеш
        const keysToDelete = await ctx.redis.keys(`${FEATURED_ARTICLES_CACHE_KEY}:*`)
        keysToDelete.push(...(await ctx.redis.keys(`${LATEST_ARTICLES_CACHE_PREFIX}*`)))
        keysToDelete.push(...(await ctx.redis.keys(`${POPULAR_ARTICLES_CACHE_PREFIX}*`)))
        keysToDelete.push(...(await ctx.redis.keys(`${ADMIN_CACHE_PREFIX}*`)))
        if (keysToDelete.length > 0) {
          await ctx.redis.del(keysToDelete)
        }

        // Логируем операцию
        logAdminOperation("bulk_update_article_status", ctx.currentUser?.id || "unknown", {
          updatedCount: updatedArticles.length,
          articleIds: ids,
          newStatus: status
        })

        return updatedArticles
      } catch (error) {
        handleAdminError(error)
      }
    }
  }
}
