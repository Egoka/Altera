import { GraphQLContext } from "../../prisma"
import { ensureHasRole } from "../../exceptions/permissions"
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
  PaginationInput,
  SortInput,
  BaseFilters,
  SearchInput
} from "../../utils/admin"
import { buildCacheKey, CACHE_TTL_SECONDS } from "../../cache"
import { readThroughPublicCache } from "../../cache/read-through"

export default {
  Query: {
    contentType: async (_parent: any, args: { slug: string }, ctx: GraphQLContext) => {
      return readThroughPublicCache(
        {
          cache: ctx.cache,
          key: buildCacheKey("query.contentType", args),
          tags: [`content-type:${args.slug}`],
          ttlSeconds: CACHE_TTL_SECONDS.publicList,
          cacheWhen: (contentType) => contentType?.status === "active"
        },
        () => ctx.prisma.contentType.findUnique({ where: { slug: args.slug } })
      )
    },

    articlesByContentType: async (
      _parent: any,
      { contentTypeSlug, page = 1, limit = 10 }: { contentTypeSlug: string; page: number; limit: number },
      ctx: GraphQLContext
    ) => {
      const cacheKey = buildCacheKey("query.articlesByContentType", { contentTypeSlug, page, limit })
      const cachedData = await ctx.cache.get(cacheKey)

      if (cachedData) {
        return cachedData
      }

      const contentType = await ctx.prisma.contentType.findUnique({ where: { slug: contentTypeSlug } })
      if (!contentType) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "contentType" })
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

      await ctx.cache.set(cacheKey, response, {
        ttlSeconds: CACHE_TTL_SECONDS.publicList,
        tags: [`content-type:${contentTypeSlug}`]
      })
      return response
    },

    contentTypeStats: async (_parent: any, { contentTypeSlug }: { contentTypeSlug: string }, ctx: GraphQLContext) => {
      const contentType = await ctx.prisma.contentType.findUnique({ where: { slug: contentTypeSlug } })
      if (!contentType) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "contentType" })
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
      ensureHasRole(ctx.currentUser, "admin", "admin.contentTypes.read", ctx.requestId)

      const { pagination, sort, filters, search } = args

      // Валидация входных параметров
      validatePagination(pagination, ctx.requestId)
      validateSort(
        sort,
        ["id", "name", "slug", "order", "status", "createdAt", "updatedAt", "_count.articles"],
        ctx.requestId
      )

      if (search) {
        validateSearchInput(search, ["name", "description", "slug"], ctx.requestId)
      }

      if (filters.base.createdAt) {
        validateDateRange(filters.base.createdAt, ctx.requestId)
      }

      if (filters.base.updatedAt) {
        validateDateRange(filters.base.updatedAt, ctx.requestId)
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

      const result = {
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
        search: search ? { query: search.query, fields: search.fields } : null
      }

      return result
    }
  },

  Mutation: {
    // Админ мутации для управления типами контента
    createContentType: async (_parent: any, { input }: { input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin", "contentType.create", ctx.requestId)

      try {
        const newContentType = await ctx.prisma.contentType.create({
          data: input,
          include: {
            _count: {
              select: { articles: true }
            }
          }
        })

        await ctx.cache.delByTags(["home", `content-type:${newContentType.slug}`])

        return newContentType
      } catch (error) {
        handleAdminError(error, ctx.requestId, "contentType")
      }
    },

    updateContentType: async (_parent: any, { id, input }: { id: string; input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin", "contentType.update", ctx.requestId)

      try {
        const previousContentType = await ctx.prisma.contentType.findUnique({ where: { id }, select: { slug: true } })
        const updatedContentType = await ctx.prisma.contentType.update({
          where: { id },
          data: input,
          include: {
            _count: {
              select: { articles: true }
            }
          }
        })

        await ctx.cache.delByTags([
          "home",
          `content-type:${previousContentType?.slug ?? updatedContentType.slug}`,
          `content-type:${updatedContentType.slug}`
        ])

        return updatedContentType
      } catch (error) {
        handleAdminError(error, ctx.requestId, "contentType")
      }
    },

    deleteContentType: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin", "contentType.delete", ctx.requestId)

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
          throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "contentType" })
        }

        if (contentTypeWithArticles._count.articles > 0) {
          throw createApiError("CONFLICT", {
            requestId: ctx.requestId,
            entity: "contentType",
            expected: "no articles",
            actual: `${contentTypeWithArticles._count.articles} articles`
          })
        }

        const deletedContentType = await ctx.prisma.contentType.delete({
          where: { id },
          include: {
            _count: {
              select: { articles: true }
            }
          }
        })

        await ctx.cache.delByTags(["home", `content-type:${deletedContentType.slug}`])

        return deletedContentType
      } catch (error) {
        handleAdminError(error, ctx.requestId, "contentType")
      }
    },

    reorderContentTypes: async (_parent: any, { input }: { input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin", "contentType.reorder", ctx.requestId)

      const { items } = input

      // Валидация входных параметров
      if (!items || items.length === 0) {
        throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "items", rule: "required" })
      }

      if (items.length > 100) {
        throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "items", rule: "maxItems:100" })
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

        await ctx.cache.delByTags([
          "home",
          ...updatedContentTypes.map((contentType) => `content-type:${contentType.slug}`)
        ])

        return updatedContentTypes
      } catch (error) {
        handleAdminError(error, ctx.requestId, "contentType")
      }
    },

    archiveContentType: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin", "contentType.archive", ctx.requestId)

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

        await ctx.cache.delByTags(["home", `content-type:${archivedContentType.slug}`])

        return archivedContentType
      } catch (error) {
        handleAdminError(error, ctx.requestId, "contentType")
      }
    }
  }
}
