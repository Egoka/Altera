// TypeScript типы для GraphQL запросов

// Общие типы пагинации
export interface Pagination {
  totalCount: number
  totalPages: number
  currentPage: number
}

// Типы для статей
export interface ArticleListItem {
  id: string
  title: string
  slug: string
  dek?: string
  excerpt?: string
  featuredImage?: string
  publishedAt?: string
  updatedAt: string
  author: {
    name: string
    slug: string
    photoUrl?: string
  }
  contentType: {
    name: string
    slug: string
  }
  sectionTags?: {
    name: string
    slug: string
  }[]
}

export interface ArticleDetail extends ArticleListItem {
  body: string
  status: "draft" | "review" | "published" | "archived"
  createdAt: string
  author: {
    id: string
    name: string
    slug: string
    bio?: string
    photoUrl?: string
    socialLinks?: any
  }
}

// Типы для пользователей
export interface User {
  id: string
  name: string
  email: string
  bio?: string
  photoUrl?: string
  role: "reader" | "author" | "editor" | "admin"
  slug: string
  socialLinks?: any
  createdAt?: string
  updatedAt?: string
}

// Типы для тегов
export interface SectionTag {
  id: string
  name: string
  slug: string
  description?: string
  articlesCount?: number
  createdAt?: string
  updatedAt?: string
}

// Типы для типов контента
export interface ContentType {
  id: string
  name: string
  slug: string
  description?: string
  order: number
  status: "active" | "archived"
  articlesCount?: number
  createdAt?: string
  updatedAt?: string
}

// Типы ответов
export interface ArticlesResponse {
  articles: ArticleListItem[]
  totalCount: number
  totalPages: number
  currentPage: number
}

export interface SearchSuggestionsResponse {
  articles: { title: string; slug: string }[]
  authors: { name: string; slug: string }[]
  tags: { name: string; slug: string }[]
}

export interface ArticleStatsResponse {
  total: number
  published: number
  draft: number
  review: number
  archived: number
  todayPublished?: number
}

export interface AuthorStatsResponse {
  totalArticles: number
  articlesThisMonth: number
  popularTags: string[]
}
