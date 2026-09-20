import type { GraphQLContext } from "../../prisma"
import { buildCacheKey, CACHE_TTL_SECONDS } from "../../cache"
import { readThroughPublicCache } from "../../cache/read-through"
import { createApiError } from "../../errors/graphql-error"
import { publicArticleWhere } from "../../visibility/article"

type FeedLocale = "ru" | "en"
type FeedScope = "home" | "section" | "tag" | "latest"
type FeedSectionKey = "top" | "new" | "popular"
type FeedCaption = "by_publication_date"
type AuthorGrade = "standard" | "pro"

/** Главный топ — ровно пять материалов (журнал §20.2). */
export const HOME_TOP_SIZE = 5
/** «Новое» — до двенадцати карточек (`home.md` §5 `[ДОПУЩЕНИЕ]`). */
export const HOME_NEW_SIZE = 12
/** Окно новизны — трое суток (`home-sections.md` §3 `[ДОПУЩЕНИЕ]`). */
export const HOME_NEW_WINDOW_DAYS = 3
/** Страница ленты рубрики и тега — 24 материала (`section-feed.md` §5 `[ДОПУЩЕНИЕ]`). */
export const FEED_PAGE_SIZE = 24
/** Сколько частых тегов рубрики предлагается фильтром (`section-feed.md` §5 зона 3). */
export const SECTION_TOP_TAGS = 12
/** Потолок ленты `latest`: RSS отдаёт до пятидесяти элементов (`feeds-and-sitemap.md` §12). */
export const LATEST_FEED_MAX_LIMIT = 50

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

interface FeedPageInfo {
  page: number
  totalPages: number
  hasNext: boolean
}

interface FeedFacet {
  slug: string
  name: string
  count: number
}

export interface Feed {
  scope: FeedScope
  locale: FeedLocale
  sections: FeedSection[]
  items: FeedItem[]
  caption: FeedCaption | null
  pageInfo: FeedPageInfo | null
  section: { slug: string; name: string; description: string | null; articleCount: number } | null
  tag: { slug: string; name: string; articleCount: number } | null
  formats: FeedFacet[]
  topTags: FeedFacet[]
  otherSections: FeedFacet[]
  redirect: { scope: FeedScope; slug: string } | null
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

/** Слово локали с откатом на русское: `nameEn` у рубрики необязателен. */
export const localizedName = (name: string, nameEn: string | null | undefined, locale: FeedLocale): string =>
  (locale === "en" ? nameEn : name) || name

const toFeedItem = (article: FeedArticleRecord, locale: FeedLocale): FeedItem => ({
  id: article.id,
  slug: article.slug,
  sectionSlug: article.section!.slug,
  sectionName: localizedName(article.section!.name, article.section!.nameEn, locale),
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

/** Пустой каркас ответа: ленты заполняют только свои поля, остальные остаются пустыми. */
const emptyFeed = (scope: FeedScope, locale: FeedLocale): Feed => ({
  scope,
  locale,
  sections: [],
  items: [],
  caption: null,
  pageInfo: null,
  section: null,
  tag: null,
  formats: [],
  topTags: [],
  otherSections: [],
  redirect: null
})

/**
 * Номер страницы из запроса. Дробное и меньшее единицы значение — отказ `VALIDATION_ERROR`,
 * из которого страница делает 404 (`section-feed.md` §8): дальше по ленте такой адрес не
 * ведёт никуда, и молча подменять его первой страницей значит показывать не то, что в URL.
 */
export const requireValidPage = (page: number, requestId: string): number => {
  if (!Number.isInteger(page) || page < 1) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "page", rule: "positive-integer" })
  }
  return page
}

/**
 * Разбивка на страницы по числу найденных материалов. Пустая лента даёт ноль страниц —
 * состояние «пусто», а не отказ; запрошенная страница за последней — 404 (`page` вне
 * диапазона, `section-feed.md` §12).
 */
export const feedPageInfo = (totalCount: number, page: number, requestId: string): FeedPageInfo => {
  const totalPages = Math.ceil(totalCount / FEED_PAGE_SIZE)
  if (totalPages > 0 && page > totalPages) {
    throw createApiError("NOT_FOUND", { requestId, entity: "feedPage" })
  }
  return { page, totalPages, hasNext: page < totalPages }
}

const toFacet = (
  entity: { slug: string; name: string; nameEn?: string | null },
  count: number,
  locale: FeedLocale
): FeedFacet => ({ slug: entity.slug, name: localizedName(entity.name, entity.nameEn, locale), count })

/**
 * Материалы ленты одной страницей. Порядок — новизна, затем `id`: без второго ключа две
 * публикации одной секунды могли бы разойтись по страницам и потеряться при листании
 * (`section-feed.md` §5).
 */
const readFeedPage = async (
  ctx: GraphQLContext,
  where: object,
  page: number,
  locale: FeedLocale
): Promise<FeedItem[]> => {
  const articles = (await ctx.prisma.article.findMany({
    where,
    orderBy: [{ firstPublishedAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * FEED_PAGE_SIZE,
    take: FEED_PAGE_SIZE,
    select: feedArticleSelect
  })) as unknown as FeedArticleRecord[]

  // Материал без рубрики в ленту не попадает: путь его карточки без неё не собрать.
  return articles.filter((article) => article.section !== null).map((article) => toFeedItem(article, locale))
}

const buildSectionFeed = async (
  ctx: GraphQLContext,
  locale: FeedLocale,
  slug: string,
  format: string | null,
  tag: string | null,
  page: number
): Promise<Feed> => {
  const section = await ctx.prisma.section.findUnique({
    where: { slug },
    select: {
      name: true,
      nameEn: true,
      description: true,
      descriptionEn: true,
      status: true,
      successor: { select: { slug: true } }
    }
  })

  if (!section) {
    // Прежний слаг рубрики ведёт на нынешний: реестр слагов никогда не чистится (ADR-0004).
    const history = await ctx.prisma.sectionSlugHistory.findUnique({
      where: { slug },
      select: { redirectToSection: { select: { slug: true } } }
    })
    const target = history?.redirectToSection?.slug
    if (!target) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "section" })
    return { ...emptyFeed("section", locale), redirect: { scope: "section", slug: target } }
  }

  // Архивируется только пустая рубрика и только с преемником (`admin-sections.md` #2):
  // её адрес остаётся рабочим и ведёт туда, куда переехали материалы.
  if (section.status === "archived") {
    const target = section.successor?.slug
    if (!target) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "section" })
    return { ...emptyFeed("section", locale), redirect: { scope: "section", slug: target } }
  }

  const sectionWhere = publicArticleWhere({ sourceLocale: locale, section: { slug } })
  const articleCount = await ctx.prisma.article.count({ where: sectionWhere })
  // Рубрика без публикаций в локали не публична и отвечает 404 (журнал §20.9).
  if (articleCount === 0) {
    throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "section" })
  }

  const filtered = {
    ...sectionWhere,
    ...(format ? { format: { slug: format } } : {}),
    ...(tag ? { tags: { some: { slug: tag } } } : {})
  }

  const [totalCount, formatGroups, tags, otherSections] = await Promise.all([
    ctx.prisma.article.count({ where: filtered }),
    ctx.prisma.article.groupBy({ by: ["formatId"], where: sectionWhere, _count: { _all: true } }),
    ctx.prisma.tag.findMany({
      where: { status: "active", mergedIntoId: null, articles: { some: sectionWhere } },
      select: { slug: true, name: true, nameEn: true, _count: { select: { articles: { where: sectionWhere } } } }
    }),
    ctx.prisma.section.findMany({
      where: {
        status: "active",
        slug: { not: slug },
        articles: { some: publicArticleWhere({ sourceLocale: locale }) }
      },
      orderBy: { order: "asc" },
      select: {
        slug: true,
        name: true,
        nameEn: true,
        _count: { select: { articles: { where: publicArticleWhere({ sourceLocale: locale }) } } }
      }
    })
  ])

  const pageInfo = feedPageInfo(totalCount, page, ctx.requestId)
  const formatIds = formatGroups.map((group) => group.formatId).filter((id): id is string => id !== null)
  const formats = formatIds.length
    ? await ctx.prisma.format.findMany({
        where: { id: { in: formatIds }, status: "active" },
        select: { id: true, slug: true, name: true, nameEn: true }
      })
    : []
  const countByFormat = new Map(formatGroups.map((group) => [group.formatId, group._count._all]))

  return {
    ...emptyFeed("section", locale),
    items: totalCount > 0 ? await readFeedPage(ctx, filtered, page, locale) : [],
    caption: "by_publication_date",
    pageInfo,
    section: {
      slug,
      name: localizedName(section.name, section.nameEn, locale),
      description: (locale === "en" ? section.descriptionEn : section.description) ?? section.description,
      articleCount
    },
    formats: formats.map((format) => toFacet(format, countByFormat.get(format.id) ?? 0, locale)),
    topTags: tags
      .map((entity) => toFacet(entity, entity._count.articles, locale))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
      .slice(0, SECTION_TOP_TAGS),
    otherSections: otherSections.map((entity) => toFacet(entity, entity._count.articles, locale))
  }
}

const buildTagFeed = async (ctx: GraphQLContext, locale: FeedLocale, slug: string, page: number): Promise<Feed> => {
  const tag = await ctx.prisma.tag.findUnique({
    where: { slug },
    select: { name: true, nameEn: true, status: true, mergedInto: { select: { slug: true } } }
  })

  if (!tag) {
    const history = await ctx.prisma.tagSlugHistory.findUnique({
      where: { slug },
      select: { redirectToTag: { select: { slug: true } } }
    })
    const target = history?.redirectToTag?.slug
    if (!target) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "tag" })
    return { ...emptyFeed("tag", locale), redirect: { scope: "tag", slug: target } }
  }

  // Слитый тег переехал в целевой и отвечает 301; архивированный — 404 (`tag-feed.md` §2).
  if (tag.mergedInto) {
    return { ...emptyFeed("tag", locale), redirect: { scope: "tag", slug: tag.mergedInto.slug } }
  }
  if (tag.status === "archived") {
    throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "tag" })
  }

  // Тег без публикаций в этой локали остаётся страницей с пустым состоянием: материалы
  // другого языка не подмешиваются (журнал §20.5), а тег с одной статьёй виден (§20.10).
  const where = publicArticleWhere({ sourceLocale: locale, tags: { some: { slug } } })
  const articleCount = await ctx.prisma.article.count({ where })
  const pageInfo = feedPageInfo(articleCount, page, ctx.requestId)

  return {
    ...emptyFeed("tag", locale),
    items: articleCount > 0 ? await readFeedPage(ctx, where, page, locale) : [],
    caption: "by_publication_date",
    pageInfo,
    tag: { slug, name: localizedName(tag.name, tag.nameEn, locale), articleCount }
  }
}

/**
 * Размер ленты `latest`. Ноль, отрицательное и дробное значение — отказ `VALIDATION_ERROR`:
 * молча подменять их числом по умолчанию значит отдавать не то, что запросил клиент. Запрос
 * сверх потолка усекается до него: пятьдесят элементов — граница ленты, а не ошибка адреса
 * (`feeds-and-sitemap.md` §12 `[ДОПУЩЕНИЕ]`).
 */
export const requireValidLimit = (limit: number, requestId: string): number => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "limit", rule: "positive-integer" })
  }
  return Math.min(limit, LATEST_FEED_MAX_LIMIT)
}

/**
 * Плоский список последних публикаций локали для RSS (`feeds-and-sitemap.md` §4). Порядок —
 * дата первой публикации, затем `id`: доработки и «обновлено» (§20.6) элемент не поднимают,
 * поэтому сортировка по `updatedAt` здесь не используется. Материал без рубрики в ленту не
 * попадает — без неё не собрать адрес его страницы.
 */
const buildLatestFeed = async (ctx: GraphQLContext, locale: FeedLocale, limit: number): Promise<Feed> => {
  const articles = (await ctx.prisma.article.findMany({
    where: publicArticleWhere({
      sourceLocale: locale,
      sectionId: { not: null },
      firstPublishedAt: { not: null }
    }),
    orderBy: [{ firstPublishedAt: "desc" }, { id: "asc" }],
    take: limit,
    select: feedArticleSelect
  })) as unknown as FeedArticleRecord[]

  return {
    ...emptyFeed("latest", locale),
    items: articles.filter((article) => article.section !== null).map((article) => toFeedItem(article, locale)),
    caption: "by_publication_date"
  }
}

const buildHomeFeed = async (ctx: GraphQLContext, locale: FeedLocale): Promise<Feed> => {
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

  return { ...emptyFeed("home", locale), sections: buildHomeSections(articles, locale, new Date()) }
}

export default {
  Query: {
    feed: async (
      _parent: unknown,
      args: {
        scope?: FeedScope
        locale: FeedLocale
        slug?: string | null
        format?: string | null
        tag?: string | null
        page?: number
        limit?: number
      },
      ctx: GraphQLContext
    ): Promise<Feed> => {
      const scope = args.scope ?? "home"
      const locale = args.locale
      const page = requireValidPage(args.page ?? 1, ctx.requestId)
      const limit = requireValidLimit(args.limit ?? LATEST_FEED_MAX_LIMIT, ctx.requestId)
      const slug = args.slug?.trim() ?? ""
      const format = args.format?.trim() || null
      const tag = args.tag?.trim() || null

      if (scope !== "home" && scope !== "latest" && !slug) {
        throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "slug", rule: "required" })
      }

      // Ответ одинаков для всех и не зависит от сессии (ADR-0019): кеш общий, а теги
      // публикации уже сбрасывают и главную, и ленты рубрики и тега затронутого материала.
      const tags = scope === "section" ? [`section:${slug}`] : scope === "tag" ? [`tag:${slug}`] : ["home"]

      return readThroughPublicCache(
        {
          cache: ctx.cache,
          // Размер читает только `latest`: ключу остальных областей он не нужен, иначе
          // лишний аргумент запроса разводит одинаковые ответы по разным записям кеша.
          key: buildCacheKey("query.feed", {
            scope,
            locale,
            slug,
            format,
            tag,
            page,
            ...(scope === "latest" ? { limit } : {})
          }),
          tags,
          ttlSeconds: CACHE_TTL_SECONDS.publicList
        },
        async () => {
          if (scope === "section") return buildSectionFeed(ctx, locale, slug, format, tag, page)
          if (scope === "tag") return buildTagFeed(ctx, locale, slug, page)
          if (scope === "latest") return buildLatestFeed(ctx, locale, limit)
          return buildHomeFeed(ctx, locale)
        }
      )
    }
  }
}
