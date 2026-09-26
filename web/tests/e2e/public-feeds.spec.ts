import { expect, test, type Page } from "./helpers/test"

// Строки состояний §8 пяти публичных страниц в браузере: `section-feed.md`,
// `tag-feed.md`, `sections-index.md`, `tags-index.md`, `authors-index.md`.
//
// База браузерной проверки поднимается миграциями без seed, поэтому прямой заход
// показывает пустые строки и «не найдено». Наполненные строки задаются перехватом
// ответа GraphQL: SSR-запрос уходит мимо браузера, а клиентский переход выполняет
// его уже в странице.

const feedItem = (id: string) => ({
  id,
  slug: `slug-${id}`,
  sectionSlug: "culture",
  sectionName: "Культура",
  title: `Материал ${id}`,
  dek: "Подзаголовок материала",
  cover: null,
  publishedAt: "2026-09-18T10:00:00.000Z",
  isTranslation: false,
  author: { name: "Автор", handle: "author", grade: "standard" }
})

/** Шапка подтягивает рубрики уже в браузере — через них выполняется клиентский переход. */
const navigation = {
  publicSections: [{ id: "1", name: "Культура", nameEn: "Culture", slug: "culture", order: 1, articleCount: 3 }],
  popularTags: [{ slug: "ai", name: "ИИ", articleCount: 3 }]
}

const stubGraphQL = async (page: Page, responses: Record<string, unknown>) => {
  await page.route("**/api/graphql", async (route) => {
    const body = route.request().postData() ?? ""
    const operation = Object.keys(responses).find((name) => body.includes(name))
    if (!operation) return route.continue()

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responses[operation])
    })
  })
}

/** Клиентский переход в ленту рубрики по ссылке шапки. */
const openSectionFeed = async (page: Page) => {
  await page.goto("/sections")
  await page.getByRole("link", { name: "Культура" }).first().click()
  await expect(page).toHaveURL(/\/culture$/)
}

test("пустая база: каталоги показывают свои пустые строки", { tag: "@empty-db" }, async ({ page }) => {
  await page.goto("/sections")
  await expect(page.getByRole("heading", { name: "Рубрики" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Материалов пока нет" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Стать автором" }).last()).toHaveAttribute("href", "/pricing")

  await page.goto("/tags")
  await expect(page.getByRole("heading", { name: "Тегов пока нет" })).toBeVisible()

  await page.goto("/authors")
  await expect(page.getByRole("heading", { name: "Авторов пока нет — станьте первым" })).toBeVisible()
})

test("пустая база: неизвестные рубрика и тег отвечают 404", { tag: "@empty-db" }, async ({ page }) => {
  expect((await page.goto("/culture"))?.status()).toBe(404)
  expect((await page.goto("/tags/ai"))?.status()).toBe(404)
})

test("прежний адрес каталога рубрик ведёт на новый", async ({ page }) => {
  const response = await page.goto("/types")

  expect(page.url()).toContain("/sections")
  expect(response?.request().redirectedFrom()?.url()).toContain("/types")
})

test("лента рубрики: шапка, материалы, фильтры и пагинация", async ({ page }) => {
  await stubGraphQL(page, {
    GetNavigation: { data: navigation },
    GetSectionFeed: {
      data: {
        feed: {
          redirect: null,
          caption: "by_publication_date",
          section: { slug: "culture", name: "Культура", description: "О культуре", articleCount: 30 },
          items: Array.from({ length: 3 }, (_, index) => feedItem(String(index + 1))),
          pageInfo: { page: 1, totalPages: 2, hasNext: true },
          formats: [{ slug: "essay", name: "Эссе", count: 4 }],
          topTags: [{ slug: "ai", name: "ИИ", count: 3 }],
          otherSections: [{ slug: "society", name: "Общество", count: 5 }]
        }
      }
    }
  })

  await openSectionFeed(page)

  await expect(page.getByRole("heading", { level: 1, name: "Культура" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Материал 1" }).first()).toBeVisible()
  await expect(page.getByRole("link", { name: "Эссе" })).toHaveAttribute("href", "/culture?format=essay")
  await expect(page.getByRole("link", { name: "2", exact: true })).toHaveAttribute("href", "/culture?page=2")
})

test("лента рубрики: пусто по фильтру предлагает сбросить фильтры", async ({ page }) => {
  await stubGraphQL(page, {
    GetNavigation: { data: navigation },
    GetSectionFeed: {
      data: {
        feed: {
          redirect: null,
          caption: "by_publication_date",
          section: { slug: "culture", name: "Культура", description: null, articleCount: 30 },
          items: [],
          pageInfo: { page: 1, totalPages: 0, hasNext: false },
          formats: [{ slug: "essay", name: "Эссе", count: 4 }],
          topTags: [],
          otherSections: []
        }
      }
    }
  })

  await openSectionFeed(page)

  await expect(page.getByRole("heading", { name: "Ничего не найдено" })).toBeVisible()
})

test("лента рубрики: архивированная рубрика уводит на преемника", async ({ page }) => {
  await stubGraphQL(page, {
    GetNavigation: { data: navigation },
    GetSectionFeed: {
      data: {
        feed: {
          redirect: { slug: "society" },
          caption: null,
          section: null,
          items: [],
          pageInfo: null,
          formats: [],
          topTags: [],
          otherSections: []
        }
      }
    }
  })

  await page.goto("/sections")
  await page.getByRole("link", { name: "Культура" }).first().click()

  await expect(page).toHaveURL(/\/society$/)
})

test("лента рубрики: отказ данных показывает код запроса", async ({ page }) => {
  await stubGraphQL(page, {
    GetNavigation: { data: navigation },
    GetSectionFeed: {
      errors: [{ message: "Internal server error", extensions: { code: "INTERNAL_ERROR", requestId: "req-e2e" } }]
    }
  })

  await page.goto("/sections")
  await page.getByRole("link", { name: "Культура" }).first().click()

  // Локатор по тексту, а не по роли: у объявления маршрута Nuxt та же роль `alert`.
  await expect(page.getByText("Код запроса: req-e2e")).toBeVisible()
})

test("список тегов: облако, список со счётчиками и сортировка", async ({ page }) => {
  await stubGraphQL(page, {
    GetNavigation: { data: navigation },
    GetTagCatalog: {
      data: {
        popularTags: [{ slug: "ai", name: "ИИ", articleCount: 9 }],
        tagCatalog: {
          letters: ["И"],
          items: [{ slug: "ai", name: "ИИ", articleCount: 9 }],
          pageInfo: { page: 1, totalPages: 1, totalCount: 1, hasNext: false }
        }
      }
    }
  })

  await page.goto("/sections")
  await page.getByRole("link", { name: "Теги", exact: true }).click()

  await expect(page).toHaveURL(/\/tags$/)
  await expect(page.getByRole("link", { name: "ИИ" }).first()).toHaveAttribute("href", "/tags/ai")
  await expect(page.getByRole("link", { name: "По имени" })).toHaveAttribute("href", "/tags?sort=name")
})

test("список авторов: карточки и подпись принципа порядка", async ({ page }) => {
  await stubGraphQL(page, {
    GetNavigation: { data: navigation },
    GetAuthorCatalog: {
      data: {
        sectionCatalog: [{ slug: "culture", name: "Культура" }],
        authorCatalog: {
          letters: ["А"],
          items: [
            {
              id: "1",
              handle: "anna",
              name: "Анна",
              avatar: null,
              grade: "pro",
              bioShort: "Пишет о городе.",
              publishedCount: 4,
              isEditorial: false,
              recent: [{ title: "Материал", path: "/culture/slug-1", author: "Анна" }]
            }
          ],
          pageInfo: { page: 1, totalPages: 1, totalCount: 1, hasNext: false }
        }
      }
    }
  })

  await page.goto("/sections")
  await page.getByRole("link", { name: "Авторы", exact: true }).click()

  await expect(page).toHaveURL(/\/authors$/)
  await expect(page.getByText("по дате последней публикации")).toBeVisible()
  await expect(page.getByRole("link", { name: /Анна/ }).first()).toHaveAttribute("href", "/authors/anna")
})
