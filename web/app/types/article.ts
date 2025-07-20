type ArticleStatus = "draft" | "review" | "published" | "archived"
export default interface Article {
  id: string
  title: string
  slug: string
  dek?: string
  body: string
  excerpt?: string
  featuredImage?: string
  typeId: string
  authorId: string
  status: ArticleStatus
  sectionTagIds: string[]
  publishedAt?: string
  createdAt: string
  updatedAt: string
}
