import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildSchema, parse, validate } from "graphql"
import { Window } from "happy-dom"
import { describe, expect, it } from "vitest"
import {
  absoluteUrl,
  buildRssXml,
  buildSitemapIndexXml,
  buildSitemapUrlsetXml,
  escapeXml,
  FEED_CACHE_CONTROL,
  feedPayloadData,
  FEED_LOCALES,
  latestLastmod,
  LATEST_FEED_QUERY,
  localePath,
  RSS_ITEM_LIMIT,
  SITEMAP_ENTRIES_QUERY,
  sitemapPath,
  type RssItem,
  type SitemapEntry
} from "../server/utils/feeds"

// Машиночитаемые ответы: `docs/spec/20-public/feeds-and-sitemap.md` §3, §5, §8, §10.

const ORIGIN = "https://altera.example"

const item = (overrides: Partial<RssItem> = {}): RssItem => ({
  slug: "pismo",
  sectionSlug: "culture",
  sectionName: "Культура",
  title: "Письмо о театре",
  dek: "Короткий дек",
  cover: "/images/cover.jpg",
  author: { name: "Иван Петров" },
  publishedAt: "2026-09-20T12:00:00.000Z",
  ...overrides
})

const entry = (overrides: Partial<SitemapEntry> = {}): SitemapEntry => ({
  path: "/culture/pismo",
  lastmod: "2026-09-20T12:00:00.000Z",
  priority: 0.8,
  locales: ["ru"],
  ...overrides
})

/**
 * Разбор ответа настоящим XML-парсером: агрегатор и робот читают фид так же и на неверной
 * разметке останавливаются. `parsererror` в документе означает, что ответ невалиден.
 */
const parseXml = (xml: string): string => {
  expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n')).toBe(true)

  const parser = new new Window().DOMParser()
  const document = parser.parseFromString(xml, "text/xml")
  expect(document.querySelector("parsererror")?.textContent ?? "", "разбор XML").toBe("")

  return xml
}

const textOf = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((match) => match[1]!)

describe("пути локалей", () => {
  it("русская выдача живёт без префикса, английская — под /en", () => {
    expect(localePath("/culture/pismo", "ru")).toBe("/culture/pismo")
    expect(localePath("/culture/pismo", "en")).toBe("/en/culture/pismo")
  })

  it("главная английской локали — /en без завершающего слеша", () => {
    expect(localePath("/", "ru")).toBe("/")
    expect(localePath("/", "en")).toBe("/en")
  })

  it("адрес фида собирается из origin запроса", () => {
    expect(absoluteUrl(ORIGIN, "/rss.xml", "en")).toBe("https://altera.example/en/rss.xml")
    expect(sitemapPath("ru")).toBe("/sitemap-ru.xml")
  })
})

describe("экранирование", () => {
  it("пять символов XML не попадают в ответ как разметка", () => {
    expect(escapeXml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&apos;")
  })

  it("заголовок с разметкой остаётся текстом", () => {
    const xml = buildRssXml({ origin: ORIGIN, locale: "ru", items: [item({ title: "Театр <b>и</b> «кино»" })] })

    parseXml(xml)
    expect(xml).toContain("<title>Театр &lt;b&gt;и&lt;/b&gt; «кино»</title>")
  })
})

describe("RSS локали", () => {
  const xml = buildRssXml({ origin: ORIGIN, locale: "ru", items: [item(), item({ slug: "esse", title: "Эссе" })] })

  it("канал валиден и объявляет язык локали", () => {
    const parsed = parseXml(xml)

    expect(parsed).toContain('<rss version="2.0"')
    expect(parsed).toContain("<language>ru-RU</language>")
    expect(textOf(parsed, "title")[0]).toBe("Altera")
  })

  it("английская лента ссылается на свою версию канала", () => {
    const english = parseXml(buildRssXml({ origin: ORIGIN, locale: "en", items: [item()] }))

    expect(english).toContain("<language>en-US</language>")
    expect(english).toContain('href="https://altera.example/en/rss.xml" rel="self"')
    expect(english).toContain("<link>https://altera.example/en/culture/pismo</link>")
  })

  it("элемент содержит ссылку, guid, дату первой публикации, автора и рубрику", () => {
    const parsed = parseXml(xml)

    expect(parsed).toContain("<link>https://altera.example/culture/pismo</link>")
    expect(parsed).toContain('<guid isPermaLink="true">https://altera.example/culture/pismo</guid>')
    expect(parsed).toContain("<pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>")
    expect(parsed).toContain("<dc:creator>Иван Петров</dc:creator>")
    expect(parsed).toContain("<category>Культура</category>")
  })

  it("описание содержит дек и обложку полным адресом, но не текст материала", () => {
    const description = textOf(parseXml(xml), "description")[1]

    expect(description).toContain(
      "&lt;img src=&quot;https://altera.example/images/cover.jpg&quot; alt=&quot;&quot; /&gt;"
    )
    expect(description).toContain("&lt;p&gt;Короткий дек&lt;/p&gt;")
    expect(xml).not.toContain("<content:encoded")
  })

  it("материал без дека и обложки остаётся валидным элементом без описания", () => {
    const bare = parseXml(buildRssXml({ origin: ORIGIN, locale: "ru", items: [item({ dek: null, cover: null })] }))

    expect(textOf(bare, "description")).toHaveLength(1)
  })

  it("пустая лента — валидный канал без элементов (§8)", () => {
    const empty = buildRssXml({
      origin: ORIGIN,
      locale: "ru",
      items: [],
      now: new Date("2026-09-21T00:00:00.000Z")
    })

    parseXml(empty)
    expect(empty).not.toContain("<item>")
    expect(empty).toContain("<lastBuildDate>Mon, 21 Sep 2026 00:00:00 GMT</lastBuildDate>")
  })

  it("дата сборки канала — самая поздняя публикация ленты", () => {
    const parsed = buildRssXml({
      origin: ORIGIN,
      locale: "ru",
      items: [item({ publishedAt: "2026-09-18T10:00:00.000Z" }), item({ publishedAt: "2026-09-20T12:00:00.000Z" })]
    })

    expect(parsed).toContain("<lastBuildDate>Sun, 20 Sep 2026 12:00:00 GMT</lastBuildDate>")
  })

  it("неснятая дата публикации не ломает ответ", () => {
    const parsed = parseXml(buildRssXml({ origin: ORIGIN, locale: "ru", items: [item({ publishedAt: null })] }))

    expect(parsed).not.toContain("<pubDate>")
  })
})

describe("индекс карты сайта", () => {
  it("перечисляет карты обеих локалей с датой изменения", () => {
    const xml = buildSitemapIndexXml(ORIGIN, [
      { locale: "ru", lastmod: "2026-09-20T12:00:00.000Z" },
      { locale: "en", lastmod: null }
    ])
    const parsed = parseXml(xml)

    expect(parsed).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(textOf(parsed, "loc")).toEqual([
      "https://altera.example/sitemap-ru.xml",
      "https://altera.example/sitemap-en.xml"
    ])
    expect(textOf(parsed, "lastmod")).toEqual(["2026-09-20T12:00:00.000Z"])
  })

  it("дата индекса — самая поздняя в карте локали", () => {
    expect(latestLastmod([entry({ lastmod: "2026-09-18T00:00:00.000Z" }), entry()])).toBe("2026-09-20T12:00:00.000Z")
    expect(latestLastmod([entry({ lastmod: null })])).toBeNull()
  })
})

describe("карта локали", () => {
  const entries = [
    entry({ path: "/", lastmod: "2026-09-20T12:00:00.000Z", priority: 1, locales: ["ru", "en"] }),
    entry(),
    entry({ path: "/pricing", lastmod: null, priority: 0.5, locales: ["ru", "en"] })
  ]
  const xml = buildSitemapUrlsetXml(ORIGIN, "ru", entries)

  it("валиден и объявляет пространства имён sitemap и xhtml", () => {
    const parsed = parseXml(xml)

    expect(parsed).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
    expect(parsed).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
  })

  it("адреса отдаются полными и в своей локали", () => {
    expect(textOf(xml, "loc")).toEqual([
      "https://altera.example/",
      "https://altera.example/culture/pismo",
      "https://altera.example/pricing"
    ])
  })

  it("английская карта отдаёт те же пути под префиксом локали", () => {
    const english = buildSitemapUrlsetXml(ORIGIN, "en", [entry({ path: "/", priority: 1, locales: ["en", "ru"] })])

    expect(textOf(english, "loc")).toEqual(["https://altera.example/en"])
  })

  it("языковые версии перечисляются как hreflang, включая собственную", () => {
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="ru-RU" href="https://altera.example/" />')
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="en-US" href="https://altera.example/en" />')
  })

  it("одноязычный адрес альтернативы другого языка не получает", () => {
    const article = xml.slice(xml.indexOf("https://altera.example/culture/pismo"))
    expect(article.slice(0, article.indexOf("</url>"))).not.toContain("en-US")
  })

  it("дата изменения необязательна, приоритет пишется всегда", () => {
    expect(textOf(xml, "lastmod")).toEqual(["2026-09-20T12:00:00.000Z", "2026-09-20T12:00:00.000Z"])
    expect(textOf(xml, "priority")).toEqual(["1.0", "0.8", "0.5"])
  })

  it("пустая карта остаётся валидным urlset", () => {
    const empty = buildSitemapUrlsetXml(ORIGIN, "ru", [])

    parseXml(empty)
    expect(empty).not.toContain("<url>")
  })
})

describe("границы выдачи", () => {
  it("лента ограничена пятьюдесятью элементами, обе локали объявлены", () => {
    expect(RSS_ITEM_LIMIT).toBe(50)
    expect(FEED_LOCALES).toEqual(["ru", "en"])
  })

  it("ответ кешируется час (§10)", () => {
    expect(FEED_CACHE_CONTROL).toBe("public, max-age=3600")
  })
})

describe("ответ API", () => {
  it("данные берутся только из полного успешного ответа", () => {
    expect(feedPayloadData(200, { data: { feed: { items: [] } } })).toEqual({ feed: { items: [] } })
  })

  it("отказ, частичный ответ и пустое тело данными не считаются (§8)", () => {
    expect(feedPayloadData(200, { data: { feed: {} }, errors: [{ message: "INTERNAL_ERROR" }] })).toBeNull()
    expect(feedPayloadData(503, { data: { feed: {} } })).toBeNull()
    expect(feedPayloadData(200, { data: null })).toBeNull()
    expect(feedPayloadData(200, null)).toBeNull()
  })
})

describe("запросы к API", () => {
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url))

  const graphqlFiles = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true })
      .flatMap((dirent) => {
        const path = join(directory, dirent.name)
        if (dirent.isDirectory()) return graphqlFiles(path)
        return dirent.isFile() && dirent.name.endsWith(".graphql") ? [path] : []
      })
      .sort()

  const schema = buildSchema(
    graphqlFiles(join(repositoryRoot, "server/src/graphql"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n")
  )

  it("запросы фидов валидны против схемы сервера", () => {
    for (const query of [LATEST_FEED_QUERY, SITEMAP_ENTRIES_QUERY]) {
      expect(validate(schema, parse(query)).map((error) => error.message)).toEqual([])
    }
  })
})
