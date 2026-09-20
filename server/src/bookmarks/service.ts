import type { Prisma } from "../generated/prisma"
import type { GraphQLContext } from "../prisma"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated } from "../exceptions/permissions"

// Закладками пользуются только личные аккаунты: служебные роли получают FORBIDDEN (журнал #58).
const PERSONAL_ROLES = new Set(["reader", "author"])
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export type BookmarkAction = "bookmark.list" | "bookmark.add" | "bookmark.remove"

interface BookmarkedArticleRecord {
  id: string
  title: string
  slug: string
  status: string
  sourceLocale: string
  featuredImage: string | null
  publishedAt: Date | null
  author: { name: string; handle: string }
  section: unknown
}

interface BookmarkRecord {
  articleId: string
  createdAt: Date
  article: BookmarkedArticleRecord
}

const bookmarkArticleSelect = {
  id: true,
  title: true,
  slug: true,
  status: true,
  sourceLocale: true,
  featuredImage: true,
  publishedAt: true,
  author: { select: { name: true, handle: true } },
  section: true
} as const

/// Владелец закладки — только личный аккаунт: читатель или автор с активной учётной записью.
export function ensureBookmarkOwner(ctx: GraphQLContext, action: BookmarkAction) {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)

  if (user.archivedAt || user.isServiceAccount || !PERSONAL_ROLES.has(user.role)) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action })
  }

  return user
}

function validateLimit(limit: number, requestId: string) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "limit", rule: "min:1" })
  }
  if (limit > MAX_LIMIT) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "limit", rule: `max:${MAX_LIMIT}` })
  }
}

function presentBookmark(bookmark: BookmarkRecord) {
  const { article } = bookmark

  return {
    bookmarkedAt: bookmark.createdAt.toISOString(),
    article: {
      id: article.id,
      title: article.title,
      slug: article.slug,
      locale: article.sourceLocale,
      cover: article.featuredImage,
      publishedAt: article.publishedAt?.toISOString() ?? null,
      // Снятый или архивированный материал остаётся в списке недоступным (журнал §25.10).
      available: article.status === "published",
      author: article.author,
      section: article.section
    }
  }
}

export async function listBookmarks(
  ctx: GraphQLContext,
  args: { cursor?: string | null; limit?: number | null; unavailable?: boolean | null }
) {
  const user = ensureBookmarkOwner(ctx, "bookmark.list")
  const limit = args.limit ?? DEFAULT_LIMIT
  validateLimit(limit, ctx.requestId)

  const unavailableWhere: Prisma.BookmarkWhereInput = { article: { status: { not: "published" } } }
  const where: Prisma.BookmarkWhereInput = args.unavailable
    ? { userId: user.id, ...unavailableWhere }
    : { userId: user.id }

  if (args.cursor) {
    const cursorExists = await ctx.prisma.bookmark.findUnique({
      where: { userId_articleId: { userId: user.id, articleId: args.cursor } },
      select: { articleId: true }
    })
    if (!cursorExists) {
      throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "cursor", rule: "known" })
    }
  }

  const [rows, total, unavailable] = await Promise.all([
    ctx.prisma.bookmark.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { articleId: "asc" }],
      take: limit + 1,
      ...(args.cursor ? { cursor: { userId_articleId: { userId: user.id, articleId: args.cursor } }, skip: 1 } : {}),
      select: { articleId: true, createdAt: true, article: { select: bookmarkArticleSelect } }
    }) as unknown as Promise<BookmarkRecord[]>,
    ctx.prisma.bookmark.count({ where: { userId: user.id } }),
    ctx.prisma.bookmark.count({ where: { userId: user.id, ...unavailableWhere } })
  ])

  const hasNextPage = rows.length > limit
  const page = hasNextPage ? rows.slice(0, limit) : rows

  return {
    items: page.map(presentBookmark),
    counts: { total, unavailable },
    pageInfo: {
      endCursor: hasNextPage ? (page[page.length - 1]?.articleId ?? null) : null,
      hasNextPage
    }
  }
}

export async function getBookmarkState(ctx: GraphQLContext, articleId: string) {
  const user = ensureBookmarkOwner(ctx, "bookmark.list")
  const bookmark = await ctx.prisma.bookmark.findUnique({
    where: { userId_articleId: { userId: user.id, articleId } },
    select: { articleId: true }
  })

  return { articleId, bookmarked: Boolean(bookmark) }
}

export async function addBookmark(ctx: GraphQLContext, articleId: string) {
  const user = ensureBookmarkOwner(ctx, "bookmark.add")
  const article = await ctx.prisma.article.findUnique({ where: { id: articleId }, select: { status: true } })

  // Сохранить можно только опубликованный материал; снятый недоступен так же, как его страница.
  if (!article || article.status !== "published") {
    throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
  }

  // Повтор идемпотентен: состояние «сохранено» не зависит от числа нажатий.
  await ctx.prisma.bookmark.upsert({
    where: { userId_articleId: { userId: user.id, articleId } },
    create: { userId: user.id, articleId },
    update: {}
  })
  ctx.logger.metric?.({ event: "bookmark.add", requestId: ctx.requestId, data: { articleId } })

  return { articleId, bookmarked: true }
}

export async function removeBookmark(ctx: GraphQLContext, articleId: string) {
  const user = ensureBookmarkOwner(ctx, "bookmark.remove")
  const { count } = await ctx.prisma.bookmark.deleteMany({ where: { userId: user.id, articleId } })

  if (count === 0) {
    throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "bookmark" })
  }
  ctx.logger.metric?.({ event: "bookmark.remove", requestId: ctx.requestId, data: { articleId } })

  return { articleId, bookmarked: false }
}
