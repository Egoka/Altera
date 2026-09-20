import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { captionKey, homeSection, toHomeSections, toReadingArticle } from "../app/utils/homeFeed"
import { feedRequestId } from "../app/utils/publicFeed"

const appDir = fileURLToPath(new URL("../app", import.meta.url))

const item = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  slug: `slug-${id}`,
  sectionSlug: "culture",
  sectionName: "Культура",
  title: `Материал ${id}`,
  dek: "Подзаголовок",
  cover: null,
  publishedAt: "2026-09-20T10:00:00.000Z",
  isTranslation: false,
  author: { name: "Автор", handle: "author", grade: "standard" as const },
  ...overrides
})

describe("подборки главной на стороне страницы", () => {
  it("сохраняет порядок и состав подборок из ответа", () => {
    const sections = toHomeSections({
      locale: "ru",
      sections: [
        { key: "top", caption: "by_publication_date", items: [item("1")] },
        { key: "new", caption: "by_publication_date", items: [item("2"), item("3")] }
      ]
    })

    expect(sections.map((section) => section.key)).toEqual(["top", "new"])
    expect(homeSection(sections, "new")!.articles).toHaveLength(2)
    expect(homeSection(sections, "popular")).toBeUndefined()
  })

  it("на пустом ответе не выдумывает подборок", () => {
    expect(toHomeSections(null)).toEqual([])
    expect(toHomeSections({ locale: "ru", sections: [] })).toEqual([])
  })

  it("переводит карточку подборки в поля компонентов чтения", () => {
    const article = toReadingArticle(
      item("4", {
        cover: "/media/cover.jpg",
        isTranslation: true,
        author: { name: "Про", handle: "pro", grade: "pro" }
      })
    )

    expect(article).toEqual({
      id: "4",
      title: "Материал 4",
      slug: "slug-4",
      dek: "Подзаголовок",
      featuredImage: "/media/cover.jpg",
      publishedAt: "2026-09-20T10:00:00.000Z",
      isTranslation: true,
      author: { name: "Про", slug: "pro", grade: "pro" },
      section: { name: "Культура", slug: "culture" }
    })
  })

  it("подпись подборки берётся из словаря, а не из ключа перечисления", () => {
    expect(captionKey("by_publication_date")).toBe("home.captionByDate")
  })

  it("достаёт код запроса из отказа и не падает без него", () => {
    expect(feedRequestId([{ extensions: { requestId: "req-1" } }])).toBe("req-1")
    expect(feedRequestId([{ extensions: {} }])).toBeUndefined()
    expect(feedRequestId(undefined)).toBeUndefined()
  })
})

// Критерий готовности T-054: фикстуры главной удалены. Тест держит страницу на данных
// сервера — вернувшаяся заглушка станет красным тестом, а не тихой демонстрацией.
describe("главная без фикстур", () => {
  const homeSources = [
    join(appDir, "pages/index.vue"),
    ...readdirSync(join(appDir, "components/pages/start")).map((name) => join(appDir, "components/pages/start", name))
  ]

  it.each(homeSources)("%s не содержит демонстрационных данных", (path) => {
    const source = readFileSync(path, "utf8")

    expect(source).not.toMatch(/demoFeed|DEMO_|mock|picsum\.photos|images\.unsplash\.com/i)
  })

  it("страница главной запрашивает подборки у сервера", () => {
    expect(readFileSync(join(appDir, "pages/index.vue"), "utf8")).toContain("GET_HOME_FEED")
  })
})
