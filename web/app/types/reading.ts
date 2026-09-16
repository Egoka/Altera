export type ArticleCardVariant = "lede" | "large" | "small" | "rank"
export type ArticleCardMedia = "above" | "beside"
export type BookmarkState = "idle" | "busy"

export interface ReadingArticle {
  id: string
  title: string
  slug: string
  dek?: string | null
  excerpt?: string | null
  featuredImage?: string | null
  publishedAt?: string | null
  isTranslation?: boolean
  author: {
    name: string
    slug: string
    grade?: "standard" | "pro" | null
  }
  section?: {
    name: string
    slug: string
  } | null
}
