import { describe, expect, it, vi } from "vitest"
import sectionResolver from "../src/graphql/section/resolver"

const callPublicSections = async (locale: "ru" | "en", findMany: ReturnType<typeof vi.fn>) =>
  sectionResolver.Query.publicSections({}, { locale }, {
    currentUser: null,
    requestId: "req-public-sections",
    prisma: { section: { findMany } }
  } as never)

describe("publicSections", () => {
  it("возвращает гостю только активные рубрики с опубликованными материалами в редакционном порядке", async () => {
    const sections = [
      { id: "culture", name: "Культура", nameEn: "Culture", slug: "culture", order: 1, _count: { articles: 7 } },
      { id: "travel", name: "Путешествия", nameEn: "Travel", slug: "travel", order: 2, _count: { articles: 3 } }
    ]
    const findMany = vi.fn().mockResolvedValue(sections)

    const result = await callPublicSections("ru", findMany)

    expect(result).toEqual([
      { id: "culture", name: "Культура", nameEn: "Culture", slug: "culture", order: 1, articleCount: 7 },
      { id: "travel", name: "Путешествия", nameEn: "Travel", slug: "travel", order: 2, articleCount: 3 }
    ])
    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        articles: { some: { sourceLocale: "ru", status: "published" } }
      },
      orderBy: { order: "asc" },
      select: {
        id: true,
        name: true,
        nameEn: true,
        slug: true,
        order: true,
        _count: { select: { articles: { where: { sourceLocale: "ru", status: "published" } } } }
      }
    })
  })

  /**
   * AC-3 T-129: рубрика публична только там, где у неё есть материал этого языка
   * (журнал §20.9), поэтому английское меню отбирает и считает по своей локали.
   */
  it("в английской локали отбирает и считает рубрики по английским материалам", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { id: "culture", name: "Культура", nameEn: "Culture", slug: "culture", order: 1, _count: { articles: 2 } }
      ])

    const result = await callPublicSections("en", findMany)

    expect(result).toEqual([
      { id: "culture", name: "Культура", nameEn: "Culture", slug: "culture", order: 1, articleCount: 2 }
    ])
    const [{ where, select }] = findMany.mock.calls[0]!
    expect(where.articles.some).toEqual({ sourceLocale: "en", status: "published" })
    expect(select._count.select.articles.where).toEqual({ sourceLocale: "en", status: "published" })
  })
})
