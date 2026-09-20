import { addBookmark, getBookmarkState, listBookmarks, removeBookmark } from "../../bookmarks/service"
import type { GraphQLContext } from "../../prisma"

export default {
  Query: {
    myBookmarks: (
      _parent: unknown,
      args: { cursor?: string | null; limit?: number | null; unavailable?: boolean | null },
      ctx: GraphQLContext
    ) => listBookmarks(ctx, args),
    myBookmark: (_parent: unknown, args: { articleId: string }, ctx: GraphQLContext) =>
      getBookmarkState(ctx, args.articleId)
  },
  Mutation: {
    addBookmark: (_parent: unknown, args: { articleId: string }, ctx: GraphQLContext) =>
      addBookmark(ctx, args.articleId),
    removeBookmark: (_parent: unknown, args: { articleId: string }, ctx: GraphQLContext) =>
      removeBookmark(ctx, args.articleId)
  }
}
