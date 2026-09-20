import enMessages from "../../i18n/locales/en.json"
import ruMessages from "../../i18n/locales/ru.json"

// Сборка машиночитаемых ответов: RSS локали, индекс карты сайта и карта локали
// (`docs/spec/20-public/feeds-and-sitemap.md`). Модуль не ходит в сеть и не знает про Nitro:
// маршруты передают сюда готовые данные API, а обратно получают текст ответа.

export type FeedLocale = "ru" | "en"

/** Порядок локалей индекса совпадает с порядком в `nuxt.config`: русская — основная. */
export const FEED_LOCALES: readonly FeedLocale[] = ["ru", "en"]

/** Язык канала и `hreflang`: те же коды, что в `i18n.locales` и в тегах страниц. */
const LOCALE_TAG: Record<FeedLocale, string> = { ru: "ru-RU", en: "en-US" }

/** Название и описание издания берутся из словаря подвала — второго источника нет. */
const CHANNEL: Record<FeedLocale, { title: string; description: string }> = {
  ru: { title: "Altera", description: ruMessages.footer.description },
  en: { title: "Altera", description: enMessages.footer.description }
}

export interface RssItem {
  slug: string
  sectionSlug: string
  sectionName: string
  title: string
  dek: string | null
  cover: string | null
  author: { name: string }
  publishedAt: string | null
}

export interface SitemapEntry {
  path: string
  lastmod: string | null
  priority: number
  locales: FeedLocale[]
}

export const isFeedLocale = (value: string): value is FeedLocale => FEED_LOCALES.includes(value as FeedLocale)

/**
 * Пять символов XML экранируются всегда: кавычки и апостроф нужны внутри значений атрибутов
 * `xhtml:link`, а не только в тексте узлов.
 */
export const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      default:
        return "&apos;"
    }
  })

/**
 * Путь локали по схеме `prefix_except_default` из `nuxt.config`: русская выдача живёт без
 * префикса, английская — под `/en`. Главная английской локали — `/en`, а не `/en/`.
 */
export const localePath = (path: string, locale: FeedLocale): string => {
  if (locale === "ru") return path
  return path === "/" ? "/en" : `/en${path}`
}

export const absoluteUrl = (origin: string, path: string, locale: FeedLocale): string =>
  `${origin}${localePath(path, locale)}`

/** Адрес картинки из API бывает относительным: в фиде он должен стать полным. */
const absoluteAsset = (origin: string, value: string): string => (value.startsWith("/") ? `${origin}${value}` : value)

/** Дата RSS — RFC 822; непригодное значение пропускается, а не ломает ответ. */
const rfc822 = (value: string | null): string | null => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toUTCString()
}

const tag = (name: string, value: string, indent: string): string => `${indent}<${name}>${escapeXml(value)}</${name}>`

/**
 * Описание элемента: дек и обложка (§5.1). Полный текст материала в ленту не попадает —
 * агрегатор ведёт читателя на страницу, а не заменяет её. Разметка описания передаётся
 * экранированной, а не в `CDATA`: так это читает и строгий XML-разбор, и агрегатор.
 */
const itemDescription = (item: RssItem, origin: string): string | null => {
  const parts: string[] = []
  if (item.cover) parts.push(`<img src="${escapeXml(absoluteAsset(origin, item.cover))}" alt="" />`)
  if (item.dek) parts.push(`<p>${escapeXml(item.dek)}</p>`)
  return parts.length > 0 ? escapeXml(parts.join("")) : null
}

export interface RssOptions {
  origin: string
  locale: FeedLocale
  items: readonly RssItem[]
  /** Момент сборки ответа: `lastBuildDate` канала при пустой ленте берётся из него. */
  now?: Date
}

/**
 * Канал RSS локали. Пустая лента — валидный канал без элементов (§8): читателю и агрегатору
 * такой ответ говорит «публикаций пока нет», а отказ 404 говорил бы «ленты не существует».
 */
export const buildRssXml = ({ origin, locale, items, now = new Date() }: RssOptions): string => {
  const channel = CHANNEL[locale]
  const selfUrl = absoluteUrl(origin, "/rss.xml", locale)
  const dates = items
    .map((item) => item.publishedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
  const lastBuild = rfc822(dates.at(-1) ?? null) ?? now.toUTCString()

  const entries = items.map((item) => {
    const link = absoluteUrl(origin, `/${item.sectionSlug}/${item.slug}`, locale)
    const pubDate = rfc822(item.publishedAt)
    const description = itemDescription(item, origin)

    return [
      "    <item>",
      tag("title", item.title, "      "),
      `      <link>${escapeXml(link)}</link>`,
      // `guid` — адрес версии: он же ключ, по которому агрегатор отличает новый материал.
      `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
      ...(pubDate ? [`      <pubDate>${pubDate}</pubDate>`] : []),
      // Имя автора выводится через Dublin Core: `author` в RSS 2.0 ждёт адрес почты, а
      // почта автора — персональные данные и в публичный ответ не попадает (ADR-0018).
      tag("dc:creator", item.author.name, "      "),
      tag("category", item.sectionName, "      "),
      ...(description ? [`      <description>${description}</description>`] : []),
      "    </item>"
    ].join("\n")
  })

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    tag("title", channel.title, "    "),
    `    <link>${escapeXml(absoluteUrl(origin, "/", locale))}</link>`,
    tag("description", channel.description, "    "),
    `    <language>${LOCALE_TAG[locale]}</language>`,
    `    <lastBuildDate>${lastBuild}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />`,
    ...entries,
    "  </channel>",
    "</rss>",
    ""
  ].join("\n")
}

export interface SitemapIndexLocale {
  locale: FeedLocale
  lastmod: string | null
}

/** Адрес карты локали: `/sitemap-ru.xml` и `/sitemap-en.xml` без префикса языка (§3). */
export const sitemapPath = (locale: FeedLocale): string => `/sitemap-${locale}.xml`

export const buildSitemapIndexXml = (origin: string, locales: readonly SitemapIndexLocale[]): string =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locales.map((entry) =>
      [
        "  <sitemap>",
        `    <loc>${escapeXml(`${origin}${sitemapPath(entry.locale)}`)}</loc>`,
        ...(entry.lastmod ? [`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`] : []),
        "  </sitemap>"
      ].join("\n")
    ),
    "</sitemapindex>",
    ""
  ].join("\n")

/**
 * Карта одной локали. `xhtml:link` перечисляет языковые версии адреса, включая его самого:
 * набор альтернатив у пары страниц должен совпадать, иначе робот считает связь односторонней
 * (ADR-0002). Приоритет пишется с одним знаком после запятой — так его ждёт схема sitemap.
 */
export const buildSitemapUrlsetXml = (origin: string, locale: FeedLocale, entries: readonly SitemapEntry[]): string => {
  const urls = entries.map((entry) => {
    const alternates = entry.locales.map(
      (value) =>
        `    <xhtml:link rel="alternate" hreflang="${LOCALE_TAG[value]}" href="${escapeXml(
          absoluteUrl(origin, entry.path, value)
        )}" />`
    )

    return [
      "  <url>",
      `    <loc>${escapeXml(absoluteUrl(origin, entry.path, locale))}</loc>`,
      ...alternates,
      ...(entry.lastmod ? [`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`] : []),
      `    <priority>${entry.priority.toFixed(1)}</priority>`,
      "  </url>"
    ].join("\n")
  })

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    "</urlset>",
    ""
  ].join("\n")
}

/** Запрос ленты RSS: плоский список последних публикаций локали (`feeds-and-sitemap.md` §4). */
export const LATEST_FEED_QUERY = `query LatestFeed($locale: Locale!, $limit: Int!) {
  feed(scope: latest, locale: $locale, limit: $limit) {
    items {
      slug
      sectionSlug
      sectionName
      title
      dek
      cover
      author {
        name
      }
      publishedAt
    }
  }
}`

/** Запрос карты сайта локали. */
export const SITEMAP_ENTRIES_QUERY = `query SitemapEntries($locale: Locale!) {
  sitemapEntries(locale: $locale) {
    path
    lastmod
    priority
    locales
  }
}`

/** Число элементов RSS (`feeds-and-sitemap.md` §4 `[ДОПУЩЕНИЕ]`). */
export const RSS_ITEM_LIMIT = 50

/** Ответ фидов кешируется час (§10); он одинаков для всех и от сессии не зависит. */
export const FEED_CACHE_CONTROL = "public, max-age=3600"

interface GraphQLPayload<T> {
  data?: T | null
  errors?: readonly unknown[]
}

/**
 * Данные из ответа API или `null`. Частичный ответ с ошибками данными не считается: фид
 * собирается целиком или не собирается вовсе — половина карты сайта говорит роботу, что
 * остальных адресов больше нет (§8).
 */
export const feedPayloadData = <T>(status: number, body: unknown): T | null => {
  if (status !== 200) return null
  const payload = body as GraphQLPayload<T> | null
  if (!payload || typeof payload !== "object") return null
  if (payload.errors?.length) return null
  return payload.data ?? null
}

/** Самая поздняя дата изменения карты — `lastmod` её строки в индексе. */
export const latestLastmod = (entries: readonly SitemapEntry[]): string | null => {
  const dates = entries
    .map((entry) => entry.lastmod)
    .filter((value): value is string => Boolean(value))
    .sort()
  return dates.at(-1) ?? null
}
