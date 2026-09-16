import { describe, expect, it, vi } from "vitest"
import sectionResolver from "../src/graphql/section/resolver"

describe("publicSections", () => {
  it("возвращает гостю только активные рубрики с опубликованными материалами в редакционном порядке", async () => {
    const sections = [
      { id: "culture", name: "Культура", nameEn: "Culture", slug: "culture", order: 1, _count: { articles: 7 } },
      { id: "travel", name: "Путешествия", nameEn: "Travel", slug: "travel", order: 2, _count: { articles: 3 } }
    ]
    const findMany = vi.fn().mockResolvedValue(sections)

    const result = await sectionResolver.Query.publicSections({}, {}, {
      currentUser: null,
      requestId: "req-public-sections",
      prisma: { section: { findMany } }
    } as never)

    expect(result).toEqual([
      { id: "culture", name: "Культура", nameEn: "Culture", slug: "culture", order: 1, articleCount: 7 },
      { id: "travel", name: "Путешествия", nameEn: "Travel", slug: "travel", order: 2, articleCount: 3 }
    ])
    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        articles: { some: { status: "published" } }
      },
      orderBy: { order: "asc" },
      select: {
        id: true,
        name: true,
        nameEn: true,
        slug: true,
        order: true,
        _count: { select: { articles: { where: { status: "published" } } } }
      }
    })
  })
})
