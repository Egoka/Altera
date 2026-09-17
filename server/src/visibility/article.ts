import type { Article, Prisma } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"

export type PublicArticleVisibility = "visible" | "not_found" | "archived"
type PublicArticleRecord = Pick<Article, "status" | "firstPublishedAt">

export function publicArticleWhere(): Prisma.ArticleWhereInput
export function publicArticleWhere<T extends Prisma.ArticleWhereInput>(where: T): T & { status: "published" }
export function publicArticleWhere(where: Prisma.ArticleWhereInput = {}): Prisma.ArticleWhereInput {
  return { ...where, status: "published" }
}

export function getPublicArticleVisibility(article: PublicArticleRecord | null): PublicArticleVisibility {
  if (!article) return "not_found"
  if (article.status === "published") return "visible"
  if (article.status === "archived" || article.firstPublishedAt !== null) return "archived"
  return "not_found"
}

export function ensurePublicArticleVisible(article: PublicArticleRecord | null, requestId: string): void {
  const visibility = getPublicArticleVisibility(article)
  if (visibility === "visible") return

  throw createApiError(visibility === "archived" ? "ARCHIVED" : "NOT_FOUND", {
    requestId,
    entity: "article"
  })
}
