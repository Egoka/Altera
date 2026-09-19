import { GraphQLContext } from "../../prisma"
import { ensureActiveAuthor, ensureAuthenticated, ensurePermission, ensureRole } from "../../exceptions/permissions"
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
import { randomUUID } from "node:crypto"

type MyArticleStatus = "draft" | "ai_check" | "review" | "rework" | "published" | "rejected" | "archived"

interface MyArticleTranslationRecord {
  id: string
  locale: string
  slug: string
  title: string
  status: string
  rejected: boolean
  publishedAt: Date | null
  updatedAt: Date
  reeditUntil: Date | null
  reviewMessages: Array<{ createdAt: Date; readAt: Date | null }>
}

interface MyArticleRecord {
  id: string
  status: string
  archivedByActorId: string | null
  updatedAt: Date
  section: unknown
  format: unknown
  tags: unknown[]
  translations: MyArticleTranslationRecord[]
}

const effectiveArticleStatus = (article: MyArticleRecord): string =>
  article.status === "archived" ? "archived" : (article.translations[0]?.status ?? article.status)

const matchesMyArticleStatus = (article: MyArticleRecord, status: MyArticleStatus): boolean => {
  if (status === "rejected") return article.translations.some((translation) => translation.rejected)
  if (article.translations.some((translation) => translation.rejected)) return false

  const effectiveStatus = effectiveArticleStatus(article)
  if (status === "review") return effectiveStatus === "review" || effectiveStatus === "in_review"
  return effectiveStatus === status
}

const isoOrNull = (value: Date | null): string | null => value?.toISOString() ?? null

const mapMyArticle = (article: MyArticleRecord, userId: string) => ({
  id: article.id,
  status: effectiveArticleStatus(article),
  archivedBy:
    effectiveArticleStatus(article) === "archived" ? (article.archivedByActorId === userId ? "self" : "staff") : null,
  section: article.section,
  format: article.format,
  tags: article.tags,
  translations: article.translations.map((translation) => {
    const lastReviewMessage = translation.reviewMessages[0]
    return {
      id: translation.id,
      locale: translation.locale,
      slug: translation.slug,
      title: translation.title,
      status: translation.status,
      rejected: translation.rejected,
      publishedAt: isoOrNull(translation.publishedAt),
      updatedAt: translation.updatedAt.toISOString(),
      reeditUntil: isoOrNull(translation.reeditUntil),
      lastReviewMessageAt: lastReviewMessage?.createdAt.toISOString() ?? null,
      unread: lastReviewMessage?.readAt === null
    }
  })
})

function ensureArticleAuthoringAccess(ctx: GraphQLContext, action: string) {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  if (user.role === "reader" || user.role === "author") {
    ensureActiveAuthor(user, action, ctx.requestId, { logger: ctx.logger })
  } else {
    ensurePermission(user, "editorial", action, ctx.requestId)
  }
  return user
}

export default {
  Query: {
    myArticles: async (
      _parent: unknown,
      args: { status?: MyArticleStatus[]; cursor?: string; limit?: number },
      ctx: GraphQLContext
    ) => {
      const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
      const limit = args.limit ?? 20
      validatePagination({ page: 1, limit }, ctx.requestId)

      if (!["reader", "author", "editor"].includes(user.role)) {
        throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "article.listOwn" })
      }

      const articles = (await ctx.prisma.article.findMany({
        where: user.role === "editor" ? { isEditorial: true } : { authorId: user.id },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        include: {
          section: true,
          format: true,
          tags: true,
          translations: {
            orderBy: { locale: "asc" },
            include: {
              reviewMessages: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { createdAt: true, readAt: true }
              }
            }
          }
        }
      })) as unknown as MyArticleRecord[]

      const counts = {
        total: articles.length,
        draft: articles.filter((article) => matchesMyArticleStatus(article, "draft")).length,
        ai_check: articles.filter((article) => matchesMyArticleStatus(article, "ai_check")).length,
        review: articles.filter((article) => matchesMyArticleStatus(article, "review")).length,
        rework: articles.filter((article) => matchesMyArticleStatus(article, "rework")).length,
        published: articles.filter((article) => matchesMyArticleStatus(article, "published")).length,
        rejected: articles.filter((article) => matchesMyArticleStatus(article, "rejected")).length,
        archived: articles.filter((article) => matchesMyArticleStatus(article, "archived")).length
      }

      const filtered = args.status?.length
        ? articles.filter((article) => args.status!.some((status) => matchesMyArticleStatus(article, status)))
        : articles
      const cursorIndex = args.cursor ? filtered.findIndex((article) => article.id === args.cursor) : -1
      const start = cursorIndex >= 0 ? cursorIndex + 1 : 0
      const page = filtered.slice(start, start + limit)
      const hasNextPage = start + limit < filtered.length

      return {
        items: page.map((article) => mapMyArticle(article, user.id)),
        counts,
        pageInfo: {
          endCursor: hasNextPage ? (page[page.length - 1]?.id ?? null) : null,
          hasNextPage
        }
      }
    },

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
            include: { author: true, section: true, tags: true }
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
        include: { author: true, section: true, tags: true }
      })

      if (!article) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
      }

      // Получаем рекомендуемые статьи (похожие по тегам)
      const recommendedArticles = await ctx.prisma.article.findMany({
        where: {
          status: "published",
          slug: { not: args.slug },
          tags: {
            some: {
              slug: { in: article.tags.map((tag) => tag.slug) }
            }
          }
        },
        take: 5,
        orderBy: { publishedAt: "desc" },
        include: { author: true, section: true, tags: true }
      })

      // Получаем связанные статьи (по автору и типу контента)
      const relatedArticles = await ctx.prisma.article.findMany({
        where: {
          status: "published",
          slug: { not: args.slug },
          OR: [{ authorId: article.authorId }, { sectionId: article.sectionId }]
        },
        take: 10,
        orderBy: { publishedAt: "desc" },
        include: { author: true, section: true, tags: true }
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
        include: { tags: true }
      })

      if (!article) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
      }

      const articles = await ctx.prisma.article.findMany({
        where: {
          status: "published",
          slug: { not: articleSlug },
          tags: {
            some: {
              slug: { in: article.tags.map((tag) => tag.slug) }
            }
          }
        },
        take: limit,
        orderBy: { publishedAt: "desc" },
        include: { author: true, section: true, tags: true }
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
        select: { authorId: true, sectionId: true }
      })

      if (!article) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
      }

      const articles = await ctx.prisma.article.findMany({
        where: {
          status: "published",
          slug: { not: articleSlug },
          OR: [{ authorId: article.authorId }, { sectionId: article.sectionId }]
        },
        take: limit,
        orderBy: { publishedAt: "desc" },
        include: { author: true, section: true, tags: true }
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
        include: { author: true, section: true, tags: true }
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
        include: { author: true, section: true, tags: true }
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
        include: { author: true, section: true, tags: true }
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
          sectionId?: string[]
          tagIds?: string[]
          publishedAt?: { from?: string; to?: string }
        }
        search?: SearchInput
      },
      ctx: GraphQLContext
    ) => {
      // Проверка прав доступа
      ensureRole(ctx.currentUser, "admin", "admin.articles.read", ctx.requestId)

      const { pagination, sort, filters, search } = args

      // Валидация входных параметров
      validatePagination(pagination, ctx.requestId)
      validateSort(
        sort,
        ["id", "title", "slug", "status", "publishedAt", "createdAt", "updatedAt", "author.name", "section.name"],
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

      if (filters.sectionId?.length) {
        where.sectionId = { in: filters.sectionId }
      }

      if (filters.tagIds?.length) {
        where.tags = {
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
          section: true,
          tags: true
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
          sectionId: filters.sectionId,
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
      const user = ensureArticleAuthoringAccess(ctx, "article.create")

      const articleId = randomUUID()
      const locale = input.locale ?? user.locale
      const title = ""
      const body = ""
      const slug = `draft-${articleId}`

      const newArticle = await ctx.prisma.$transaction(async (tx) => {
        const section = input.sectionId
          ? await tx.section.findFirst({
              where: { id: input.sectionId, status: "active" },
              select: { id: true }
            })
          : null

        return tx.article.create({
          data: {
            id: articleId,
            title,
            body,
            slug,
            sectionId: section?.id ?? null,
            sourceLocale: locale,
            authorId: user.id,
            status: "draft",
            translations: {
              create: {
                locale,
                slug,
                title,
                body: [],
                status: "draft",
                revisions: {
                  create: {
                    title,
                    body: [],
                    kind: "manual",
                    createdById: user.id
                  }
                }
              }
            }
          },
          include: { author: true, section: true, tags: true, translations: true }
        })
      })

      // No cache invalidation is needed because drafts are not public.
      return newArticle
    },

    updateArticle: async (_parent: any, { id, input }: { id: string; input: any }, ctx: GraphQLContext) => {
      const user = ensureArticleAuthoringAccess(ctx, "translation.save")

      const article = await ctx.prisma.article.findUnique({
        where: { id },
        include: { author: true, section: true, tags: true }
      })
      if (!article) {
        throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
      }
      if (article.authorId !== user.id) {
        throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "article.edit" })
      }

      const { tags, ...articleData } = input

      const updatedArticle = await ctx.prisma.article.update({
        where: { id: id },
        data: {
          ...articleData,
          tags: tags
            ? {
                set: tags.map((id: string) => ({ id }))
              }
            : undefined
        },
        include: { author: true, section: true, tags: true }
      })

      await ctx.cache.delByTags(buildArticleCacheTags(article, updatedArticle))

      return updatedArticle
    },

    archiveArticle: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)

      const article = await ctx.prisma.article.findUnique({
        where: { id },
        include: { author: true, section: true, tags: true }
      })
      if (!article) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
      if (article.authorId !== user.id) {
        throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "article.archive" })
      }

      const updatedArticle = await ctx.prisma.article.update({
        where: { id },
        data: { status: "archived" },
        include: { author: true, section: true, tags: true }
      })

      await ctx.cache.delByTags(buildArticleCacheTags(article, updatedArticle))

      return updatedArticle
    },

    requestReview: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      const user = ensureArticleAuthoringAccess(ctx, "translation.submit")

      const article = await ctx.prisma.article.findUnique({
        where: { id },
        include: { author: true, section: true, tags: true }
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
      if (!article.sectionId) {
        throw createApiError("VALIDATION_ERROR", {
          requestId: ctx.requestId,
          field: "sectionId",
          rule: "required"
        })
      }

      return ctx.prisma.article.update({
        where: { id },
        data: { status: "review" },
        include: { author: true, section: true, tags: true }
      })
    },

    revertToDraft: async (_parent: any, { id }: { id: string }, ctx: GraphQLContext) => {
      const user = ensureArticleAuthoringAccess(ctx, "translation.withdraw")

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
        include: { author: true, section: true, tags: true }
      })
    },

    setArticleStatus: async (_parent: any, { id, status }: { id: string; status: any }, ctx: GraphQLContext) => {
      ensureRole(ctx.currentUser, "admin", "article.setStatus", ctx.requestId)

      const article = await ctx.prisma.article.findUnique({ where: { id } })
      if (!article) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })

      const updatedArticle = await ctx.prisma.article.update({
        where: { id },
        data: {
          status,
          publishedAt: status === "published" && article.status !== "published" ? new Date() : article.publishedAt
        },
        include: { author: true, section: true, tags: true }
      })

      await ctx.cache.delByTags(buildArticleCacheTags(article, updatedArticle))

      return updatedArticle
    },

    // Админ мутации для массовых операций
    bulkDeleteArticles: async (_parent: any, { ids }: { ids: string[] }, ctx: GraphQLContext) => {
      // Проверка прав доступа
      ensureRole(ctx.currentUser, "admin", "article.bulkDelete", ctx.requestId)

      // Валидация входных параметров
      validateBulkOperation(ids, ctx.requestId, 100)

      try {
        // Получаем статьи для проверки существования и инвалидации кеша
        const articlesToDelete = await ctx.prisma.article.findMany({
          where: { id: { in: ids } },
          include: { author: true, section: true, tags: true }
        })

        if (articlesToDelete.length !== ids.length) {
          throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
        }

        // Архивируем вместо физического удаления: адрес (slug) остаётся занятым навсегда
        // (ADR-0004, журнал §26.10, AC-T053-2). Полное необратимое удаление — отдельная
        // задача T-076, доступная только владельцу из архива.
        await ctx.prisma.article.updateMany({
          where: { id: { in: ids } },
          data: {
            status: "archived",
            archivedAt: new Date(),
            archivedByActorId: ctx.currentUser!.id,
            archivedByRole: ctx.currentUser!.role,
            archiveReason: "bulk_delete"
          }
        })

        const archivedArticles = await ctx.prisma.article.findMany({
          where: { id: { in: ids } },
          include: { author: true, section: true, tags: true }
        })

        await ctx.cache.delByTags(buildArticleCacheTags(...articlesToDelete, ...archivedArticles))

        return archivedArticles
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
      ensureRole(ctx.currentUser, "admin", "article.bulkUpdateStatus", ctx.requestId)

      // Валидация входных параметров
      validateBulkOperation(ids, ctx.requestId, 100)

      if (!["draft", "review", "published", "archived"].includes(status)) {
        throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "status", rule: "enum" })
      }

      try {
        // Получаем статьи для обновления
        const articlesToUpdate = await ctx.prisma.article.findMany({
          where: { id: { in: ids } },
          include: { author: true, section: true, tags: true }
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
          include: { author: true, section: true, tags: true }
        })

        await ctx.cache.delByTags(buildArticleCacheTags(...articlesToUpdate, ...updatedArticles))

        return updatedArticles
      } catch (error) {
        handleAdminError(error, ctx.requestId, "article")
      }
    }
  }
}
