import { GraphQLContext } from "../../prisma"
import { ensureAuthenticated, ensureHasRole } from "../../exceptions/permissions"
import { createApiError } from "../../errors/graphql-error"
import {
  validatePagination,
  validateSort,
  buildBaseWhereClause,
  buildOrderBy,
  calculatePagination,
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
    user: async (_parent: unknown, args: { handle: string }, ctx: GraphQLContext) => {
      return ctx.prisma.user.findUnique({
        where: { handle: args.handle }
      })
    },

    author: async (_parent: unknown, args: { handle: string }, ctx: GraphQLContext) => {
      return ctx.prisma.user.findUnique({
        where: { handle: args.handle, role: "author" }
      })
    },

    articlesByAuthor: async (
      _parent: any,
      { authorHandle, page = 1, limit = 10 }: { authorHandle: string; page: number; limit: number },
      ctx: GraphQLContext
    ) => {
      const effectiveArgs = { authorHandle, page, limit }
      const cacheKey = buildCacheKey("query.articlesByAuthor", effectiveArgs)

      return readThroughPublicCache(
        {
          cache: ctx.cache,
          key: cacheKey,
          tags: [`author:${authorHandle}`],
          ttlSeconds: CACHE_TTL_SECONDS.publicList
        },
        async () => {
          const author = await ctx.prisma.user.findUnique({ where: { handle: authorHandle } })
          if (!author) {
            throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "author" })
          }

          const totalCount = await ctx.prisma.article.count({ where: { authorId: author.id, status: "published" } })
          const articles = await ctx.prisma.article.findMany({
            where: { authorId: author.id, status: "published" },
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { publishedAt: "desc" },
            include: { section: true }
          })

          const response = {
            articles,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            currentPage: page
          }

          return response
        }
      )
    },

    authorStats: async (_parent: unknown, { authorHandle }: { authorHandle: string }, ctx: GraphQLContext) => {
      const cacheKey = buildCacheKey("query.authorStats", { authorHandle })
      return readThroughPublicCache(
        {
          cache: ctx.cache,
          key: cacheKey,
          tags: [`author:${authorHandle}`],
          ttlSeconds: CACHE_TTL_SECONDS.publicList
        },
        async () => {
          const author = await ctx.prisma.user.findUnique({ where: { handle: authorHandle } })
          if (!author) {
            throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "author" })
          }

          const totalArticles = await ctx.prisma.article.count({
            where: { authorId: author.id, status: "published" }
          })

          const oneMonthAgo = new Date()
          oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)

          const articlesThisMonth = await ctx.prisma.article.count({
            where: {
              authorId: author.id,
              status: "published",
              publishedAt: { gte: oneMonthAgo }
            }
          })

          const articlesWithTags = await ctx.prisma.article.findMany({
            where: { authorId: author.id, status: "published" },
            select: { tags: { select: { name: true, slug: true } } }
          })

          const tagCounts: { [slug: string]: { name: string; slug: string; count: number } } = {}
          articlesWithTags
            .flatMap((a) => a.tags)
            .forEach((tag) => {
              if (!tagCounts[tag.slug]) {
                tagCounts[tag.slug] = { ...tag, count: 0 }
              }
              tagCounts[tag.slug].count++
            })

          const popularTags = Object.values(tagCounts)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5) // Top 5 tags

          const stats = {
            totalArticles,
            articlesThisMonth,
            popularTags
          }

          return stats
        }
      )
    },

    me: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      return ensureAuthenticated(ctx.currentUser, ctx.requestId)
    },

    myArticlesStats: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)

      // Получаем статистику по статьям пользователя
      const [total, published, draft, review, archived] = await Promise.all([
        ctx.prisma.article.count({
          where: { authorId: user.id }
        }),
        ctx.prisma.article.count({
          where: { authorId: user.id, status: "published" }
        }),
        ctx.prisma.article.count({
          where: { authorId: user.id, status: "draft" }
        }),
        ctx.prisma.article.count({
          where: { authorId: user.id, status: "review" }
        }),
        ctx.prisma.article.count({
          where: { authorId: user.id, status: "archived" }
        })
      ])

      const stats = {
        total,
        published,
        draft,
        review,
        archived
      }

      return stats
    },

    // Запрос для управления пользователями (требует права admin)
    users: async (
      _parent: any,
      args: {
        pagination: PaginationInput
        sort: SortInput
        filters: {
          base: BaseFilters
          role?: string[]
          hasArticles?: boolean
        }
        search?: SearchInput
      },
      ctx: GraphQLContext
    ) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin", "admin.users.read", ctx.requestId)

      const { pagination, sort, filters, search } = args

      // Валидация входных параметров
      validatePagination(pagination, ctx.requestId)
      validateSort(
        sort,
        ["id", "name", "email", "role", "handle", "createdAt", "updatedAt", "_count.articles"],
        ctx.requestId
      )

      if (search) {
        validateSearchInput(search, ["name", "email", "bio", "handle"], ctx.requestId)
      }

      if (filters.base.createdAt) {
        validateDateRange(filters.base.createdAt, ctx.requestId)
      }

      if (filters.base.updatedAt) {
        validateDateRange(filters.base.updatedAt, ctx.requestId)
      }

      // Строим WHERE условие
      const where: any = buildBaseWhereClause(filters.base, search)

      // Добавляем специфичные фильтры для пользователей
      if (filters.role?.length) {
        where.role = { in: filters.role }
      }

      if (filters.hasArticles !== undefined) {
        if (filters.hasArticles) {
          where.articles = { some: {} }
        } else {
          where.articles = { none: {} }
        }
      }

      const total = await ctx.prisma.user.count({ where })

      // Рассчитываем пагинацию
      const { skip, take, pagination: paginationInfo } = calculatePagination(pagination.page, pagination.limit, total)

      // Получаем данные
      const users = await ctx.prisma.user.findMany({
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
        users,
        pagination: paginationInfo,
        filters: {
          base: {
            status: filters.base.status,
            createdAt: filters.base.createdAt,
            updatedAt: filters.base.updatedAt
          },
          role: filters.role,
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

      return result
    }
  }
}
