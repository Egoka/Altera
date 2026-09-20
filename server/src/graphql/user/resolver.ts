import { GraphQLContext } from "../../prisma"
import { ensureAuthenticated, ensurePermission } from "../../exceptions/permissions"
import type { PrismaClient } from "../../generated/prisma"

async function auditPersonalDataRead(
  prisma: PrismaClient,
  requestId: string,
  actorId: string,
  actorRole: string,
  subjectId: string,
  context: string,
  purpose: string
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: "admin.read.personal",
      actorId,
      actorRole: actorRole as any,
      entityType: "user",
      entityId: subjectId,
      context,
      purpose,
      requestId
    }
  })
}
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
import { publicUserSelect } from "../../visibility/article"

export default {
  Query: {
    user: async (_parent: unknown, args: { handle: string }, ctx: GraphQLContext) => {
      return ctx.prisma.user.findUnique({
        where: { handle: args.handle },
        select: publicUserSelect
      })
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
      ensurePermission(ctx.currentUser, "accounts", "admin.users.read", ctx.requestId)

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

      const actor = ctx.currentUser!
      for (const u of users) {
        await auditPersonalDataRead(ctx.prisma, ctx.requestId, actor.id, actor.role, u.id, "users", "admin.users.read")
      }

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
    },

    adminUser: async (_parent: any, args: { id: string }, ctx: GraphQLContext) => {
      ensurePermission(ctx.currentUser, "accounts", "admin.user.read", ctx.requestId)

      const user = await ctx.prisma.user.findUnique({ where: { id: args.id } })
      if (!user) return null

      const actor = ctx.currentUser!
      await auditPersonalDataRead(ctx.prisma, ctx.requestId, actor.id, actor.role, user.id, "users", "admin.user.read")

      return user
    }
  }
}
