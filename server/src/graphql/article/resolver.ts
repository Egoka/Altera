import { GraphQLContext } from "../../prisma"
import { ensureAuthenticated, ensureHasRole } from "../../exceptions/permissions"
import { createApiError } from "../../errors/graphql-error"
import {
  validatePagination,
  validateSort,
  buildBaseWhereClause,
  buildOrderBy,
  calculatePagination,
  handleAdminError,
  validateDateRange,
  validateSearchInput,
  validateBulkOperation,
  PaginationInput,
  SortInput,
  BaseFilters,
  SearchInput
} from "../../utils/admin"
import { buildCacheKey, CACHE_TTL_SECONDS } from "../../cache"
import { buildArticleCacheTags } from "../../cache/key"
import { readThroughPublicCache } from "../../cache/read-through"

export default {
  Query: {
    article: async (_parent: any, args: { slug: string }, ctx: GraphQLContext) => {
      return readThroughPublicCache(
        {
          cache: ctx.cache,
          key: buildCacheKey("query.article", args),
          tags: [`article:${args.slug}`],
          ttlSeconds: CACHE_TTL_SECONDS.article,
          cacheWhen: (article) => article?.status === "published"
        },
        () =>
          ctx.prisma.article.findUnique({
            where: { slug: args.slug },
            include: { author: true, contentType: true, sectionTags: true }
          })
      )
    },

    articleDetail: async (_parent: any, args: { slug: string }, ctx: GraphQLContext) => {
      const cacheKey = buildCacheKey("query.articleDetail", args)
      const cachedDetail = await ctx.cache.get(cacheKey)

      if (cachedDetail) {
        return cachedDetail
      }

      const article = await ctx.prisma.article.findUnique({
        where: { slug: args.slug, status: "published" },
        include: { author: true, contentType: true, sectionTags: true }
      })

      if (!article) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
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

      await ctx.cache.set(cacheKey, detail, {
        ttlSeconds: CACHE_TTL_SECONDS.article,
        tags: ["home", `article:${args.slug}`]
      })
      return detail
    },

    recommendedArticles: async (
      _parent: any,
      { articleSlug, limit = 5 }: { articleSlug: string; limit: number },
      ctx: GraphQLContext
    ) => {
      const effectiveArgs = { articleSlug, limit }
      const cacheKey = buildCacheKey("query.recommendedArticles", effectiveArgs)
      const cachedArticles = await ctx.cache.get(cacheKey)

      if (cachedArticles) {
        return cachedArticles
      }

      const article = await ctx.prisma.article.findUnique({
        where: { slug: articleSlug, status: "published" },
        include: { sectionTags: true }
      })

      if (!article) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
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

      await ctx.cache.set(cacheKey, articles, {
        ttlSeconds: CACHE_TTL_SECONDS.publicList,
        tags: ["home", `article:${articleSlug}`]
      })
      return articles
    },

    relatedArticles: async (
      _parent: any,
      { articleSlug, limit = 10 }: { articleSlug: string; limit: number },
      ctx: GraphQLContext
    ) => {
      const effectiveArgs = { articleSlug, limit }
      const cacheKey = buildCacheKey("query.relatedArticles", effectiveArgs)
      const cachedArticles = await ctx.cache.get(cacheKey)

      if (cachedArticles) {
        return cachedArticles
      }

      const article = await ctx.prisma.article.findUnique({
        where: { slug: articleSlug, status: "published" },
        select: { authorId: true, typeId: true }
      })

      if (!article) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
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

      await ctx.cache.set(cacheKey, articles, {
        ttlSeconds: CACHE_TTL_SECONDS.publicList,
        tags: ["home", `article:${articleSlug}`]
      })
      return articles
    },

    articleStats: async (_parent: any, { slug }: { slug: string }, ctx: GraphQLContext) => {
      const cacheKey = buildCacheKey("query.articleStats", { slug })
      const cachedStats = await ctx.cache.get(cacheKey)

      if (cachedStats) {
        return cachedStats
      }

      const article = await ctx.prisma.article.findUnique({
        where: { slug, status: "published" },
        select: { body: true }
      })

      if (!article) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
      }

      const wordCount = article.body.split(/\s+/).length
      const readTime = Math.ceil(wordCount / 200) // Примерно 200 слов в минуту

      const stats = {
        readTime,
        wordCount,
        viewCount: 0, // В будущем можно добавить аналитику
        shareCount: 0 // В будущем можно добавить аналитику
      }

      await ctx.cache.set(cacheKey, stats, {
        ttlSeconds: CACHE_TTL_SECONDS.article,
        tags: [`article:${slug}`]
      })
      return stats
    },

    featuredArticles: async (_parent: any, args: { limit?: number }, ctx: GraphQLContext) => {
      const limit = args.limit || 5
      const effectiveArgs = { ...args, limit }
      const cacheKey = buildCacheKey("query.featuredArticles", effectiveArgs)
      const cachedArticles = await ctx.cache.get(cacheKey)

      if (cachedArticles) {
        return cachedArticles
      }
      // Получаем последние опубликованные статьи как "featured"
      // В будущем можно добавить поле isFeatured в модель Article
      const articles = await ctx.prisma.article.findMany({
        where: { status: "published" },
        orderBy: { publishedAt: "desc" },
        take: limit,
        include: { author: true, contentType: true, sectionTags: true }
      })

      await ctx.cache.set(cacheKey, articles, { ttlSeconds: CACHE_TTL_SECONDS.publicList, tags: ["home"] })
      return articles
    },

    latestArticles: async (_parent: any, args: { limit?: number; excludeFeatured?: boolean }, ctx: GraphQLContext) => {
      const limit = args.limit ?? 20
      const excludeFeatured = args.excludeFeatured ?? false
      const effectiveArgs = { ...args, limit, excludeFeatured }
      const cacheKey = buildCacheKey("query.latestArticles", effectiveArgs)
      const cachedArticles = await ctx.cache.get(cacheKey)

      if (cachedArticles) {
        return cachedArticles
      }

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

      await ctx.cache.set(cacheKey, articles, { ttlSeconds: CACHE_TTL_SECONDS.publicList, tags: ["home"] })
      return articles
    },

    popularArticles: async (_parent: any, args: { timeRange?: string; limit?: number }, ctx: GraphQLContext) => {
      const timeRange = args.timeRange ?? "week"
      const limit = args.limit ?? 10
      const effectiveArgs = { ...args, timeRange, limit }
      const cacheKey = buildCacheKey("query.popularArticles", effectiveArgs)
      const cachedArticles = await ctx.cache.get(cacheKey)

      if (cachedArticles) {
        return cachedArticles
      }

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

      await ctx.cache.set(cacheKey, articles, { ttlSeconds: CACHE_TTL_SECONDS.popular, tags: ["home"] })
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
      ensureHasRole(ctx.currentUser, "admin", "admin.articles.read", ctx.requestId)

      const { pagination, sort, filters, search } = args

      // Валидация входных параметров
      validatePagination(pagination, ctx.requestId)
      validateSort(
        sort,
        ["id", "title", "slug", "status", "publishedAt", "createdAt", "updatedAt", "author.name", "contentType.name"],
        ctx.requestId
      )

      if (search) {
        validateSearchInput(search, ["title", "body", "excerpt", "dek"], ctx.requestId)
      }

      if (filters.base.createdAt) {
        validateDateRange(filters.base.createdAt, ctx.requestId)
      }

      if (filters.base.updatedAt) {
        validateDateRange(filters.base.updatedAt, ctx.requestId)
      }

      if (filters.publishedAt) {
        validateDateRange(filters.publishedAt, ctx.requestId)
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

      const result = {
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

      return result
    }
  },
  Mutation: {
    createArticle: async (_parent: any, { input }: { input: any }, ctx: GraphQLContext) => {
      const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)

      const { sectionTags, ...articleData } = input

      const newArticle = await ctx.prisma.article.create({
        data: {
          ...articleData,
          authorId: user.id,
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
      const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)

      const article = await ctx.prisma.article.findUnique({
        where: { id },
        include: { author: true, contentType: true, sectionTags: true }
      })
      if (!article) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
      }
      if (article.authorId !== user.id) {
        throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "article.edit" })
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

      await ctx.cache.delByTags(buildArticleCacheTags(article, updatedArticle))

      return updatedArticle
    },

    archiveArticle: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)

      const article = await ctx.prisma.article.findUnique({
        where: { id },
        include: { author: true, contentType: true, sectionTags: true }
      })
      if (!article) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
      if (article.authorId !== user.id) {
        throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "article.archive" })
      }

      const updatedArticle = await ctx.prisma.article.update({
        where: { id },
        data: { status: "archived" },
        include: { author: true, contentType: true, sectionTags: true }
      })

      await ctx.cache.delByTags(buildArticleCacheTags(article, updatedArticle))

      return updatedArticle
    },

    requestReview: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)

      const article = await ctx.prisma.article.findUnique({
        where: { id },
        include: { author: true, contentType: true, sectionTags: true }
      })
      if (!article) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
      if (article.authorId !== user.id) {
        throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "article.requestReview" })
      }
      if (article.status !== "draft") {
        throw createApiError("CONFLICT", {
          requestId: ctx.requestId,
          entity: "article",
          expected: "draft",
          actual: article.status
        })
      }

      return ctx.prisma.article.update({
        where: { id },
        data: { status: "review" },
        include: { author: true, contentType: true, sectionTags: true }
      })
    },

    revertToDraft: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)

      const article = await ctx.prisma.article.findUnique({ where: { id } })
      if (!article) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
      if (article.authorId !== user.id) {
        throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "article.revertToDraft" })
      }
      if (article.status !== "review") {
        throw createApiError("CONFLICT", {
          requestId: ctx.requestId,
          entity: "article",
          expected: "review",
          actual: article.status
        })
      }

      return ctx.prisma.article.update({
        where: { id },
        data: { status: "draft" },
        include: { author: true, contentType: true, sectionTags: true }
      })
    },

    setArticleStatus: async (_parent: any, { id, status }: { id: string; status: any }, ctx: GraphQLContext) => {
      ensureHasRole(ctx.currentUser, ["admin"], "article.setStatus", ctx.requestId)

      const article = await ctx.prisma.article.findUnique({ where: { id } })
      if (!article) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })

      const updatedArticle = await ctx.prisma.article.update({
        where: { id },
        data: {
          status,
          publishedAt: status === "published" && article.status !== "published" ? new Date() : article.publishedAt
        },
        include: { author: true, contentType: true, sectionTags: true }
      })

      await ctx.cache.delByTags(buildArticleCacheTags(article, updatedArticle))

      return updatedArticle
    },

    // Админ мутации для массовых операций
    bulkDeleteArticles: async (_parent: any, { ids }: { ids: string[] }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin", "article.bulkDelete", ctx.requestId)

      // Валидация входных параметров
      validateBulkOperation(ids, ctx.requestId, 100)

      try {
        // Получаем статьи для проверки существования и инвалидации кеша
        const articlesToDelete = await ctx.prisma.article.findMany({
          where: { id: { in: ids } },
          include: { author: true, contentType: true, sectionTags: true }
        })

        if (articlesToDelete.length !== ids.length) {
          throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
        }

        // Удаляем статьи
        await ctx.prisma.article.deleteMany({
          where: { id: { in: ids } }
        })

        await ctx.cache.delByTags(buildArticleCacheTags(...articlesToDelete))

        return articlesToDelete
      } catch (error) {
        handleAdminError(error, ctx.requestId, "article")
      }
    },

    bulkUpdateArticleStatus: async (
      _parent: any,
      { ids, status }: { ids: string[]; status: any },
      ctx: GraphQLContext
    ) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin", "article.bulkUpdateStatus", ctx.requestId)

      // Валидация входных параметров
      validateBulkOperation(ids, ctx.requestId, 100)

      if (!["draft", "review", "published", "archived"].includes(status)) {
        throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "status", rule: "enum" })
      }

      try {
        // Получаем статьи для обновления
        const articlesToUpdate = await ctx.prisma.article.findMany({
          where: { id: { in: ids } },
          include: { author: true, contentType: true, sectionTags: true }
        })

        if (articlesToUpdate.length !== ids.length) {
          throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
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

        await ctx.cache.delByTags(buildArticleCacheTags(...articlesToUpdate, ...updatedArticles))

        return updatedArticles
      } catch (error) {
        handleAdminError(error, ctx.requestId, "article")
      }
    }
  }
}
