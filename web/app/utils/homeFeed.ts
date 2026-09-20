import type { FeedCaption, FeedCardFragment, FeedSectionKey, GetHomeFeedQuery } from "~/graphql/generated/graphql"
import type { ReadingArticle } from "~/types/reading"

/**
 * Подборки главной приходят готовым списком: сервер отдаёт только те зоны, для которых есть
 * материалы, и в порядке отбора топ → новое → популярное (`home.md` §5, журнал §22.4).
 * Страница ничего не пересортировывает и не досыпает — иначе правило «без повторов»
 * пришлось бы держать в двух местах.
 */
export interface HomeSection {
  key: FeedSectionKey
  caption: FeedCaption
  articles: ReadingArticle[]
}

/**
 * Подписи подборок называют принцип словами (`home-sections.md` §7); текст живёт в словаре
 * локали. Полный разбор значения обязывает завести строку вместе с новой подписью, а не
 * показать читателю ключ перечисления.
 */
const CAPTION_KEYS: Record<FeedCaption, string> = {
  by_publication_date: "home.captionByDate"
}

export const captionKey = (caption: FeedCaption): string => CAPTION_KEYS[caption]

export const toReadingArticle = (item: FeedCardFragment): ReadingArticle => ({
  id: item.id,
  title: item.title,
  slug: item.slug,
  dek: item.dek,
  featuredImage: item.cover,
  publishedAt: item.publishedAt,
  isTranslation: item.isTranslation,
  author: { name: item.author.name, slug: item.author.handle, grade: item.author.grade },
  section: { name: item.sectionName, slug: item.sectionSlug }
})

export const toHomeSections = (feed: GetHomeFeedQuery["feed"] | null | undefined): HomeSection[] =>
  (feed?.sections ?? []).map((section) => ({
    key: section.key,
    caption: section.caption,
    articles: section.items.map(toReadingArticle)
  }))

export const homeSection = (sections: readonly HomeSection[], key: FeedSectionKey): HomeSection | undefined =>
  sections.find((section) => section.key === key)
