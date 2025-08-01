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
  validateBulkOperation,
  logAdminOperation,
  ADMIN_CACHE_PREFIX,
  PaginationInput,
  SortInput,
  BaseFilters,
  SearchInput
} from "../../utils/admin"

const TAG_CACHE_PREFIX = "tag:"
const TAG_ARTICLES_CACHE_PREFIX = "tag_articles:"
const TAG_STATS_CACHE_PREFIX = "tag_stats:"
const CACHE_TTL = parseInt(process.env.CACHE_TTL || "21600") // время жизни кэша в секундах (по умолчанию 6 часов)

export default {
  Query: {
    tag: async (_parent: any, args: { slug: string }, ctx: GraphQLContext) => {
      const cacheKey = `${TAG_CACHE_PREFIX}slug:${args.slug}`
      const cachedTag = await ctx.redis.get(cacheKey)

      if (cachedTag) {
        console.log("CACHE: Returning tag by slug from cache")
        return JSON.parse(cachedTag)
      }

      console.log("DATABASE: Tag by slug not in cache, fetching from database")
      const tag = await ctx.prisma.sectionTag.findUnique({
        where: { slug: args.slug }
      })

      if (tag) {
        await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(tag))
      }

      return tag
    },

    articlesByTag: async (
      _parent: any,
      { tagSlug, page = 1, limit = 10 }: { tagSlug: string; page: number; limit: number },
      ctx: GraphQLContext
    ) => {
      const cacheKey = `${TAG_ARTICLES_CACHE_PREFIX}${tagSlug}:${page}:${limit}`
      const cachedData = await ctx.redis.get(cacheKey)

      if (cachedData) {
        console.log("CACHE: Returning articles by tag from cache")
        return JSON.parse(cachedData)
      }

      console.log("DATABASE: Articles by tag not in cache, fetching from database")

      const tag = await ctx.prisma.sectionTag.findUnique({ where: { slug: tagSlug } })
      if (!tag) {
        throw new Error("Tag not found")
      }

      const totalCount = await ctx.prisma.article.count({
        where: {
          sectionTags: { some: { slug: tagSlug } },
          status: "published"
        }
      })
      const articles = await ctx.prisma.article.findMany({
        where: {
          sectionTags: { some: { slug: tagSlug } },
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

    tagStats: async (_parent: any, { tagSlug }: { tagSlug: string }, ctx: GraphQLContext) => {
      const cacheKey = `${TAG_STATS_CACHE_PREFIX}${tagSlug}`
      const cachedStats = await ctx.redis.get(cacheKey)

      if (cachedStats) {
        console.log("CACHE: Returning tag stats from cache")
        return JSON.parse(cachedStats)
      }

      console.log("DATABASE: Tag stats not in cache, calculating from database")

      const tag = await ctx.prisma.sectionTag.findUnique({ where: { slug: tagSlug } })
      if (!tag) {
        throw new Error("Tag not found")
      }

      const totalArticles = await ctx.prisma.article.count({
        where: {
          sectionTags: { some: { slug: tagSlug } },
          status: "published"
        }
      })

      const oneMonthAgo = new Date()
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)

      const articlesThisMonth = await ctx.prisma.article.count({
        where: {
          sectionTags: { some: { slug: tagSlug } },
          status: "published",
          publishedAt: { gte: oneMonthAgo }
        }
      })

      // Получаем популярных авторов для этого тега
      const popularAuthors = await ctx.prisma.user.findMany({
        where: {
          articles: {
            some: {
              sectionTags: { some: { slug: tagSlug } },
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

      // Рассчитываем среднее время чтения (примерная оценка)
      const articlesWithBody = await ctx.prisma.article.findMany({
        where: {
          sectionTags: { some: { slug: tagSlug } },
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
        popularAuthors
      }

      await ctx.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(stats))
      return stats
    },

    // Запрос для управления тегами (требует права admin)
    sectionTags: async (
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
      ensureHasRole(ctx.currentUser, "admin")

      const { pagination, sort, filters, search } = args

      // Валидация входных параметров
      validatePagination(pagination)
      validateSort(sort, ["id", "name", "slug", "createdAt", "updatedAt", "_count.articles"])

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

      // Добавляем специфичные фильтры для тегов
      if (filters.hasArticles !== undefined) {
        if (filters.hasArticles) {
          where.articles = { some: {} }
        } else {
          where.articles = { none: {} }
        }
      }

      // Создаем ключ кеша
      const cacheKey = getCacheKey("admin_tags", { pagination, sort, filters })

      // Получаем данные с кешированием
      const result = await getCachedOrFetch(ctx, cacheKey, async () => {
        // Получаем общее количество
        const total = await ctx.prisma.sectionTag.count({ where })

        // Рассчитываем пагинацию
        const { skip, take, pagination: paginationInfo } = calculatePagination(pagination.page, pagination.limit, total)

        // Получаем данные
        const tags = await ctx.prisma.sectionTag.findMany({
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
      logAdminOperation("admin_tags", ctx.currentUser?.id || "unknown", {
        pagination,
        sort,
        filters
      })

      return result
    }
  },

  Mutation: {
    // Админ мутации для управления тегами
    createTag: async (_parent: any, { input }: { input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin")

      try {
        const newTag = await ctx.prisma.sectionTag.create({
          data: input,
          include: {
            _count: {
              select: { articles: true }
            }
          }
        })

        // Инвалидируем кеш
        const keysToDelete = await ctx.redis.keys(`${TAG_CACHE_PREFIX}*`)
        keysToDelete.push(...(await ctx.redis.keys(`${ADMIN_CACHE_PREFIX}*`)))
        if (keysToDelete.length > 0) {
          await ctx.redis.del(keysToDelete)
        }

        // Логируем операцию
        logAdminOperation("create_tag", ctx.currentUser?.id || "unknown", {
          tagId: newTag.id,
          tagName: newTag.name
        })

        return newTag
      } catch (error) {
        handleAdminError(error)
      }
    },

    updateTag: async (_parent: any, { id, input }: { id: string; input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin")

      try {
        const updatedTag = await ctx.prisma.sectionTag.update({
          where: { id },
          data: input,
          include: {
            _count: {
              select: { articles: true }
            }
          }
        })

        // Инвалидируем кеш
        const keysToDelete = await ctx.redis.keys(`${TAG_CACHE_PREFIX}*`)
        keysToDelete.push(...(await ctx.redis.keys(`${ADMIN_CACHE_PREFIX}*`)))
        if (keysToDelete.length > 0) {
          await ctx.redis.del(keysToDelete)
        }

        // Логируем операцию
        logAdminOperation("update_tag", ctx.currentUser?.id || "unknown", {
          tagId: id,
          updates: input
        })

        return updatedTag
      } catch (error) {
        handleAdminError(error)
      }
    },

    deleteTag: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin")

      try {
        // Проверяем, есть ли статьи с этим тегом
        const tagWithArticles = await ctx.prisma.sectionTag.findUnique({
          where: { id },
          include: {
            articles: true,
            _count: {
              select: { articles: true }
            }
          }
        })

        if (!tagWithArticles) {
          throw new GraphQLError("Tag not found", { extensions: { code: "NOT_FOUND" } })
        }

        if (tagWithArticles._count.articles > 0) {
          throw new GraphQLError(
            `Cannot delete tag "${tagWithArticles.name}" because it has ${tagWithArticles._count.articles} articles. Please merge or reassign articles first.`,
            { extensions: { code: "CONSTRAINT_VIOLATION" } }
          )
        }

        const deletedTag = await ctx.prisma.sectionTag.delete({
          where: { id },
          include: {
            _count: {
              select: { articles: true }
            }
          }
        })

        // Инвалидируем кеш
        const keysToDelete = await ctx.redis.keys(`${TAG_CACHE_PREFIX}*`)
        keysToDelete.push(...(await ctx.redis.keys(`${ADMIN_CACHE_PREFIX}*`)))
        if (keysToDelete.length > 0) {
          await ctx.redis.del(keysToDelete)
        }

        // Логируем операцию
        logAdminOperation("delete_tag", ctx.currentUser?.id || "unknown", {
          tagId: id,
          tagName: deletedTag.name
        })

        return deletedTag
      } catch (error) {
        handleAdminError(error)
      }
    },

    mergeTags: async (_parent: any, { input }: { input: any }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureHasRole(ctx.currentUser, "admin")

      const { sourceTagIds, targetTagId } = input

      // Валидация входных параметров
      validateBulkOperation(sourceTagIds, 10)

      if (sourceTagIds.includes(targetTagId)) {
        throw new GraphQLError("Target tag cannot be in source tags", { extensions: { code: "VALIDATION_ERROR" } })
      }

      try {
        // Проверяем существование всех тегов
        const sourceTags = await ctx.prisma.sectionTag.findMany({
          where: { id: { in: sourceTagIds } }
        })

        const targetTag = await ctx.prisma.sectionTag.findUnique({
          where: { id: targetTagId }
        })

        if (sourceTags.length !== sourceTagIds.length) {
          throw new GraphQLError("Some source tags not found", { extensions: { code: "NOT_FOUND" } })
        }

        if (!targetTag) {
          throw new GraphQLError("Target tag not found", { extensions: { code: "NOT_FOUND" } })
        }

        // Получаем все статьи, которые используют исходные теги
        const articlesToUpdate = await ctx.prisma.article.findMany({
          where: {
            sectionTags: {
              some: { id: { in: sourceTagIds } }
            }
          },
          include: { sectionTags: true }
        })

        // Начинаем транзакцию
        const result = await ctx.prisma.$transaction(async (tx) => {
          // Обновляем статьи: добавляем целевой тег и удаляем исходные
          for (const article of articlesToUpdate) {
            const currentTagIds = article.sectionTags.map((tag) => tag.id)
            const newTagIds = currentTagIds.filter((id) => !sourceTagIds.includes(id))

            // Добавляем целевой тег, если его еще нет
            if (!newTagIds.includes(targetTagId)) {
              newTagIds.push(targetTagId)
            }

            await tx.article.update({
              where: { id: article.id },
              data: {
                sectionTags: {
                  set: newTagIds.map((id) => ({ id }))
                }
              }
            })
          }

          // Удаляем исходные теги
          await tx.sectionTag.deleteMany({
            where: { id: { in: sourceTagIds } }
          })

          // Возвращаем обновленный целевой тег
          return await tx.sectionTag.findUnique({
            where: { id: targetTagId },
            include: {
              _count: {
                select: { articles: true }
              }
            }
          })
        })

        // Инвалидируем кеш
        const keysToDelete = await ctx.redis.keys(`${TAG_CACHE_PREFIX}*`)
        keysToDelete.push(...(await ctx.redis.keys(`${ADMIN_CACHE_PREFIX}*`)))
        if (keysToDelete.length > 0) {
          await ctx.redis.del(keysToDelete)
        }

        // Логируем операцию
        logAdminOperation("merge_tags", ctx.currentUser?.id || "unknown", {
          sourceTagIds,
          targetTagId,
          mergedArticlesCount: articlesToUpdate.length
        })

        return result
      } catch (error) {
        handleAdminError(error)
      }
    }
  }
}
