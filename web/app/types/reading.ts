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

/**
 * Ряд значений фильтра панели ленты: подпись, значения со счётчиками, выбранное
 * значение и способ собрать адрес выбора. Панель сама адресов не знает — их строит
 * страница, у которой есть маршрут и остальные параметры.
 */
export interface FeedControlGroup {
  label: string
  options: readonly { slug: string; name: string; count?: number }[]
  active: string | null
  to: (slug: string | null) => string
}
