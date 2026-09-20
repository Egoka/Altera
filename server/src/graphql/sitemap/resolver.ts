import type { GraphQLContext } from "../../prisma"
import { buildCacheKey, CACHE_TTL_SECONDS } from "../../cache"
import { readThroughPublicCache } from "../../cache/read-through"
import { publicArticleWhere } from "../../visibility/article"

type SitemapLocale = "ru" | "en"

/** Обе локали выдачи: карта одной локали знает про вторую только ради `hreflang`. */
export const SITEMAP_LOCALES: readonly SitemapLocale[] = ["ru", "en"]

/**
 * Приоритеты адресов (`feeds-and-sitemap.md` §5.3 `[ДОПУЩЕНИЕ]`): главная выше материалов,
 * материалы выше списков. Числа — подсказка роботу о внутреннем весе, а не обещание позиции.
 */
export const SITEMAP_PRIORITY = { home: 1.0, article: 0.8, list: 0.5 } as const

/** Потолок адресов в одном файле (`feeds-and-sitemap.md` §5.3). */
export const SITEMAP_MAX_URLS = 50_000

/**
 * Статические публичные страницы. `/me`, `/admin`, `/auth`, `/search`, предпросмотр и адреса
 * с параметрами в карту не попадают (§4); `/about` и `/legal/*` появятся здесь вместе со
 * своими страницами — сейчас таких маршрутов в вебе нет.
 */
const STATIC_PATHS = ["/sections", "/tags", "/authors", "/pricing"] as const

export interface SitemapEntry {
  path: string
  lastmod: string | null
  priority: number
  locales: SitemapLocale[]
}

type LocaleEntry = Omit<SitemapEntry, "locales">

const iso = (date: Date | null | undefined): string | null => date?.toISOString() ?? null

/** Последний по дате изменения материал списка: его дата и есть `lastmod` страницы списка. */
const lastmodOf = (owner: { articles: readonly { updatedAt: Date }[] }): string | null =>
  iso(owner.articles[0]?.updatedAt)

/**
 * Публичные адреса одной локали. Отбор материалов повторяет границу лент: только
 * опубликованные и только язык оригинала (журнал §20.5) — версии другой локали в список
 * текущей не подмешиваются. Черновики, снятые, архивированные и отклонённые материалы
 * исключены условием `publicArticleWhere`, пустые рубрики и теги — условием `some` (§20.9).
 */
export const collectLocaleEntries = async (ctx: GraphQLContext, locale: SitemapLocale): Promise<LocaleEntry[]> => {
  const where = publicArticleWhere({ sourceLocale: locale })
  const withSection = publicArticleWhere({ sourceLocale: locale, sectionId: { not: null } })
  const latestArticle = { where, orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } } as const

  const [newest, articles, sections, tags, authors] = await Promise.all([
    ctx.prisma.article.findFirst({ where, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    ctx.prisma.article.findMany({
      where: withSection,
      orderBy: [{ firstPublishedAt: "desc" }, { id: "asc" }],
      take: SITEMAP_MAX_URLS,
      select: { slug: true, updatedAt: true, section: { select: { slug: true } } }
    }),
    ctx.prisma.section.findMany({
      where: { status: "active", articles: { some: where } },
      orderBy: { order: "asc" },
      select: { slug: true, articles: latestArticle }
    }),
    ctx.prisma.tag.findMany({
      where: { status: "active", mergedIntoId: null, articles: { some: where } },
      orderBy: { slug: "asc" },
      select: { slug: true, articles: latestArticle }
    }),
    ctx.prisma.user.findMany({
      where: { archivedAt: null, articles: { some: where } },
      orderBy: { handle: "asc" },
      select: { handle: true, articles: latestArticle }
    })
  ])

  const home: LocaleEntry = { path: "/", lastmod: iso(newest?.updatedAt), priority: SITEMAP_PRIORITY.home }
  const statics = STATIC_PATHS.map((path) => ({ path, lastmod: null, priority: SITEMAP_PRIORITY.list }))

  return [
    home,
    ...statics,
    // Материал без рубрики в карту не попадает: без неё не собрать адрес его страницы.
    ...articles
      .filter((article) => article.section !== null)
      .map((article) => ({
        path: `/${article.section!.slug}/${article.slug}`,
        lastmod: iso(article.updatedAt),
        priority: SITEMAP_PRIORITY.article
      })),
    ...sections.map((section) => ({
      path: `/${section.slug}`,
      lastmod: lastmodOf(section),
      priority: SITEMAP_PRIORITY.list
    })),
    ...tags.map((tag) => ({ path: `/tags/${tag.slug}`, lastmod: lastmodOf(tag), priority: SITEMAP_PRIORITY.list })),
    ...authors.map((author) => ({
      path: `/authors/${author.handle}`,
      lastmod: lastmodOf(author),
      priority: SITEMAP_PRIORITY.list
    }))
  ]
}

/**
 * Карта локали с отметкой языковых версий. Адрес рубрики, тега или автора публичен только
 * там, где у него есть публикации, поэтому альтернатива проставляется по факту присутствия
 * пути во второй карте, а не по возможности собрать ссылку (ADR-0002). Материал остаётся
 * одноязычным до перевода API на языковые версии (T-020): его пара появится вместе с ними.
 */
export const buildSitemap = (
  entries: readonly LocaleEntry[],
  otherPaths: ReadonlySet<string>,
  locale: SitemapLocale
): SitemapEntry[] => {
  const other = SITEMAP_LOCALES.filter((value) => value !== locale)

  return entries.map((entry) => ({
    ...entry,
    locales: [locale, ...(otherPaths.has(entry.path) ? other : [])]
  }))
}

export default {
  Query: {
    sitemapEntries: async (
      _parent: unknown,
      args: { locale: SitemapLocale },
      ctx: GraphQLContext
    ): Promise<SitemapEntry[]> => {
      const locale = args.locale

      // Ответ одинаков для всех и не зависит от сессии (ADR-0019). Тег `home` уже сбрасывают
      // публикация, снятие и смена слага — те же события, что пересобирают карту (§4).
      return readThroughPublicCache(
        {
          cache: ctx.cache,
          key: buildCacheKey("query.sitemapEntries", { locale }),
          tags: ["home"],
          ttlSeconds: CACHE_TTL_SECONDS.publicList
        },
        async () => {
          const [entries, ...rest] = await Promise.all([
            collectLocaleEntries(ctx, locale),
            ...SITEMAP_LOCALES.filter((value) => value !== locale).map((value) => collectLocaleEntries(ctx, value))
          ])

          const otherPaths = new Set(rest.flat().map((entry) => entry.path))
          return buildSitemap(entries!, otherPaths, locale)
        }
      )
    }
  }
}
