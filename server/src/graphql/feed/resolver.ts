import type { GraphQLContext } from "../../prisma"
import { buildCacheKey, CACHE_TTL_SECONDS } from "../../cache"
import { readThroughPublicCache } from "../../cache/read-through"
import { publicArticleWhere } from "../../visibility/article"

type FeedLocale = "ru" | "en"
type FeedScope = "home"
type FeedSectionKey = "top" | "new" | "popular"
type FeedCaption = "by_publication_date"
type AuthorGrade = "standard" | "pro"

/** Главный топ — ровно пять материалов (журнал §20.2). */
export const HOME_TOP_SIZE = 5
/** «Новое» — до двенадцати карточек (`home.md` §5 `[ДОПУЩЕНИЕ]`). */
export const HOME_NEW_SIZE = 12
/** Окно новизны — трое суток (`home-sections.md` §3 `[ДОПУЩЕНИЕ]`). */
export const HOME_NEW_WINDOW_DAYS = 3

const DAY_MS = 24 * 60 * 60 * 1000

export interface FeedArticleRecord {
  id: string
  slug: string
  title: string
  dek: string | null
  featuredImage: string | null
  firstPublishedAt: Date | null
  sourceLocale: string
  author: { name: string; handle: string; planTier: string }
  section: { slug: string; name: string; nameEn: string | null } | null
}

interface FeedItem {
  id: string
  slug: string
  sectionSlug: string
  sectionName: string
  title: string
  dek: string | null
  cover: string | null
  author: { name: string; handle: string; grade: AuthorGrade }
  publishedAt: string | null
  isTranslation: boolean
}

interface FeedSection {
  key: FeedSectionKey
  caption: FeedCaption
  items: FeedItem[]
}

export interface Feed {
  scope: FeedScope
  locale: FeedLocale
  sections: FeedSection[]
}

/**
 * Поля карточки подборки. Локаль остаётся строгой границей выдачи (журнал §20.5), поэтому
 * материалы отбираются по языку оригинала: публикация языковых версий появится вместе с
 * переводом API на `ArticleTranslation` (T-020), и тогда этот отбор сменит источник.
 */
const feedArticleSelect = {
  id: true,
  slug: true,
  title: true,
  dek: true,
  featuredImage: true,
  firstPublishedAt: true,
  sourceLocale: true,
  author: { select: { name: true, handle: true, planTier: true } },
  section: { select: { slug: true, name: true, nameEn: true } }
} as const

/** Бейдж уровня автора; чисел рейтинга и плана публичный ответ не содержит (журнал §21.18). */
const gradeOf = (planTier: string): AuthorGrade => (planTier === "pro" ? "pro" : "standard")

const toFeedItem = (article: FeedArticleRecord, locale: FeedLocale): FeedItem => ({
  id: article.id,
  slug: article.slug,
  sectionSlug: article.section!.slug,
  sectionName: (locale === "en" ? article.section!.nameEn : article.section!.name) || article.section!.name,
  title: article.title,
  dek: article.dek,
  cover: article.featuredImage,
  author: {
    name: article.author.name,
    handle: article.author.handle,
    grade: gradeOf(article.author.planTier)
  },
  publishedAt: article.firstPublishedAt?.toISOString() ?? null,
  isTranslation: article.sourceLocale !== locale
})

/**
 * Подборки главной первого этапа из одного отсортированного по дате списка кандидатов.
 *
 * Топ забирает пять первых, «Новое» — следующие материалы внутри окна новизны. Срезы не
 * пересекаются, поэтому статья не может попасть в два блока одной главной (журнал §22.4), а
 * освободившееся место сразу занимает следующий кандидат. Пустая подборка в ответ не
 * попадает: страница скрывает зону, для которой нет материалов (`home.md` §5).
 *
 * «Популярное» появится вместе с контуром вовлечённости (`home-sections.md` §3, F-02): до
 * него сумма допустимых сигналов неизвестна, а порядок по дате популярностью не является.
 */
export const buildHomeSections = (
  articles: readonly FeedArticleRecord[],
  locale: FeedLocale,
  now: Date
): FeedSection[] => {
  const ranked = articles.filter((article) => article.section !== null && article.firstPublishedAt !== null)
  const top = ranked.slice(0, HOME_TOP_SIZE)
  const takenIds = new Set(top.map((article) => article.id))
  const windowStart = new Date(now.getTime() - HOME_NEW_WINDOW_DAYS * DAY_MS)
  const fresh = ranked
    .filter((article) => !takenIds.has(article.id) && article.firstPublishedAt!.getTime() >= windowStart.getTime())
    .slice(0, HOME_NEW_SIZE)

  const sections: FeedSection[] = []
  // До запуска движка рейтинга топ — пять последних по дате с явной подписью (журнал §20.4).
  if (top.length > 0) {
    sections.push({ key: "top", caption: "by_publication_date", items: top.map((a) => toFeedItem(a, locale)) })
  }
  if (fresh.length > 0) {
    sections.push({ key: "new", caption: "by_publication_date", items: fresh.map((a) => toFeedItem(a, locale)) })
  }
  return sections
}

export default {
  Query: {
    feed: async (
      _parent: unknown,
      args: { scope?: FeedScope; locale: FeedLocale },
      ctx: GraphQLContext
    ): Promise<Feed> => {
      const scope = args.scope ?? "home"
      const locale = args.locale

      // Ответ одинаков для всех и не зависит от сессии (ADR-0019): кеш общий, тег `home`
      // уже инвалидируют публикация, снятие и массовые операции над материалами.
      return readThroughPublicCache(
        {
          cache: ctx.cache,
          key: buildCacheKey("query.feed", { scope, locale }),
          tags: ["home"],
          ttlSeconds: CACHE_TTL_SECONDS.publicList
        },
        async () => {
          const articles = (await ctx.prisma.article.findMany({
            where: publicArticleWhere({
              sourceLocale: locale,
              sectionId: { not: null },
              firstPublishedAt: { not: null }
            }),
            orderBy: { firstPublishedAt: "desc" },
            take: HOME_TOP_SIZE + HOME_NEW_SIZE,
            select: feedArticleSelect
          })) as unknown as FeedArticleRecord[]

          return { scope, locale, sections: buildHomeSections(articles, locale, new Date()) }
        }
      )
    }
  }
}
