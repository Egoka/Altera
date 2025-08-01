import { GraphQLError } from "graphql"
import { GraphQLContext } from "../../prisma"
import { ensureHasRole } from "../../exceptions/permissions"
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
  logAdminOperation,
  ADMIN_CACHE_PREFIX,
  PaginationInput,
  SortInput,
  BaseFilters,
  SearchInput
} from "../../utils/admin"

const CONTENT_TYPE_CACHE_PREFIX = "content_type:"
const CONTENT_TYPE_ARTICLES_CACHE_PREFIX = "content_type_articles:"
const CONTENT_TYPE_STATS_CACHE_PREFIX = "content_type_stats:"
const CACHE_TTL = parseInt(process.env.CACHE_TTL || "21600") // время жизни кэша в секундах (по умолчанию 6 часов)

export default {
  Query: {
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
    },

    // Запрос для управления типами контента (требует права admin)
    contentTypes: async (
      _parent: any,
      args: {
        pagination: PaginationInput
        sort: SortInput
        filters: {
          base: BaseFilters
          status?: string[]
          hasArticles?: boolean
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
      validateSort(sort, ["id", "name", "slug", "order", "status", "createdAt", "updatedAt", "_count.articles"])

      if (search) {
        validateSearchInput(search, ["name", "description", "slug"])
      }

      if (filters.base.createdAt) {
        validateDateRange(filters.base.createdAt)
      }

      if (filters.base.updatedAt) {
        validateDateRange(filters.base.updatedAt)
      }

      // Строим WHERE условие
      const where: any = buildBaseWhereClause(filters.base, search)

      // Добавляем специфичные фильтры для типов контента
      if (filters.status?.length) {
        where.status = { in: filters.status }
      }

      if (filters.hasArticles !== undefined) {
        if (filters.hasArticles) {
          where.articles = { some: {} }
        } else {
          where.articles = { none: {} }
        }
      }

      // Создаем ключ кеша
      const cacheKey = getCacheKey("admin_content_types", { pagination, sort, filters })

      // Получаем данные с кешированием
      const result = await getCachedOrFetch(ctx, cacheKey, async () => {
        // Получаем общее количество
        const total = await ctx.prisma.contentType.count({ where })

        // Рассчитываем пагинацию
        const { skip, take, pagination: paginationInfo } = calculatePagination(pagination.page, pagination.limit, total)

        // Получаем данные
        const contentTypes = await ctx.prisma.contentType.findMany({
          where,
          skip,
          take,
          orderBy: buildOrderBy(sort),
          include: {
            _count: {
              select: { articles: true }
            }
          }
        })

        return {
          contentTypes,
          pagination: paginationInfo,
          filters: {
            base: {
              status: filters.base.status,
              createdAt: filters.base.createdAt,
              updatedAt: filters.base.updatedAt
            },
            status: filters.status,
            hasArticles: filters.hasArticles
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
      logAdminOperation("admin_content_types", ctx.currentUser?.id || "unknown", {
        pagination,
        sort,
        filters
      })

      return result
    }
  },

  Mutation: {
    // Админ мутации для управления типами контента
    createContentType: async (_parent: any, { input }: { input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin")

      try {
        const newContentType = await ctx.prisma.contentType.create({
          data: input,
          include: {
            _count: {
              select: { articles: true }
            }
          }
        })

        // Инвалидируем кеш
        const keysToDelete = await ctx.redis.keys(`${CONTENT_TYPE_CACHE_PREFIX}*`)
        keysToDelete.push(...(await ctx.redis.keys(`${ADMIN_CACHE_PREFIX}*`)))
        if (keysToDelete.length > 0) {
          await ctx.redis.del(keysToDelete)
        }

        // Логируем операцию
        logAdminOperation("create_content_type", ctx.currentUser?.id || "unknown", {
          contentTypeId: newContentType.id,
          contentTypeName: newContentType.name
        })

        return newContentType
      } catch (error) {
        handleAdminError(error)
      }
    },

    updateContentType: async (_parent: any, { id, input }: { id: string; input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin")

      try {
        const updatedContentType = await ctx.prisma.contentType.update({
          where: { id },
          data: input,
          include: {
            _count: {
              select: { articles: true }
            }
          }
        })

        // Инвалидируем кеш
        const keysToDelete = await ctx.redis.keys(`${CONTENT_TYPE_CACHE_PREFIX}*`)
        keysToDelete.push(...(await ctx.redis.keys(`${ADMIN_CACHE_PREFIX}*`)))
        if (keysToDelete.length > 0) {
          await ctx.redis.del(keysToDelete)
        }

        // Логируем операцию
        logAdminOperation("update_content_type", ctx.currentUser?.id || "unknown", {
          contentTypeId: id,
          updates: input
        })

        return updatedContentType
      } catch (error) {
        handleAdminError(error)
      }
    },

    deleteContentType: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin")

      try {
        // Проверяем, есть ли статьи с этим типом контента
        const contentTypeWithArticles = await ctx.prisma.contentType.findUnique({
          where: { id },
          include: {
            articles: true,
            _count: {
              select: { articles: true }
            }
          }
        })

        if (!contentTypeWithArticles) {
          throw new GraphQLError("Content type not found", { extensions: { code: "NOT_FOUND" } })
        }

        if (contentTypeWithArticles._count.articles > 0) {
          throw new GraphQLError(
            `Cannot delete content type "${contentTypeWithArticles.name}" because it has ${contentTypeWithArticles._count.articles} articles. Please reassign articles first.`,
            { extensions: { code: "CONSTRAINT_VIOLATION" } }
          )
        }

        const deletedContentType = await ctx.prisma.contentType.delete({
          where: { id },
          include: {
            _count: {
              select: { articles: true }
            }
          }
        })

        // Инвалидируем кеш
        const keysToDelete = await ctx.redis.keys(`${CONTENT_TYPE_CACHE_PREFIX}*`)
        keysToDelete.push(...(await ctx.redis.keys(`${ADMIN_CACHE_PREFIX}*`)))
        if (keysToDelete.length > 0) {
          await ctx.redis.del(keysToDelete)
        }

        // Логируем операцию
        logAdminOperation("delete_content_type", ctx.currentUser?.id || "unknown", {
          contentTypeId: id,
          contentTypeName: deletedContentType.name
        })

        return deletedContentType
      } catch (error) {
        handleAdminError(error)
      }
    },

    reorderContentTypes: async (_parent: any, { input }: { input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin")

      const { items } = input

      // Валидация входных параметров
      if (!items || items.length === 0) {
        throw new GraphQLError("No items to reorder", { extensions: { code: "VALIDATION_ERROR" } })
      }

      if (items.length > 100) {
        throw new GraphQLError("Cannot reorder more than 100 items at once", {
          extensions: { code: "VALIDATION_ERROR" }
        })
      }

      try {
        // Начинаем транзакцию
        const updatedContentTypes = await ctx.prisma.$transaction(async (tx) => {
          const updates = []

          for (const item of items) {
            const update = tx.contentType.update({
              where: { id: item.id },
              data: { order: item.order },
              include: {
                _count: {
                  select: { articles: true }
                }
              }
            })
            updates.push(update)
          }

          return await Promise.all(updates)
        })

        // Инвалидируем кеш
        const keysToDelete = await ctx.redis.keys(`${CONTENT_TYPE_CACHE_PREFIX}*`)
        keysToDelete.push(...(await ctx.redis.keys(`${ADMIN_CACHE_PREFIX}*`)))
        if (keysToDelete.length > 0) {
          await ctx.redis.del(keysToDelete)
        }

        // Логируем операцию
        logAdminOperation("reorder_content_types", ctx.currentUser?.id || "unknown", {
          reorderedItems: items.length,
          items
        })

        return updatedContentTypes
      } catch (error) {
        handleAdminError(error)
      }
    },

    archiveContentType: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin")

      try {
        const archivedContentType = await ctx.prisma.contentType.update({
          where: { id },
          data: { status: "archived" },
          include: {
            _count: {
              select: { articles: true }
            }
          }
        })

        // Инвалидируем кеш
        const keysToDelete = await ctx.redis.keys(`${CONTENT_TYPE_CACHE_PREFIX}*`)
        keysToDelete.push(...(await ctx.redis.keys(`${ADMIN_CACHE_PREFIX}*`)))
        if (keysToDelete.length > 0) {
          await ctx.redis.del(keysToDelete)
        }

        // Логируем операцию
        logAdminOperation("archive_content_type", ctx.currentUser?.id || "unknown", {
          contentTypeId: id,
          contentTypeName: archivedContentType.name
        })

        return archivedContentType
      } catch (error) {
        handleAdminError(error)
      }
    }
  }
}
