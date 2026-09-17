import { GraphQLContext } from "../../prisma"
import { ensurePermission } from "../../exceptions/permissions"
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
import { archiveSection, createSection, restoreSection, updateSection } from "../../taxonomy/service"
import { publicArticleInclude, publicArticleWhere, publicUserSelect } from "../../visibility/article"

export default {
  Query: {
    publicSections: async (_parent: unknown, _args: Record<string, never>, ctx: GraphQLContext) => {
      const sections = await ctx.prisma.section.findMany({
        where: {
          status: "active",
          articles: { some: publicArticleWhere() }
        },
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          nameEn: true,
          slug: true,
          order: true,
          _count: { select: { articles: { where: publicArticleWhere() } } }
        }
      })

      return sections.map(({ _count, ...section }) => ({ ...section, articleCount: _count.articles }))
    },

    section: async (_parent: any, args: { slug: string }, ctx: GraphQLContext) => {
      return readThroughPublicCache(
        {
          cache: ctx.cache,
          key: buildCacheKey("query.section", args),
          tags: [`section:${args.slug}`],
          ttlSeconds: CACHE_TTL_SECONDS.publicList,
          cacheWhen: (section) => section?.status === "active"
        },
        () => ctx.prisma.section.findUnique({ where: { slug: args.slug } })
      )
    },

    articlesBySection: async (
      _parent: any,
      { sectionSlug, page = 1, limit = 10 }: { sectionSlug: string; page: number; limit: number },
      ctx: GraphQLContext
    ) => {
      const cacheKey = buildCacheKey("query.articlesBySection", { sectionSlug, page, limit })
      const cachedData = await ctx.cache.get(cacheKey)

      if (cachedData) {
        return cachedData
      }

      const section = await ctx.prisma.section.findUnique({ where: { slug: sectionSlug } })
      if (!section) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "section" })
      }

      const totalCount = await ctx.prisma.article.count({
        where: publicArticleWhere({ section: { slug: sectionSlug } })
      })
      const articles = await ctx.prisma.article.findMany({
        where: publicArticleWhere({ section: { slug: sectionSlug } }),
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { publishedAt: "desc" },
        include: publicArticleInclude
      })

      const response = {
        articles,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: page
      }

      await ctx.cache.set(cacheKey, response, {
        ttlSeconds: CACHE_TTL_SECONDS.publicList,
        tags: [`section:${sectionSlug}`]
      })
      return response
    },

    sectionStats: async (_parent: any, { sectionSlug }: { sectionSlug: string }, ctx: GraphQLContext) => {
      const section = await ctx.prisma.section.findUnique({ where: { slug: sectionSlug } })
      if (!section) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "section" })
      }

      const totalArticles = await ctx.prisma.article.count({
        where: publicArticleWhere({ section: { slug: sectionSlug } })
      })

      const oneMonthAgo = new Date()
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)

      const articlesThisMonth = await ctx.prisma.article.count({
        where: publicArticleWhere({
          section: { slug: sectionSlug },
          publishedAt: { gte: oneMonthAgo }
        })
      })

      // Получаем популярные теги для этого типа контента
      const articlesWithTags = await ctx.prisma.article.findMany({
        where: publicArticleWhere({ section: { slug: sectionSlug } }),
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

      // Получаем топ авторов для этого типа контента
      const topAuthors = await ctx.prisma.user.findMany({
        where: {
          articles: {
            some: publicArticleWhere({ section: { slug: sectionSlug } })
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

      // Рассчитываем среднее время чтения
      const articlesWithBody = await ctx.prisma.article.findMany({
        where: publicArticleWhere({ section: { slug: sectionSlug } }),
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
    sections: async (
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
      ensurePermission(ctx.currentUser, "taxonomy", "admin.sections.read", ctx.requestId)

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

      const total = await ctx.prisma.section.count({ where })

      // Рассчитываем пагинацию
      const { skip, take, pagination: paginationInfo } = calculatePagination(pagination.page, pagination.limit, total)

      // Получаем данные
      const sections = await ctx.prisma.section.findMany({
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
        sections,
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
    createSection: async (_parent: any, { input }: { input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensurePermission(ctx.currentUser, "taxonomy", "section.create", ctx.requestId)

      try {
        const newSection = await createSection(ctx.prisma, {
          input,
          actor: ctx.currentUser!,
          requestId: ctx.requestId
        })

        await ctx.cache.delByTags(["home", `section:${newSection.slug}`])

        return newSection
      } catch (error) {
        handleAdminError(error, ctx.requestId, "section")
      }
    },

    updateSection: async (_parent: any, { id, input }: { id: string; input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensurePermission(ctx.currentUser, "taxonomy", "section.update", ctx.requestId)

      try {
        const previousSection = await ctx.prisma.section.findUnique({ where: { id }, select: { slug: true } })
        const updatedSection = await updateSection(ctx.prisma, {
          sectionId: id,
          input,
          actor: ctx.currentUser!,
          requestId: ctx.requestId
        })

        await ctx.cache.delByTags([
          "home",
          `section:${previousSection?.slug ?? updatedSection.slug}`,
          `section:${updatedSection.slug}`
        ])

        return updatedSection
      } catch (error) {
        handleAdminError(error, ctx.requestId, "section")
      }
    },

    deleteSection: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensurePermission(ctx.currentUser, "taxonomy", "section.delete", ctx.requestId)

      try {
        // Проверяем, есть ли статьи с этим типом контента
        const sectionWithArticles = await ctx.prisma.section.findUnique({
          where: { id },
          include: {
            articles: true,
            _count: {
              select: { articles: true }
            }
          }
        })

        if (!sectionWithArticles) {
          throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "section" })
        }

        if (sectionWithArticles._count.articles > 0) {
          throw createApiError("CONFLICT", {
            requestId: ctx.requestId,
            entity: "section",
            expected: "no articles",
            actual: `${sectionWithArticles._count.articles} articles`
          })
        }

        const deletedSection = await ctx.prisma.section.delete({
          where: { id },
          include: {
            _count: {
              select: { articles: true }
            }
          }
        })

        await ctx.cache.delByTags(["home", `section:${deletedSection.slug}`])

        return deletedSection
      } catch (error) {
        handleAdminError(error, ctx.requestId, "section")
      }
    },

    reorderSections: async (_parent: any, { input }: { input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensurePermission(ctx.currentUser, "taxonomy", "section.reorder", ctx.requestId)

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
        const updatedSections = await ctx.prisma.$transaction(async (tx) => {
          const updates = []

          for (const item of items) {
            const update = tx.section.update({
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

        await ctx.cache.delByTags(["home", ...updatedSections.map((section) => `section:${section.slug}`)])

        return updatedSections
      } catch (error) {
        handleAdminError(error, ctx.requestId, "section")
      }
    },

    archiveSection: async (
      _parent: any,
      { id, successorId }: { id: string; successorId: string },
      ctx: GraphQLContext
    ) => {
      // Проверка прав доступа
      ensurePermission(ctx.currentUser, "taxonomy", "section.archive", ctx.requestId)

      try {
        const archivedSection = await archiveSection(ctx.prisma, {
          sectionId: id,
          successorId,
          actor: ctx.currentUser!,
          requestId: ctx.requestId
        })

        await ctx.cache.delByTags(["home", `section:${archivedSection.slug}`])

        return archivedSection
      } catch (error) {
        handleAdminError(error, ctx.requestId, "section")
      }
    },

    restoreSection: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      ensurePermission(ctx.currentUser, "taxonomy", "section.restore", ctx.requestId)
      const section = await restoreSection(ctx.prisma, {
        sectionId: id,
        actor: ctx.currentUser!,
        requestId: ctx.requestId
      })
      await ctx.cache.delByTags(["home", `section:${section.slug}`])
      return section
    }
  }
}
