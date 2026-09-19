import { GraphQLContext } from "../../prisma"
import { ensureActiveAuthor, ensureAuthenticated, ensurePermission } from "../../exceptions/permissions"
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
import { readThroughPublicCache } from "../../cache/read-through"
import { archiveTag, createTag, mergeTags, restoreTag, updateTag } from "../../taxonomy/service"
import { publicArticleSelect, publicArticleWhere, publicTagSelect, publicUserSelect } from "../../visibility/article"

export default {
  Query: {
    tagAutocomplete: async (_parent: any, args: { q: string; limit?: number | null }, ctx: GraphQLContext) => {
      ensureAuthenticated(ctx.currentUser, ctx.requestId)
      // Явный null в GraphQL не подставляет значение по умолчанию из схемы.
      const limit = args.limit ?? 10
      const query = args.q.trim()
      if (query.length < 2) {
        throw createApiError("VALIDATION_ERROR", {
          requestId: ctx.requestId,
          field: "q",
          rule: "minLength:2"
        })
      }
      if (limit < 1 || limit > 20) {
        throw createApiError("VALIDATION_ERROR", {
          requestId: ctx.requestId,
          field: "limit",
          rule: "range:1-20"
        })
      }

      const matching = (filter: { startsWith: string } | { contains: string }) => {
        const condition = { ...filter, mode: "insensitive" as const }
        return [{ name: condition }, { nameEn: condition }, { slug: condition }]
      }

      // Сначала совпадения по началу: иначе точный тег может не попасть в лимит среди подстрок.
      const prefixMatches = await ctx.prisma.tag.findMany({
        where: { status: "active", OR: matching({ startsWith: query }) },
        orderBy: { name: "asc" },
        take: limit
      })
      if (prefixMatches.length >= limit) return prefixMatches

      const otherMatches = await ctx.prisma.tag.findMany({
        where: {
          status: "active",
          id: { notIn: prefixMatches.map((tag) => tag.id) },
          OR: matching({ contains: query })
        },
        orderBy: { name: "asc" },
        take: limit - prefixMatches.length
      })
      return [...prefixMatches, ...otherMatches]
    },

    tag: async (_parent: any, args: { slug: string }, ctx: GraphQLContext) => {
      return readThroughPublicCache(
        {
          cache: ctx.cache,
          key: buildCacheKey("query.tag", args),
          tags: [`tag:${args.slug}`],
          ttlSeconds: CACHE_TTL_SECONDS.publicList
        },
        () => ctx.prisma.tag.findUnique({ where: { slug: args.slug }, select: publicTagSelect })
      )
    },

    articlesByTag: async (
      _parent: any,
      { tagSlug, page = 1, limit = 10 }: { tagSlug: string; page: number; limit: number },
      ctx: GraphQLContext
    ) => {
      const cacheKey = buildCacheKey("query.articlesByTag", { tagSlug, page, limit })
      const cachedData = await ctx.cache.get(cacheKey)

      if (cachedData) {
        return cachedData
      }

      const tag = await ctx.prisma.tag.findUnique({ where: { slug: tagSlug } })
      if (!tag) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "tag" })
      }

      const totalCount = await ctx.prisma.article.count({
        where: publicArticleWhere({ tags: { some: { slug: tagSlug } } })
      })
      const articles = await ctx.prisma.article.findMany({
        where: publicArticleWhere({ tags: { some: { slug: tagSlug } } }),
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { publishedAt: "desc" },
        select: publicArticleSelect
      })

      const response = {
        articles,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: page
      }

      await ctx.cache.set(cacheKey, response, {
        ttlSeconds: CACHE_TTL_SECONDS.publicList,
        tags: [`tag:${tagSlug}`]
      })
      return response
    },

    tagStats: async (_parent: any, { tagSlug }: { tagSlug: string }, ctx: GraphQLContext) => {
      const tag = await ctx.prisma.tag.findUnique({ where: { slug: tagSlug } })
      if (!tag) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "tag" })
      }

      const totalArticles = await ctx.prisma.article.count({
        where: publicArticleWhere({ tags: { some: { slug: tagSlug } } })
      })

      const oneMonthAgo = new Date()
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)

      const articlesThisMonth = await ctx.prisma.article.count({
        where: publicArticleWhere({
          tags: { some: { slug: tagSlug } },
          publishedAt: { gte: oneMonthAgo }
        })
      })

      // Получаем популярных авторов для этого тега
      const popularAuthors = await ctx.prisma.user.findMany({
        where: {
          articles: {
            some: publicArticleWhere({ tags: { some: { slug: tagSlug } } })
          }
        },
        take: 5,
        orderBy: {
          articles: {
            _count: "desc"
          }
        },
        select: publicUserSelect
      })

      // Рассчитываем среднее время чтения (примерная оценка)
      const articlesWithBody = await ctx.prisma.article.findMany({
        where: publicArticleWhere({ tags: { some: { slug: tagSlug } } }),
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

      return stats
    },

    // Запрос для управления тегами (требует права admin)
    tags: async (
      _parent: any,
      args: {
        pagination: PaginationInput
        sort: SortInput
        filters: {
          base: BaseFilters
          hasArticles?: boolean
        }
        search?: SearchInput
      },
      ctx: GraphQLContext
    ) => {
      // Проверка прав доступа
      ensurePermission(ctx.currentUser, "taxonomy", "admin.tags.read", ctx.requestId)

      const { pagination, sort, filters, search } = args

      // Валидация входных параметров
      validatePagination(pagination, ctx.requestId)
      validateSort(sort, ["id", "name", "slug", "createdAt", "updatedAt", "_count.articles"], ctx.requestId)

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

      // Добавляем специфичные фильтры для тегов
      if (filters.hasArticles !== undefined) {
        if (filters.hasArticles) {
          where.articles = { some: {} }
        } else {
          where.articles = { none: {} }
        }
      }

      const total = await ctx.prisma.tag.count({ where })

      // Рассчитываем пагинацию
      const { skip, take, pagination: paginationInfo } = calculatePagination(pagination.page, pagination.limit, total)

      // Получаем данные
      const tags = await ctx.prisma.tag.findMany({
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
        tags,
        pagination: paginationInfo,
        filters: {
          base: {
            status: filters.base.status,
            createdAt: filters.base.createdAt,
            updatedAt: filters.base.updatedAt
          },
          hasArticles: filters.hasArticles
        },
        sort: { field: sort.field, direction: sort.direction },
        search: search ? { query: search.query, fields: search.fields } : null
      }

      return result
    }
  },

  Mutation: {
    // Админ мутации для управления тегами
    createTag: async (_parent: any, { input }: { input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
      if (user.role === "reader" || user.role === "author") {
        ensureActiveAuthor(user, "tag.create", ctx.requestId, { logger: ctx.logger })
      } else {
        ensurePermission(user, "taxonomy", "tag.create", ctx.requestId)
      }

      try {
        const newTag = await createTag(ctx.prisma, {
          input,
          actor: ctx.currentUser!,
          requestId: ctx.requestId
        })

        await ctx.cache.delByTags(["home", `tag:${newTag.slug}`])

        return newTag
      } catch (error) {
        handleAdminError(error, ctx.requestId, "tag")
      }
    },

    updateTag: async (_parent: any, { id, input }: { id: string; input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensurePermission(ctx.currentUser, "taxonomy", "tag.update", ctx.requestId)

      try {
        const previousTag = await ctx.prisma.tag.findUnique({ where: { id }, select: { slug: true } })
        const updatedTag = await updateTag(ctx.prisma, {
          tagId: id,
          input,
          actor: ctx.currentUser!,
          requestId: ctx.requestId
        })

        await ctx.cache.delByTags(["home", `tag:${previousTag?.slug ?? updatedTag.slug}`, `tag:${updatedTag.slug}`])

        return updatedTag
      } catch (error) {
        handleAdminError(error, ctx.requestId, "tag")
      }
    },

    deleteTag: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensurePermission(ctx.currentUser, "taxonomy", "tag.delete", ctx.requestId)

      try {
        // Проверяем, есть ли статьи с этим тегом
        const tagWithArticles = await ctx.prisma.tag.findUnique({
          where: { id },
          include: {
            articles: true,
            _count: {
              select: { articles: true }
            }
          }
        })

        if (!tagWithArticles) {
          throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "tag" })
        }

        if (tagWithArticles._count.articles > 0) {
          throw createApiError("CONFLICT", {
            requestId: ctx.requestId,
            entity: "tag",
            expected: "no articles",
            actual: `${tagWithArticles._count.articles} articles`
          })
        }

        const deletedTag = await ctx.prisma.tag.delete({
          where: { id },
          include: {
            _count: {
              select: { articles: true }
            }
          }
        })

        await ctx.cache.delByTags(["home", `tag:${deletedTag.slug}`])

        return deletedTag
      } catch (error) {
        handleAdminError(error, ctx.requestId, "tag")
      }
    },

    mergeTags: async (_parent: any, { input }: { input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensurePermission(ctx.currentUser, "taxonomy", "tag.merge", ctx.requestId)

      const { sourceTagIds, targetTagId } = input

      // Валидация входных параметров
      validateBulkOperation(sourceTagIds, ctx.requestId, 10)

      if (sourceTagIds.includes(targetTagId)) {
        throw createApiError("VALIDATION_ERROR", {
          requestId: ctx.requestId,
          field: "targetTagId",
          rule: "not-in-sourceTagIds"
        })
      }

      try {
        const sourceTags = await ctx.prisma.tag.findMany({
          where: { id: { in: sourceTagIds } }
        })
        const targetTag = await ctx.prisma.tag.findUnique({
          where: { id: targetTagId }
        })
        if (!targetTag) {
          throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "tag" })
        }
        const result = await mergeTags(ctx.prisma, {
          sourceTagIds,
          targetTagId,
          actor: ctx.currentUser!,
          requestId: ctx.requestId
        })

        await ctx.cache.delByTags(["home", ...sourceTags.map((tag) => `tag:${tag.slug}`), `tag:${targetTag.slug}`])

        return result
      } catch (error) {
        handleAdminError(error, ctx.requestId, "tag")
      }
    },

    archiveTag: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      ensurePermission(ctx.currentUser, "taxonomy", "tag.archive", ctx.requestId)
      const tag = await archiveTag(ctx.prisma, { tagId: id, actor: ctx.currentUser!, requestId: ctx.requestId })
      await ctx.cache.delByTags(["home", `tag:${tag.slug}`])
      return tag
    },

    restoreTag: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      ensurePermission(ctx.currentUser, "taxonomy", "tag.restore", ctx.requestId)
      const tag = await restoreTag(ctx.prisma, { tagId: id, actor: ctx.currentUser!, requestId: ctx.requestId })
      await ctx.cache.delByTags(["home", `tag:${tag.slug}`])
      return tag
    }
  }
}
