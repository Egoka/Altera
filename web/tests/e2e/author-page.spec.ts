import { expect, test, type Page } from "@playwright/test"

// Строки состояний страницы автора в браузере (`docs/spec/20-public/author.md` §8).
//
// База браузерной проверки поднимается миграциями без seed, поэтому прямой заход показывает
// «не найдено». Наполненные строки задаются перехватом ответа GraphQL: SSR-запрос уходит
// мимо браузера, а клиентский переход из списка авторов выполняет его уже в странице.

const feedItem = (id: string, publishedAt: string) => ({
  id,
  slug: `slug-${id}`,
  sectionSlug: "culture",
  sectionName: "Культура",
  title: `Материал ${id}`,
  dek: "Подзаголовок материала",
  cover: null,
  publishedAt,
  isTranslation: false,
  author: { name: "Вера Орлова", handle: "vera", grade: "pro" }
})

const navigation = {
  publicSections: [{ id: "1", name: "Культура", nameEn: "Culture", slug: "culture", order: 1, articleCount: 3 }],
  popularTags: [{ slug: "ai", name: "ИИ", articleCount: 3 }]
}

/** Карточка каталога, через которую выполняется клиентский переход на страницу автора. */
const authorCatalog = {
  data: {
    sectionCatalog: [{ slug: "culture", name: "Культура" }],
    authorCatalog: {
      letters: ["В"],
      items: [
        {
          id: "1",
          handle: "vera",
          name: "Вера Орлова",
          avatar: null,
          grade: "pro",
          bioShort: "Пишет о городе.",
          publishedCount: 3,
          isEditorial: false,
          recent: []
        }
      ],
      pageInfo: { page: 1, totalPages: 1, totalCount: 1, hasNext: false }
    }
  }
}

const authorProfile = (overrides: Record<string, unknown> = {}) => ({
  id: "1",
  handle: "vera",
  name: "Вера Орлова",
  bio: "Пишет о городе и его жителях.",
  avatar: null,
  grade: "pro",
  publishedCount: 3,
  firstPublishedAt: "2026-03-04T08:00:00.000Z",
  redirect: null,
  links: [{ kind: "telegram", url: "https://t.me/vera" }],
  ...overrides
})

const authorFeed = (overrides: Record<string, unknown> = {}) => ({
  caption: "by_publication_date",
  redirect: null,
  items: [feedItem("1", "2026-09-18T10:00:00.000Z"), feedItem("2", "2026-08-12T10:00:00.000Z")],
  pageInfo: { page: 1, totalPages: 2, hasNext: true },
  ...overrides
})

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

/** Клиентский переход на страницу автора по карточке каталога. */
const openAuthorPage = async (page: Page) => {
  await page.goto("/authors")
  await page
    .getByRole("link", { name: /Вера Орлова/ })
    .first()
    .click()
}

test("пустая база: неизвестный автор отвечает 404", async ({ page }) => {
  expect((await page.goto("/authors/vera"))?.status()).toBe(404)
})

test("страница автора: шапка, хроника по месяцам и пагинация", async ({ page }) => {
  await stubGraphQL(page, {
    GetNavigation: { data: navigation },
    GetAuthorCatalog: authorCatalog,
    GetAuthorPage: { data: { author: authorProfile(), feed: authorFeed() } }
  })

  await openAuthorPage(page)

  await expect(page).toHaveURL(/\/authors\/vera$/)
  await expect(page.getByRole("heading", { level: 1, name: "Вера Орлова" })).toBeVisible()
  await expect(page.getByText("@vera")).toBeVisible()
  await expect(page.getByText("Пишет о городе и его жителях.")).toBeVisible()
  await expect(page.getByText("публикуется с марта 2026")).toBeVisible()
  await expect(page.getByText("по дате публикации")).toBeVisible()
  // Хроника: материалы двух месяцев публикации разнесены подписями месяцев.
  await expect(page.getByRole("heading", { level: 2, name: "Сентябрь 2026" })).toBeVisible()
  await expect(page.getByRole("heading", { level: 2, name: "Август 2026" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Материал 1" }).first()).toBeVisible()
  await expect(page.getByRole("link", { name: "telegram" })).toHaveAttribute("rel", "nofollow noopener noreferrer")
  await expect(page.getByRole("link", { name: "2", exact: true })).toHaveAttribute("href", "/authors/vera?page=2")
})

test("страница автора: истёкший план оставляет страницу, но снимает бейдж pro", async ({ page }) => {
  await stubGraphQL(page, {
    GetNavigation: { data: navigation },
    GetAuthorCatalog: authorCatalog,
    GetAuthorPage: { data: { author: authorProfile({ grade: "standard" }), feed: authorFeed() } }
  })

  await openAuthorPage(page)

  await expect(page.getByRole("heading", { level: 1, name: "Вера Орлова" })).toBeVisible()
  await expect(page.getByLabel("Автор уровня pro")).toHaveCount(0)
})

test("страница автора: пусто в локали предлагает другой язык", async ({ page }) => {
  await stubGraphQL(page, {
    GetNavigation: { data: navigation },
    GetAuthorCatalog: authorCatalog,
    GetAuthorPage: {
      data: {
        author: authorProfile(),
        feed: authorFeed({ items: [], pageInfo: { page: 1, totalPages: 0, hasNext: false } })
      }
    }
  })

  await openAuthorPage(page)

  await expect(page.getByRole("heading", { name: "На этом языке у автора пока ничего нет" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Посмотреть на другом языке" })).toHaveAttribute(
    "href",
    "/en/authors/vera"
  )
})

test("страница автора: прежний хэндл уводит на нынешний", async ({ page }) => {
  await stubGraphQL(page, {
    GetNavigation: { data: navigation },
    GetAuthorCatalog: authorCatalog,
    GetAuthorPage: {
      data: {
        author: authorProfile({ handle: "vera-new", redirect: "vera-new" }),
        feed: authorFeed({ items: [], pageInfo: null, redirect: { slug: "vera-new" } })
      }
    }
  })

  await openAuthorPage(page)

  await expect(page).toHaveURL(/\/authors\/vera-new$/)
})

test("страница автора: снятый аккаунт показывает страницу 410", async ({ page }) => {
  await stubGraphQL(page, {
    GetNavigation: { data: navigation },
    GetAuthorCatalog: authorCatalog,
    GetAuthorPage: {
      errors: [{ message: "Entity archived", extensions: { code: "ARCHIVED", requestId: "req-gone" } }]
    }
  })

  await openAuthorPage(page)

  await expect(page.getByRole("heading", { name: "Страница автора недоступна" })).toBeVisible()
  await expect(page.getByText("410")).toBeVisible()
  await expect(page.getByRole("heading", { level: 1, name: "Вера Орлова" })).toHaveCount(0)
})

test("страница автора: отказ данных показывает код запроса", async ({ page }) => {
  await stubGraphQL(page, {
    GetNavigation: { data: navigation },
    GetAuthorCatalog: authorCatalog,
    GetAuthorPage: {
      errors: [{ message: "Internal server error", extensions: { code: "INTERNAL_ERROR", requestId: "req-author" } }]
    }
  })

  await openAuthorPage(page)

  // Локатор по тексту, а не по роли: у объявления маршрута Nuxt та же роль `alert`.
  await expect(page.getByText("Код запроса: req-author")).toBeVisible()
})
