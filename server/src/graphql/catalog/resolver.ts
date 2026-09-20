import type { GraphQLContext } from "../../prisma"
import { buildCacheKey, CACHE_TTL_SECONDS } from "../../cache"
import { readThroughPublicCache } from "../../cache/read-through"
import { createApiError } from "../../errors/graphql-error"
import { publicArticleWhere } from "../../visibility/article"
import { localizedName } from "../feed/resolver"

type CatalogLocale = "ru" | "en"
type TagCatalogSort = "popular" | "name"
type AuthorCatalogSort = "recent" | "name"

/** Рубрик — единицы (ADR-0005), пагинации у каталога нет (`sections-index.md` §5). */
export const SECTION_PREVIEW_SIZE = 3
/** Сто тегов на страницу (`tags-index.md` §5 `[ДОПУЩЕНИЕ]`). */
export const TAG_CATALOG_PAGE_SIZE = 100
/** Облако популярных тегов — 30 (`tags-index.md` §4 `[ДОПУЩЕНИЕ]`). */
export const POPULAR_TAGS_LIMIT = 30
/** Поиск по началу слова — от двух знаков (`tags-index.md` §3 `[ДОПУЩЕНИЕ]`). */
export const TAG_SEARCH_MIN_LENGTH = 2
/** Тридцать авторов на страницу (`authors-index.md` §5 `[ДОПУЩЕНИЕ]`). */
export const AUTHOR_CATALOG_PAGE_SIZE = 30
/** Две последние публикации в карточке автора (`authors-index.md` §5 `[ДОПУЩЕНИЕ]`). */
export const AUTHOR_RECENT_SIZE = 2

interface CatalogPageInfo {
  page: number
  totalPages: number
  totalCount: number
  hasNext: boolean
}

interface CatalogEntity {
  slug: string
  name: string
  articleCount: number
}

const requirePage = (page: number, requestId: string): number => {
  if (!Number.isInteger(page) || page < 1) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "page", rule: "positive-integer" })
  }
  return page
}

/**
 * Буква указателя: ровно один знак. Пустая строка и слово — неверный параметр, а не
 * молчаливое «показать всё»: адрес обещает срез, которого не существует.
 */
const requireLetter = (letter: string | null | undefined, requestId: string): string | null => {
  if (letter === null || letter === undefined) return null
  const value = letter.trim()
  if (value.length !== 1) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "letter", rule: "single-character" })
  }
  return value.toLocaleUpperCase()
}

const requireQuery = (q: string | null | undefined, requestId: string): string | null => {
  if (q === null || q === undefined) return null
  const value = q.trim()
  if (value.length === 0) return null
  if (value.length < TAG_SEARCH_MIN_LENGTH) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "q", rule: "min-length" })
  }
  return value
}

/** Страница из уже собранного списка: каталоги невелики, счёт идёт по видимым записям. */
export const paginate = <T>(items: readonly T[], page: number, pageSize: number, requestId: string) => {
  const totalPages = Math.ceil(items.length / pageSize)
  if (totalPages > 0 && page > totalPages) {
    throw createApiError("NOT_FOUND", { requestId, entity: "catalogPage" })
  }
  const pageInfo: CatalogPageInfo = { page, totalPages, totalCount: items.length, hasNext: page < totalPages }
  return { pageInfo, items: items.slice((page - 1) * pageSize, page * pageSize) }
}

/** Первые буквы имён списка — указатель панели; порядок алфавитный, повторов нет. */
export const lettersOf = (names: readonly string[]): string[] =>
  [...new Set(names.map((name) => name.trim().charAt(0).toLocaleUpperCase()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  )

const startsWithLetter = (name: string, letter: string): boolean => name.trim().charAt(0).toLocaleUpperCase() === letter

/** Первое предложение «о себе»; пустая биография остаётся пустой, а не строкой из пробелов. */
export const firstSentence = (bio: string | null | undefined): string | null => {
  const value = bio?.trim()
  if (!value) return null
  const match = value.match(/^[\s\S]*?[.!?](?=\s|$)/)
  return (match?.[0] ?? value).trim() || null
}

const articlePath = (sectionSlug: string, slug: string): string => `/${sectionSlug}/${slug}`

interface ArticleLinkRecord {
  title: string
  slug: string
  author: { name: string }
  section: { slug: string } | null
}

const toArticleLink = (article: ArticleLinkRecord) => ({
  title: article.title,
  path: articlePath(article.section!.slug, article.slug),
  author: article.author.name
})

const articleLinkSelect = {
  title: true,
  slug: true,
  author: { select: { name: true } },
  section: { select: { slug: true } }
} as const

export default {
  Query: {
    /**
     * Каталог рубрик: только активные рубрики хотя бы с одной публикацией в локали
     * (журнал §20.9). Порядок — ручной `order` из админки, а не рейтинг
     * (`sections-index.md` §1).
     */
    sectionCatalog: async (_parent: unknown, args: { locale: CatalogLocale }, ctx: GraphQLContext) => {
      const { locale } = args
      const where = publicArticleWhere({ sourceLocale: locale })

      return readThroughPublicCache(
        {
          cache: ctx.cache,
          key: buildCacheKey("query.sectionCatalog", { locale }),
          tags: ["home"],
          ttlSeconds: CACHE_TTL_SECONDS.publicList
        },
        async () => {
          const sections = await ctx.prisma.section.findMany({
            where: { status: "active", articles: { some: where } },
            orderBy: { order: "asc" },
            select: {
              slug: true,
              name: true,
              nameEn: true,
              description: true,
              descriptionEn: true,
              order: true,
              _count: { select: { articles: { where } } },
              articles: {
                where,
                orderBy: [{ firstPublishedAt: "desc" }, { id: "asc" }],
                take: SECTION_PREVIEW_SIZE,
                select: articleLinkSelect
              }
            }
          })

          return sections.map((section) => ({
            slug: section.slug,
            name: localizedName(section.name, section.nameEn, locale),
            description: (locale === "en" ? section.descriptionEn : section.description) ?? section.description,
            // Обложки рубрики в модели пока нет: карточка рисует плашку по токену
            // (`sections-index.md` §5), поле остаётся пустым до появления медиа рубрики.
            cover: null,
            order: section.order,
            articleCount: section._count.articles,
            preview: section.articles.map(toArticleLink)
          }))
        }
      )
    },

    /**
     * Каталог тегов: активные теги с публикациями в локали. Слитые и архивированные в
     * выдачу не входят — их адреса отвечают 301 и 404 (`tags-index.md` §2). Счётчик и
     * сортировка считаются по локали, поэтому один тег в `ru` и `en` даёт разные числа.
     */
    tagCatalog: async (
      _parent: unknown,
      args: { locale: CatalogLocale; q?: string | null; letter?: string | null; sort: TagCatalogSort; page: number },
      ctx: GraphQLContext
    ) => {
      const { locale, sort } = args
      const page = requirePage(args.page, ctx.requestId)
      const q = requireQuery(args.q, ctx.requestId)
      const letter = requireLetter(args.letter, ctx.requestId)

      return readThroughPublicCache(
        {
          cache: ctx.cache,
          key: buildCacheKey("query.tagCatalog", { locale, q, letter, sort, page }),
          tags: ["home"],
          ttlSeconds: CACHE_TTL_SECONDS.publicList
        },
        async () => {
          const visible = await readVisibleTags(ctx, locale)
          const letters = lettersOf(visible.map((tag) => tag.name))
          const prefix = q?.toLocaleLowerCase()
          const filtered = visible
            .filter((tag) => (prefix ? tag.name.toLocaleLowerCase().startsWith(prefix) : true))
            .filter((tag) => (letter ? startsWithLetter(tag.name, letter) : true))
            .sort(sortTags(sort))

          return { ...paginate(filtered, page, TAG_CATALOG_PAGE_SIZE, ctx.requestId), letters }
        }
      )
    },

    /** Облако популярных тегов: те же видимые теги, срез по счётчику локали. */
    popularTags: async (_parent: unknown, args: { locale: CatalogLocale; limit: number }, ctx: GraphQLContext) => {
      const { locale } = args
      const limit = Math.min(Math.max(args.limit, 1), POPULAR_TAGS_LIMIT)

      return readThroughPublicCache(
        {
          cache: ctx.cache,
          key: buildCacheKey("query.popularTags", { locale, limit }),
          tags: ["home"],
          ttlSeconds: CACHE_TTL_SECONDS.publicList
        },
        async () => (await readVisibleTags(ctx, locale)).sort(sortTags("popular")).slice(0, limit)
      )
    },

    /**
     * Каталог авторов: аккаунты хотя бы с одной публикацией в локали. Истёкший план автора
     * из каталога не убирает и порядок не понижает (журнал §20.8), состояния плана в
     * публичном типе нет (ADR-0018). До запуска рейтинга порядок — дата последней
     * публикации (`authors-index.md` §1).
     */
    authorCatalog: async (
      _parent: unknown,
      args: {
        locale: CatalogLocale
        sort: AuthorCatalogSort
        section?: string | null
        letter?: string | null
        page: number
      },
      ctx: GraphQLContext
    ) => {
      const { locale, sort } = args
      const page = requirePage(args.page, ctx.requestId)
      const letter = requireLetter(args.letter, ctx.requestId)
      const section = args.section?.trim() || null

      return readThroughPublicCache(
        {
          cache: ctx.cache,
          key: buildCacheKey("query.authorCatalog", { locale, sort, section, letter, page }),
          tags: ["home"],
          ttlSeconds: CACHE_TTL_SECONDS.publicList
        },
        async () => {
          const where = publicArticleWhere({
            sourceLocale: locale,
            ...(section ? { section: { slug: section } } : {})
          })

          const users = await ctx.prisma.user.findMany({
            where: { archivedAt: null, articles: { some: where } },
            select: {
              id: true,
              handle: true,
              name: true,
              bio: true,
              photoUrl: true,
              planTier: true,
              isServiceAccount: true,
              _count: { select: { articles: { where } } },
              articles: {
                where,
                orderBy: [{ firstPublishedAt: "desc" }, { id: "asc" }],
                take: AUTHOR_RECENT_SIZE,
                select: { ...articleLinkSelect, firstPublishedAt: true }
              }
            }
          })

          const items = users.map((user) => ({
            id: user.id,
            handle: user.handle,
            name: user.name,
            avatar: user.photoUrl,
            grade: user.planTier === "pro" ? ("pro" as const) : ("standard" as const),
            bioShort: firstSentence(user.bio),
            publishedCount: user._count.articles,
            lastPublishedAt: user.articles[0]?.firstPublishedAt?.toISOString() ?? null,
            isEditorial: user.isServiceAccount,
            recent: user.articles.filter((article) => article.section !== null).map(toArticleLink)
          }))

          const letters = lettersOf(items.map((author) => author.name))
          const filtered = items
            .filter((author) => (letter ? startsWithLetter(author.name, letter) : true))
            .sort(sortAuthors(sort))

          return { ...paginate(filtered, page, AUTHOR_CATALOG_PAGE_SIZE, ctx.requestId), letters }
        }
      )
    }
  }
}

/**
 * Видимые теги со счётчиком локали. Prisma не умеет сортировать по счёту связи с условием,
 * поэтому порядок и страница считаются здесь: видимых тегов столько же, сколько показывает
 * сам каталог, и держать их в памяти дешевле, чем заводить отдельную денормализацию.
 */
const readVisibleTags = async (ctx: GraphQLContext, locale: CatalogLocale): Promise<CatalogEntity[]> => {
  const where = publicArticleWhere({ sourceLocale: locale })
  const tags = await ctx.prisma.tag.findMany({
    where: { status: "active", mergedIntoId: null, articles: { some: where } },
    select: { slug: true, name: true, nameEn: true, _count: { select: { articles: { where } } } }
  })

  return tags.map((tag) => ({
    slug: tag.slug,
    name: localizedName(tag.name, tag.nameEn, locale),
    articleCount: tag._count.articles
  }))
}

const sortTags =
  (sort: TagCatalogSort) =>
  (left: CatalogEntity, right: CatalogEntity): number =>
    sort === "name"
      ? left.name.localeCompare(right.name)
      : right.articleCount - left.articleCount || left.name.localeCompare(right.name)

interface SortableAuthor {
  name: string
  isEditorial: boolean
  lastPublishedAt: string | null
}

/** «Редакция» идёт первой карточкой при любом порядке (`authors-index.md` §2 `[ДОПУЩЕНИЕ]`). */
const sortAuthors =
  (sort: AuthorCatalogSort) =>
  (left: SortableAuthor, right: SortableAuthor): number => {
    if (left.isEditorial !== right.isEditorial) return left.isEditorial ? -1 : 1
    if (sort === "name") return left.name.localeCompare(right.name)
    return (right.lastPublishedAt ?? "").localeCompare(left.lastPublishedAt ?? "")
  }
