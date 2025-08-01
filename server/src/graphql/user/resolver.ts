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
  validateDateRange,
  validateSearchInput,
  logAdminOperation,
  PaginationInput,
  SortInput,
  BaseFilters,
  SearchInput
} from "../../utils/admin"

const USER_CACHE_PREFIX = "user:"
const USER_STATS_CACHE_PREFIX = "user_stats:"
const AUTHOR_ARTICLES_CACHE_PREFIX = "author_articles:"
const AUTHOR_STATS_CACHE_PREFIX = "author_stats:"
const CACHE_TTL = parseInt(process.env.CACHE_TTL || "21600") // время жизни кэша в секундах (по умолчанию 6 часов)

export default {
  Query: {
    user: async (_parent: any, args: { slug: string }, ctx: GraphQLContext) => {
      const cacheKey = `${USER_CACHE_PREFIX}slug:${args.slug}`
      const cachedUser = await ctx.redis.get(cacheKey)

      if (cachedUser) {
        console.log("CACHE: Returning user by slug from cache")
        return JSON.parse(cachedUser)
      }

      console.log("DATABASE: User by slug not in cache, fetching from database")
      const user = await ctx.prisma.user.findUnique({
        where: { slug: args.slug }
      })

      if (user) {
        await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(user))
      }

      return user
    },

    author: async (_parent: any, args: { slug: string }, ctx: GraphQLContext) => {
      const cacheKey = `${USER_CACHE_PREFIX}slug:${args.slug}`
      const cachedUser = await ctx.redis.get(cacheKey)

      if (cachedUser) {
        console.log("CACHE: Returning author by slug from cache")
        return JSON.parse(cachedUser)
      }

      console.log("DATABASE: Author by slug not in cache, fetching from database")
      const author = await ctx.prisma.user.findUnique({
        where: { slug: args.slug, role: "author" }
      })

      if (author) {
        await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(author))
      }

      return author
    },

    articlesByAuthor: async (
      _parent: any,
      { authorSlug, page = 1, limit = 10 }: { authorSlug: string; page: number; limit: number },
      ctx: GraphQLContext
    ) => {
      const cacheKey = `${AUTHOR_ARTICLES_CACHE_PREFIX}${authorSlug}:${page}:${limit}`
      const cachedData = await ctx.redis.get(cacheKey)

      if (cachedData) {
        console.log("CACHE: Returning articles by author from cache")
        return JSON.parse(cachedData)
      }

      console.log("DATABASE: Articles by author not in cache, fetching from database")

      const author = await ctx.prisma.user.findUnique({ where: { slug: authorSlug } })
      if (!author) {
        throw new Error("Author not found")
      }

      const totalCount = await ctx.prisma.article.count({ where: { authorId: author.id, status: "published" } })
      const articles = await ctx.prisma.article.findMany({
        where: { authorId: author.id, status: "published" },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { publishedAt: "desc" },
        include: { contentType: true }
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

    authorStats: async (_parent: any, { authorSlug }: { authorSlug: string }, ctx: GraphQLContext) => {
      const cacheKey = `${AUTHOR_STATS_CACHE_PREFIX}${authorSlug}`
      const cachedStats = await ctx.redis.get(cacheKey)

      if (cachedStats) {
        console.log("CACHE: Returning author stats from cache")
        return JSON.parse(cachedStats)
      }

      console.log("DATABASE: Author stats not in cache, calculating from database")

      const author = await ctx.prisma.user.findUnique({ where: { slug: authorSlug } })
      if (!author) {
        throw new Error("Author not found")
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

      const stats = {
        totalArticles,
        articlesThisMonth,
        popularTags
      }

      await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(stats))
      return stats
    },

    me: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      const user = ensureAuthenticated(ctx.currentUser)

      const cacheKey = `${USER_CACHE_PREFIX}${user.id}`
      const cachedUser = await ctx.redis.get(cacheKey)

      if (cachedUser) {
        console.log("CACHE: Returning user from cache")
        return JSON.parse(cachedUser)
      }

      console.log("DATABASE: User not in cache, fetching from context and setting cache")
      await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(user))

      return user
    },

    myArticlesStats: async (_parent: any, _args: any, ctx: GraphQLContext) => {
      const user = ensureAuthenticated(ctx.currentUser)

      const cacheKey = `${USER_STATS_CACHE_PREFIX}${user.id}`
      const cachedStats = await ctx.redis.get(cacheKey)

      if (cachedStats) {
        console.log("CACHE: Returning user stats from cache")
        return JSON.parse(cachedStats)
      }

      console.log("DATABASE: User stats not in cache, calculating from database")

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

      await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(stats))
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
      ensureHasRole(ctx.currentUser, "admin")

      const { pagination, sort, filters, search } = args

      // Валидация входных параметров
      validatePagination(pagination)
      validateSort(sort, ["id", "name", "email", "role", "slug", "createdAt", "updatedAt", "_count.articles"])

      if (search) {
        validateSearchInput(search, ["name", "email", "bio", "slug"])
      }

      if (filters.base.createdAt) {
        validateDateRange(filters.base.createdAt)
      }

      if (filters.base.updatedAt) {
        validateDateRange(filters.base.updatedAt)
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

      // Создаем ключ кеша
      const cacheKey = getCacheKey("admin_users", { pagination, sort, filters })

      // Получаем данные с кешированием
      const result = await getCachedOrFetch(ctx, cacheKey, async () => {
        // Получаем общее количество
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

        return {
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
      })

      // Логируем операцию
      logAdminOperation("admin_users", ctx.currentUser?.id || "unknown", {
        pagination,
        sort,
        filters
      })

      return result
    }
  }
}
