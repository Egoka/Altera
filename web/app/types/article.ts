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

export interface ArticleResponse {
  id: string
  title: string
  slug: string
  dek: string
  excerpt: string
  featuredImage: string
  publishedAt: string
  author: {
    name: string
    slug: string
    photoUrl: string
  }
  contentType: {
    name: string
    slug: string
  }
}
