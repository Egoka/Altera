import { expect, test, type Page } from "./helpers/test"
import { navigateOnClient } from "./helpers/hydration"

const imageId = "22222222-2222-4222-8222-222222222222"

const variants = (name: string) => ({
  version: 1,
  placeholder: null,
  thumbnailWidth: 480,
  items: [
    { format: "avif", width: 960, height: 640, url: `https://media.example.test/${name}-960.avif` },
    { format: "webp", width: 960, height: 640, url: `https://media.example.test/${name}-960.webp` }
  ]
})

const body = {
  type: "doc",
  attrs: { schemaVersion: 1 },
  content: [
    {
      type: "paragraph",
      attrs: { id: "11111111-1111-4111-8111-111111111111" },
      content: [{ type: "text", text: "Город просыпается раньше трамваев." }]
    },
    {
      type: "figure",
      attrs: { id: "33333333-3333-4333-8333-333333333333", assetId: imageId, size: "wide" }
    }
  ]
}

const article = (overrides: Record<string, unknown> = {}) => ({
  id: "article-1",
  translationId: "translation-ru",
  locale: "ru",
  title: "Город до первого рейса",
  slug: "gorod-do-pervogo-reysa",
  dek: "Наблюдение за тихим часом большого города.",
  body,
  excerpt: "Городское эссе",
  featuredImage: null,
  cover: { variants: variants("cover"), alt: "Пустая трамвайная остановка на рассвете" },
  bodyAssets: [
    {
      id: imageId,
      alt: "Свет в окнах ранним утром",
      caption: "До открытия метро",
      attribution: "Фото: редакция",
      variants: variants("body"),
      width: 1200,
      height: 800
    }
  ],
  status: null,
  preview: false,
  reeditUntil: null,
  publishedAt: "2026-09-20T10:00:00.000Z",
  firstPublishedAt: "2026-09-20T10:00:00.000Z",
  createdAt: "2026-09-19T10:00:00.000Z",
  updatedAt: "2026-09-20T11:00:00.000Z",
  readingTime: 4,
  isTranslation: false,
  sibling: { locale: "en", path: "/en/culture/city-before-the-first-tram" },
  author: {
    id: "author-1",
    name: "Вера Орлова",
    slug: "vera",
    bio: "Пишет о городах и людях.",
    photoUrl: null,
    socialLinks: null
  },
  section: { name: "Культура", slug: "culture" },
  tags: [{ name: "Город", slug: "city" }],
  ...overrides
})

async function stubGraphQL(page: Page, responses: Record<string, unknown>) {
  await page.route("**/api/graphql", async (route) => {
    const request = route.request().postData() ?? ""
    const operation = Object.keys(responses).find((name) => request.includes(name))
    if (!operation) return route.continue()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responses[operation])
    })
  })
}

test("страница материала рендерит документ, единый alt, закладку и языковую пару", async ({ page }) => {
  await stubGraphQL(page, {
    GetArticle: { data: { article: article() } },
    GetMyBookmark: { errors: [{ extensions: { code: "UNAUTHENTICATED" } }] }
  })

  await page.goto("/about")
  await navigateOnClient(page, "/culture/gorod-do-pervogo-reysa")

  await expect(page.getByRole("heading", { level: 1, name: "Город до первого рейса" })).toBeVisible()
  await expect(page.getByText("Город просыпается раньше трамваев.")).toBeVisible()
  await expect(page.getByAltText("Пустая трамвайная остановка на рассвете")).toBeVisible()
  await expect(page.getByAltText("Свет в окнах ранним утром")).toBeVisible()
  // «English» есть и у переключателя языка в шапке сайта; языковая пара — ссылка самого материала.
  await expect(page.getByTestId("article-sibling")).toHaveText(/English/)
  await expect(page.getByTestId("article-sibling")).toHaveAttribute("href", "/en/culture/city-before-the-first-tram")
  await expect(page.getByRole("link", { name: "Войти, чтобы сохранить материал" })).toBeVisible()
})

test("предпросмотр показывает статус и окно перередактирования", async ({ page }) => {
  await stubGraphQL(page, {
    GetArticle: {
      data: {
        article: article({
          preview: true,
          status: "published",
          reeditUntil: "2026-09-28T23:59:00.000Z",
          sibling: null
        })
      }
    },
    GetMyBookmark: { errors: [{ extensions: { code: "FORBIDDEN" } }] }
  })

  await page.goto("/about")
  await navigateOnClient(page, "/culture/gorod-do-pervogo-reysa?preview=token")

  await expect(page.getByText("Предпросмотр")).toBeVisible()
  await expect(page.getByText(/Перередактировать до/)).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)
})

test("снятый материал показывает публичные метаданные на странице 410", async ({ page }) => {
  await stubGraphQL(page, {
    GetArticle: { data: { article: null }, errors: [{ extensions: { code: "ARCHIVED" } }] },
    GetGoneArticle: {
      data: {
        gone: {
          title: "Город до первого рейса",
          firstPublishedAt: "2026-09-20T10:00:00.000Z",
          unpublishedAt: "2026-09-28T10:00:00.000Z",
          author: { name: "Вера Орлова", handle: "vera" },
          section: { name: "Культура", slug: "culture" }
        }
      }
    }
  })

  await page.goto("/about")
  await navigateOnClient(page, "/culture/gorod-do-pervogo-reysa")

  await expect(page.getByText("410", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { level: 2, name: "Город до первого рейса" })).toBeVisible()
  await expect(page.getByText("Этот материал больше недоступен публично.")).toBeVisible()
})
