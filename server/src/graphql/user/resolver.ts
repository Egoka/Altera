/**
 * Публичный профиль и данные своей записи. Список и карточка обычных аккаунтов админки живут в
 * модуле `admin-users` (T-073): маска адреса в списке и запись `admin.read.personal` при открытии
 * карточки — требования `40-admin/users.md` §3, §8, которых черновые `users` и `adminUser` не
 * выполняли.
 */
import { GraphQLContext } from "../../prisma"
import { ensureAuthenticated } from "../../exceptions/permissions"

import { publicUserSelect } from "../../visibility/article"
import { publicDisplayName } from "../../visibility/display-name"
import { checkHandle, updateProfile, type ProfileInput } from "../../account/profile"

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

    checkHandle: (_parent: unknown, args: { handle: string }, ctx: GraphQLContext) => checkHandle(ctx, args.handle)
  },

  Mutation: {
    updateProfile: (_parent: unknown, args: { input: ProfileInput }, ctx: GraphQLContext) =>
      updateProfile(ctx, args.input)
  },

  // Публичный тип: пока имя не задано, наружу уходит хэндл, а не пустая строка (T-126).
  User: {
    name: (parent: { name: string | null; handle: string }): string => publicDisplayName(parent.name, parent.handle)
  }
}
