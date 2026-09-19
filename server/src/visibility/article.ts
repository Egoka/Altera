import type { Article, Prisma } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"

export type PublicArticleVisibility = "visible" | "not_found" | "archived"
type PublicArticleRecord = Pick<Article, "status" | "firstPublishedAt">

export const publicUserSelect = {
  id: true,
  name: true,
  bio: true,
  photoUrl: true,
  handle: true,
  socialLinks: true,
  createdAt: true,
  updatedAt: true
} as const satisfies Prisma.UserSelect

export const publicSectionSelect = {
  id: true,
  name: true,
  nameEn: true,
  slug: true,
  description: true,
  descriptionEn: true,
  seoTitle: true,
  seoTitleEn: true,
  seoDescription: true,
  seoDescriptionEn: true,
  order: true,
  status: true,
  createdAt: true,
  updatedAt: true
} as const satisfies Prisma.SectionSelect

export const publicTagSelect = {
  id: true,
  name: true,
  nameEn: true,
  slug: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true
} as const satisfies Prisma.TagSelect

const publicFormatSelect = {
  id: true,
  name: true,
  nameEn: true,
  slug: true,
  description: true,
  descriptionEn: true,
  status: true,
  createdAt: true,
  updatedAt: true
} as const satisfies Prisma.FormatSelect

export const publicArticleSelect = {
  id: true,
  title: true,
  slug: true,
  dek: true,
  body: true,
  excerpt: true,
  featuredImage: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  author: { select: publicUserSelect },
  section: { select: publicSectionSelect },
  format: { select: publicFormatSelect },
  tags: { select: publicTagSelect }
} as const satisfies Prisma.ArticleSelect

export function publicArticleWhere(): Prisma.ArticleWhereInput
export function publicArticleWhere<T extends Prisma.ArticleWhereInput>(where: T): T & { status: "published" }
export function publicArticleWhere(where: Prisma.ArticleWhereInput = {}): Prisma.ArticleWhereInput {
  return { ...where, status: "published" }
}

export function getPublicArticleVisibility(article: PublicArticleRecord | null): PublicArticleVisibility {
  if (!article) return "not_found"
  if (article.status === "published") return "visible"
  if (article.firstPublishedAt !== null) return "archived"
  return "not_found"
}

export function publicationDatesForStatus(
  status: Article["status"],
  publishedAt: Date | null,
  firstPublishedAt: Date | null,
  now = new Date()
): Pick<Article, "publishedAt" | "firstPublishedAt"> {
  if (status !== "published") return { publishedAt, firstPublishedAt }
  return { publishedAt: now, firstPublishedAt: firstPublishedAt ?? now }
}

export function ensurePublicArticleVisible<T extends PublicArticleRecord>(
  article: T | null,
  requestId: string
): asserts article is T {
  const visibility = getPublicArticleVisibility(article)
  if (visibility === "visible") return

  throw createApiError(visibility === "archived" ? "ARCHIVED" : "NOT_FOUND", {
    requestId,
    entity: "article"
  })
}
